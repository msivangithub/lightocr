/**
 * tesseractOcr.js — Tesseract OCR as the 3rd provider in the fallback chain.
 *
 * Fallback chain:  Sarvam AI  →  Google Gemini Vision  →  Tesseract (local)  →  Heuristic
 *
 * Tesseract runs 100% offline with ZERO API cost — guarantees the system always
 * produces output even when all cloud services are down or credits exhausted.
 *
 * Installed languages (apt tesseract-ocr-*):
 *   eng (English), hin (Hindi), tel (Telugu), tam (Tamil), kan (Kannada),
 *   mar (Marathi), guj (Gujarati), ben (Bengali), ori (Odia), pan (Punjabi)
 *
 * Usage:
 *   ocrImage(filePath, { lang, psm })  → { text, engine:'tesseract', lang }
 *   ocrPdfPages(filePath, workDir)     → [{page, text, engine}]
 *   ping()                            → { ok, version, langs }
 */

const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

const log = (...a) => console.log('[tesseract]', ...a);

/** Run a command, return { status, stdout, stderr } */
const run = (cmd, args, opts = {}) => new Promise((resolve) =>
  execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 120000, ...opts },
    (err, stdout, stderr) => resolve({ status: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' })
  )
);

// ── language helpers ───────────────────────────────────────────────────────
/** Map app locale codes to Tesseract lang codes */
const LOCALE_TO_TESS = {
  'en-IN': 'eng', 'hi-IN': 'hin', 'te-IN': 'tel', 'ta-IN': 'tam',
  'kn-IN': 'kan', 'mr-IN': 'mar', 'gu-IN': 'guj', 'bn-IN': 'ben',
  'or-IN': 'ori', 'pa-IN': 'pan',
};

let _availLangs = null;
async function availableLangs() {
  if (_availLangs) return _availLangs;
  const r = await run('tesseract', ['--list-langs']);
  const raw = (r.stdout + r.stderr).split('\n')
    .map(l => l.trim())
    .filter(l => /^[a-z]{2,4}$/.test(l) && l !== 'osd');
  _availLangs = new Set(raw);
  return _availLangs;
}

/**
 * Build language string for tesseract -l flag.
 * Includes English + the requested app locale.
 * Falls back to English only if the locale is not installed.
 */
async function buildLangStr(appLocale) {
  const langs = await availableLangs();
  const requested = LOCALE_TO_TESS[appLocale] || 'eng';
  const parts = new Set(['eng']);
  if (langs.has(requested)) parts.add(requested);
  // Add Indic script detection for mixed-language invoices
  if (langs.has('hin') && appLocale && appLocale !== 'en-IN') parts.add('hin');
  return [...parts].join('+');
}

// ── core OCR ──────────────────────────────────────────────────────────────
/**
 * OCR a single image file.
 * @param {string} imagePath  path to JPEG/PNG/TIFF/WebP
 * @param {{ lang?, psm?, appLocale? }} opts
 * @returns {{ text, engine, lang, confidence }}
 */
async function ocrImage(imagePath, opts = {}) {
  const langStr = opts.lang || (await buildLangStr(opts.appLocale || 'en-IN'));
  const psm     = opts.psm || '6';   // PSM 6 = single uniform block of text
  const ext     = path.extname(imagePath).toLowerCase();

  // Tesseract can natively read JPEG, PNG, TIFF, WebP, BMP
  if (!['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.bmp'].includes(ext)) {
    throw new Error(`Tesseract: unsupported image format ${ext}`);
  }

  log(`OCR ${path.basename(imagePath)} lang=${langStr} psm=${psm}`);

  const r = await run('tesseract', [imagePath, 'stdout', '--psm', psm, '-l', langStr]);
  if (r.status !== 0 && !r.stdout.trim()) {
    throw new Error(`Tesseract OCR failed (exit ${r.status}): ${r.stderr.slice(0, 200)}`);
  }

  const text = r.stdout.trim();
  log(`  → ${text.split('\n').length} lines, ${text.length} chars`);
  return { text, engine: 'tesseract', lang: langStr };
}

