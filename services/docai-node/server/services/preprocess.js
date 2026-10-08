/**
 * Document pre-processing for bulk intake.
 *  - unpack ZIP / RAR containers
 *  - classify PDFs: digital (good text) | garbled (broken font encoding) | scanned (no text)
 *  - render PDF pages → JPEG (pdftoppm) for OCR, split long PDFs into ≤10-page chunks (Sarvam limit)
 *  - images: EXIF auto-orient, optional manual rotation, grayscale + normalise, cap long edge, thumbnails
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const run = (cmd, args, opts = {}) => new Promise((resolve) => execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => resolve({ status: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' })));
const sharp = require('sharp');
const AdmZip = require('adm-zip');

const MAX_EDGE = Number(process.env.OCR_MAX_EDGE || 2200);
const RENDER_DPI = Number(process.env.PDF_RENDER_DPI || 170);
const PAGE_LIMIT = 10; // Sarvam doc-ai: ≤10 pages / ≤10 images per job

const isImg = (f) => /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(f);
const isPdf = (f) => /\.pdf$/i.test(f);
const isArchive = (f) => /\.(zip|rar)$/i.test(f);
const isTabular = (f) => /\.(xlsx|xls|csv|tsv)$/i.test(f);

/* ------------------------------------------------------------ unpack */
async function unpack(filePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  if (/\.zip$/i.test(filePath)) {
    const zip = new AdmZip(filePath);
    for (const e of zip.getEntries()) {
      if (e.isDirectory || /(^|\/)\./.test(e.entryName) || /__MACOSX/.test(e.entryName)) continue;
      const p = path.join(outDir, path.basename(e.entryName)); fs.writeFileSync(p, e.getData()); out.push({ name: path.basename(e.entryName), path: p });
    }
  } else if (/\.rar$/i.test(filePath)) {
    const { createExtractorFromData } = require('node-unrar-js');
    const data = fs.readFileSync(filePath);
    const ex = await createExtractorFromData({ data: Uint8Array.from(data).buffer });
    const r = ex.extract();
    for (const f of r.files) {
      if (f.fileHeader.flags.directory || !f.extraction) continue;
      const name = path.basename(f.fileHeader.name); if (!name || name.startsWith('.')) continue;
      const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(f.extraction)); out.push({ name, path: p });
    }
  }
  return out.filter((f) => isImg(f.name) || isPdf(f.name) || isTabular(f.name));
}

/* ------------------------------------------------------------ tools */
const toolCache = {};
async function hasTool(cmd) { if (toolCache[cmd] != null) return toolCache[cmd]; const r = await run(cmd, ['-v']); toolCache[cmd] = r.status !== 'ENOENT' && r.status !== 127; return toolCache[cmd]; }
async function toolReport() { const out = {}; for (const c of ['pdftoppm', 'pdftotext', 'pdfinfo', 'tesseract']) out[c] = await hasTool(c); try { require('sharp'); out.sharp = true; } catch { out.sharp = false; } return out; }
/** Split a PDF into ≤n-page chunks (pure JS, pdf-lib). Returns [{path, first, last}] */
async function splitPdf(filePath, outDir, n = PAGE_LIMIT) {
  const { PDFDocument } = require('pdf-lib');
  fs.mkdirSync(outDir, { recursive: true });
  const src = await PDFDocument.load(fs.readFileSync(filePath), { ignoreEncryption: true });
  const total = src.getPageCount(); const out = [];
  if (total <= n) return [{ path: filePath, first: 1, last: total }];
  for (let i = 0; i < total; i += n) {
    const doc = await PDFDocument.create(); const idx = Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k);
    const pages = await doc.copyPages(src, idx); pages.forEach((pg) => doc.addPage(pg));
    const p = path.join(outDir, `part-${i + 1}-${i + idx.length}.pdf`); fs.writeFileSync(p, await doc.save()); out.push({ path: p, first: i + 1, last: i + idx.length });
  }
  return out;
}
async function pdfPageCount(filePath) { try { const { PDFDocument } = require('pdf-lib'); return (await PDFDocument.load(fs.readFileSync(filePath), { ignoreEncryption: true })).getPageCount(); } catch { return 1; } }