/**
 * OCR all pages of a PDF file.
 * Requires poppler (pdftoppm) to convert pages to images first.
 * @param {string} pdfPath
 * @param {string} workDir   temp directory for page images
 * @param {{ appLocale?, contentType? }} opts
 * @returns {Array<{page, text, engine}>}
 */
async function ocrPdfPages(pdfPath, workDir, opts = {}) {
  fs.mkdirSync(workDir, { recursive: true });
  const prefix = path.join(workDir, 'p');

  // Render PDF pages to JPEG via pdftoppm
  const renderResult = await run('pdftoppm', ['-r', '200', '-jpeg', '-jpegopt', 'quality=90', pdfPath, prefix]);
  if (renderResult.status !== 0) {
    throw new Error(`pdftoppm failed (exit ${renderResult.status}): ${renderResult.stderr.slice(0, 200)}`);
  }

  const pageFiles = fs.readdirSync(workDir)
    .filter(f => /^p-?\d+\.jpg$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10);
      const nb = parseInt(b.replace(/\D/g, ''), 10);
      return na - nb;
    });

  if (!pageFiles.length) throw new Error('pdftoppm produced no page images');

  log(`OCR PDF: ${pageFiles.length} page(s) via tesseract`);

  const results = [];
  for (const file of pageFiles) {
    const pageNum = parseInt(file.replace(/\D/g, ''), 10);
    const imgPath = path.join(workDir, file);
    const r = await ocrImage(imgPath, { ...opts, psm: '6' });
    results.push({ page: pageNum, text: r.text, engine: 'tesseract', lang: r.lang });
  }
  return results;
}

/**
 * Ping: check Tesseract is available and return version + langs.
 */
async function ping() {
  const out = { engine: 'tesseract', available: false };
  try {
    const ver = await run('tesseract', ['--version']);
    const vLine = (ver.stdout + ver.stderr).split('\n')[0];
    out.version = vLine.replace('tesseract', '').trim();
    out.available = true;
    const langs = [...(await availableLangs())];
    out.langs = langs;
    out.langCount = langs.length;
    out.status = `ok — v${out.version}, ${langs.length} languages (${langs.slice(0,5).join(', ')}…)`;
    out.ok = true;
  } catch (e) {
    out.status = e.message;
    out.ok = false;
  }
  return out;
}

// ── detect & structure ────────────────────────────────────────────────────
/**
 * Detect document type from OCR text using the heuristic engine.
 * (Tesseract does OCR only; classification is done by heuristic/LLM)
 */
async function detectFromOcrText(text, fileName) {
  const { heuristicDetect } = require('./ocrEngine');
  return heuristicDetect(text, 'Classified by heuristic after Tesseract OCR');
}

/**
 * Structure document fields from Tesseract OCR text.
 * Uses the heuristic parser (fast, offline) since Tesseract is local.
 */
async function structureFromOcrText(text) {
  const { heuristicStructure } = require('./ocrEngine');
  return heuristicStructure(text);
}

/**
 * Full pipeline: OCR an image/PDF file, detect type, extract fields.
 * Returns { rawText, pages, detection?, structured? }
 */
async function processFile(filePath, opts = {}) {
  const ext = path.extname(filePath).toLowerCase();
  let pages = [];

  if (ext === '.pdf') {
    const workDir = path.join(path.dirname(filePath), 'tess-' + Date.now());
    try {
      pages = await ocrPdfPages(filePath, workDir, opts);
    } finally {
      // cleanup
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  } else {
    const r = await ocrImage(filePath, opts);
    pages = [{ page: 1, text: r.text, engine: r.engine }];
  }

  const rawText = pages.map(p => p.content || p.text || '').join('\n\n---- page ----\n\n');
  return { rawText, pages, engine: 'tesseract' };
}

module.exports = { ocrImage, ocrPdfPages, processFile, detectFromOcrText, structureFromOcrText, ping, availableLangs, buildLangStr };