/* ------------------------------------------------------------ pdf */
async function pdfInfo(filePath) {
  const r = await run('pdfinfo', [filePath]);
  const m = /Pages:\s+(\d+)/.exec(r.stdout); if (m) return { pages: Number(m[1]) };
  return { pages: await pdfPageCount(filePath) };
}
/** Text layer of a PDF: pdftotext -layout when poppler exists, else pdf-parse (pure JS). */
async function pdfText(filePath, page) {
  const args = ['-layout']; if (page) args.push('-f', String(page), '-l', String(page));
  const r = await run('pdftotext', [...args, filePath, '-']);
  if (r.status === 0) return r.stdout;
  try { const pdfParse = require('pdf-parse'); const opt = page ? { max: page } : {}; const out = await pdfParse(fs.readFileSync(filePath), opt); const t = out.text || ''; if (!page) return t; const parts = t.split('\f'); return parts[page - 1] ?? (page === 1 ? t : ''); } catch { return ''; }
}
/** digital | garbled | scanned */
function classifyPdfText(text) {
  const t = (text || '').replace(/\s+/g, ''); // layout text is mostly spaces – measure the compact string
  if (t.length < 60) return 'scanned';
  const bad = (t.match(/[�\u0000-\u0008]/g) || []).length;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (bad / t.length > 0.05 || letters / t.length < 0.2) return 'garbled';
  return 'digital';
}
async function renderPdfPages(filePath, outDir, { first, last, dpi = RENDER_DPI } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = path.join(outDir, 'p');
  const args = ['-r', String(dpi), '-jpeg', '-jpegopt', 'quality=85'];
  if (first) args.push('-f', String(first)); if (last) args.push('-l', String(last));
  await run('pdftoppm', [...args, filePath, prefix]);
  return fs.readdirSync(outDir).filter((f) => /^p-?\d+\.jpg$/.test(f)).map((f) => ({ page: Number(f.replace(/\D/g, '')), path: path.join(outDir, f) })).sort((a, b) => a.page - b.page);
}

/* ------------------------------------------------------------ images */
async function prepareImage(src, dst, { rotate = 0, enhance = true } = {}) {
  let img = sharp(src, { failOn: 'none' }).rotate(); // EXIF auto-orient
  if (rotate) img = img.rotate(rotate);
  const meta = await sharp(src).metadata();
  const long = Math.max(meta.width || 0, meta.height || 0);
  if (long > MAX_EDGE) img = img.resize({ width: meta.width >= meta.height ? MAX_EDGE : null, height: meta.height > meta.width ? MAX_EDGE : null, fit: 'inside' });
  if (enhance) img = img.grayscale().normalise().sharpen();
  await img.jpeg({ quality: 88 }).toFile(dst);
  const m2 = await sharp(dst).metadata();
  return { path: dst, width: m2.width, height: m2.height, landscape: m2.width > m2.height };
}
async function thumbnail(src, dst, width = 260) { await sharp(src, { failOn: 'none' }).rotate().resize({ width }).jpeg({ quality: 70 }).toFile(dst); return dst; }

/** Pack ≤10 page images into a flat ZIP for one Sarvam job */
function zipPages(pagePaths, dst) {
  const zip = new AdmZip(); pagePaths.forEach((p, i) => zip.addLocalFile(p, '', `page-${String(i + 1).padStart(2, '0')}.jpg`)); zip.writeZip(dst); return dst;
}
function chunk(arr, n = PAGE_LIMIT) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

module.exports = { run, hasTool, toolReport, splitPdf, pdfPageCount, isImg, isPdf, isArchive, isTabular, unpack, pdfInfo, pdfText, classifyPdfText, renderPdfPages, prepareImage, thumbnail, zipPages, chunk, PAGE_LIMIT };
