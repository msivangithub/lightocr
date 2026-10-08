/**
 * Bulk document intake ("Inbox").
 *
 *  upload (files / ZIP / RAR / multi-page PDFs)
 *    → unpack → classify each file → pre-process (orient, enhance, render pages, split >10 pages)
 *    → OCR every page (Sarvam Doc-AI / tesseract / mock) with rate limiting
 *    → group pages into documents (invoice-number & "page x of y" heuristics)
 *    → for each document: detect type → structure → create a wizard batch, run map-suggest + validate
 *    → document waits in the Inbox at REVIEW; user opens it in the 10-step wizard, or bulk-posts clean ones
 *
 *  Progress is streamed to the UI via SSE (/api/docai/intake/:id/events).
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const EventEmitter = require('events');
const pre = require('./preprocess');
const engine = require('./ocrEngine');
const db = require('./db');
const P = require('./pipeline');

const WORK = path.resolve(process.env.UPLOAD_DIR || './uploads', 'intake');
const CONCURRENCY = Number(process.env.INTAKE_CONCURRENCY || (engine.OCR_ENGINE === 'sarvam' ? 2 : 3));
const jobs = new Map();
const bus = new EventEmitter(); bus.setMaxListeners(100);

function emit(job, type, data = {}) { const ev = { type, at: new Date().toISOString(), ...data }; job.events.push(ev); if (job.events.length > 500) job.events.shift(); bus.emit(job.id, ev); }
function setUnit(job, unit, patch) { Object.assign(unit, patch); emit(job, 'unit', { unit: publicUnit(unit) }); }
const publicUnit = (u) => ({ id: u.id, fileName: u.fileName, kind: u.kind, status: u.status, message: u.message, pages: u.pages?.length || 0, docs: (u.docs || []).map(publicDoc), error: u.error, thumb: u.thumb ? `/api/docai/intake/file?p=${encodeURIComponent(u.thumb)}` : null });
const publicDoc = (d) => ({ id: d.id, batchId: d.batchId, pages: d.pages, status: d.status, docType: d.docType, confidence: d.confidence, party: d.party, docNo: d.docNo, docDate: d.docDate, grandTotal: d.grandTotal, lines: d.lines, validation: d.validation, thumb: d.thumb ? `/api/docai/intake/file?p=${encodeURIComponent(d.thumb)}` : null, error: d.error });

/* ------------------------------------------------------------ create */
async function createJob({ user = 'admin', files, options = {} }) {
  const job = { id: uuid(), user, createdAt: new Date().toISOString(), status: 'queued', options, units: [], events: [], summary: {} };
  job.dir = path.join(WORK, job.id); fs.mkdirSync(job.dir, { recursive: true });
  // expand archives
  for (const f of files) {
    if (pre.isArchive(f.originalname)) {
      const inner = await pre.unpack(f.path, path.join(job.dir, 'unpacked', path.parse(f.originalname).name));
      inner.forEach((x) => job.units.push(newUnit(x.name, x.path, f.originalname)));
    } else job.units.push(newUnit(f.originalname, f.path));
  }
  jobs.set(job.id, job);
  run(job).catch((e) => { job.status = 'failed'; job.error = e.message; emit(job, 'job', { status: 'failed', error: e.message }); });
  return job;
}
function newUnit(fileName, filePath, container) { return { id: uuid().slice(0, 8), fileName, container: container || null, path: filePath, kind: pre.isPdf(fileName) ? 'pdf' : pre.isImg(fileName) ? 'image' : pre.isTabular(fileName) ? 'tabular' : 'other', status: 'queued', pages: [], docs: [] }; }

/* ------------------------------------------------------------ run */
async function run(job) {
  job.status = 'running'; emit(job, 'job', { status: 'running', units: job.units.map(publicUnit) });
  let i = 0; const workers = Array.from({ length: CONCURRENCY }, async () => { while (i < job.units.length) { const u = job.units[i++]; try { await processUnit(job, u); } catch (e) { setUnit(job, u, { status: 'failed', error: e.message }); } } });
  await Promise.all(workers);
  job.status = 'done'; job.summary = summarize(job); emit(job, 'job', { status: 'done', summary: job.summary });
}
function summarize(job) { const docs = job.units.flatMap((u) => u.docs); return { units: job.units.length, failedUnits: job.units.filter((u) => u.status === 'failed').length, docs: docs.length, clean: docs.filter((d) => d.validation && d.validation.errors === 0 && d.validation.newMasters === 0).length, needsReview: docs.filter((d) => !d.validation || d.validation.errors > 0 || d.validation.newMasters > 0).length, posted: docs.filter((d) => d.status === 'posted').length }; }

async function processUnit(job, unit) {
  const udir = path.join(job.dir, unit.id); fs.mkdirSync(udir, { recursive: true });
  setUnit(job, unit, { status: 'preprocessing', message: 'Preparing pages' });
  const rotate = Number(job.options.rotate || 0);
  if (unit.kind === 'image') {
    const img = await pre.prepareImage(unit.path, path.join(udir, 'p-1.jpg'), { rotate });
    unit.pages = [{ page: 1, path: img.path }]; unit.thumb = await pre.thumbnail(img.path, path.join(udir, 't-1.jpg'));
  } else if (unit.kind === 'pdf') {
    const { pages } = await pre.pdfInfo(unit.path); unit.pageCount = pages;
    const text = await pre.pdfText(unit.path); const cls = pre.classifyPdfText(text); unit.pdfClass = cls;
    const rendered = await pre.renderPdfPages(unit.path, path.join(udir, 'pages'));
    unit.pages = rendered.map((r) => ({ page: r.page, path: r.path }));
    unit.thumb = rendered[0] ? await pre.thumbnail(rendered[0].path, path.join(udir, 't-1.jpg')) : null;
    if (cls === 'digital' && !job.options.forceOcr) { // use embedded text, no OCR call
      for (const p of unit.pages) { p.text = await pre.pdfText(unit.path, p.page); p.engine = 'pdftotext'; }
    }
  } else if (unit.kind === 'tabular') {
    const { text } = P.readTabular(unit.path); unit.pages = [{ page: 1, path: null, text, engine: 'xlsx' }];
  } else { setUnit(job, unit, { status: 'skipped', message: 'Unsupported file type' }); return; }

  // OCR pages that have no text yet
  const need = unit.pages.filter((p) => p.text == null && p.path);
  if (need.length) {
    setUnit(job, unit, { status: 'ocr', message: `OCR ${need.length} page(s) via ${engine.OCR_ENGINE}` });
    const res = await engine.ocrPages(need, { contentType: job.options.contentType || 'mixed', onProgress: (m) => setUnit(job, unit, { message: m.message }) });
    res.forEach((r) => { const p = unit.pages.find((x) => x.page === r.page); if (p) { p.text = r.text; p.engine = r.engine; p.jobId = r.jobId; } });
  }
  // group pages → documents
  const groups = job.options.split === 'file' ? [unit.pages.map((_, i) => i)] : job.options.split === 'page' ? unit.pages.map((_, i) => [i]) : engine.groupPages(unit.pages);
  setUnit(job, unit, { status: 'structuring', message: `${groups.length} document(s) found in ${unit.pages.length} page(s)` });
  for (const g of groups) {
    const doc = { id: uuid().slice(0, 8), pages: g.map((i) => unit.pages[i].page), status: 'structuring' };
    unit.docs.push(doc);
    try { await buildDocument(job, unit, doc, g.map((i) => unit.pages[i])); } catch (e) { doc.status = 'failed'; doc.error = e.message; }
    emit(job, 'unit', { unit: publicUnit(unit) });
  }
  setUnit(job, unit, { status: 'done', message: `${unit.docs.length} document(s) ready` });
}

async function buildDocument(job, unit, doc, pages) {
  const text = pages.map((p) => p.text || '').join('\n\n---- page ----\n\n');
  const first = pages[0];
  if (first.path) doc.thumb = await pre.thumbnail(first.path, path.join(path.dirname(first.path), `t-doc-${doc.id}.jpg`));
  const batch = await P.createBatch({ user: job.user, source: { kind: 'intake', fileName: unit.fileName + (unit.pages.length > 1 ? ` [p${doc.pages[0]}${doc.pages.length > 1 ? '-' + doc.pages[doc.pages.length - 1] : ''}]` : ''), path: first.path || unit.path, container: unit.container, intakeId: job.id, unitId: unit.id, docId: doc.id, pageImages: pages.map((p) => p.path).filter(Boolean) } });
  batch.rawText = text; batch.pages = pages.map((p) => ({ page: p.page, content: p.text, engine: p.engine }));
  doc.batchId = batch.id;
  await P.detect(batch); doc.docType = batch.docType; doc.confidence = batch.detection?.confidence;
  await P.extract(batch);
  doc.party = batch.header.partyName || batch.header.party; doc.docNo = batch.header.docNo; doc.docDate = batch.header.docDate; doc.grandTotal = batch.header.grandTotal; doc.lines = batch.lines.length;
  await P.suggestMappings(batch);
  // auto-apply exact matches only; everything else is left for the user
  const auto = batch.mapItems.filter((i) => i.status === 'auto').map((i) => ({ id: i.id, action: 'map', selected: i.selected }));
  if (auto.length) await P.applyMapping(batch, auto);
  const v = await P.validate(batch); doc.validation = v.summary;
  batch.step = 'REVIEW'; await db.saveBatch(batch);
  doc.status = v.canContinue ? 'ready' : 'needs-review';
}

/* ------------------------------------------------------------ actions */
async function reprocessDoc(job, docId, { rotate = 0, split } = {}) {
  const unit = job.units.find((u) => u.docs.some((d) => d.id === docId)); if (!unit) throw new Error('doc not found');
  // simplest robust approach: re-run the whole unit with new options
  unit.docs = []; unit.pages = []; job.options = { ...job.options, rotate, split: split || job.options.split };
  await processUnit(job, unit); job.summary = summarize(job); emit(job, 'job', { status: job.status, summary: job.summary });
  return unit;
}
async function bulkPost(job, { onlyClean = true, approve = false }) {
  const results = [];
  for (const u of job.units) for (const d of u.docs) {
    if (!d.batchId || d.status === 'posted') continue;
    const b = await db.getBatch(d.batchId); if (!b) continue;
    try {
      if (onlyClean && !(b.validation?.canContinue)) { results.push({ doc: d.id, skipped: 'needs review' }); continue; }
      await P.relationships(b); await P.reconcile(b);
      if (!b.reconciliation.canPost) { results.push({ doc: d.id, skipped: 'reconciliation mismatch' }); d.status = 'needs-review'; continue; }
      const r = await P.post(b, { approve }); d.status = r.status; d.createdDocNo = r.createdDocNo; results.push({ doc: d.id, ...r });
    } catch (e) { results.push({ doc: d.id, error: e.message }); }
    emit(job, 'unit', { unit: publicUnit(u) });
  }
  job.summary = summarize(job); emit(job, 'job', { status: job.status, summary: job.summary });
  return results;
}

/* ------------------------------------------------------------ export */
async function exportRows(job) {
  const headers = [], lines = [];
  for (const u of job.units) for (const d of u.docs) {
    const b = d.batchId ? await db.getBatch(d.batchId) : null; if (!b) continue;
    headers.push({ intakeId: job.id, docId: d.id, batchId: b.id, file: u.fileName, pages: d.pages.join(','), status: d.status, docType: b.docType, confidence: d.confidence, ...b.header, createdDocNo: d.createdDocNo || null, errors: b.validation?.summary.errors, warnings: b.validation?.summary.warnings, newMasters: b.validation?.summary.newMasters });
    b.lines.forEach((l) => lines.push({ docId: d.id, batchId: b.id, file: u.fileName, docNo: b.header.docNo, party: b.header.partyName || b.header.party, ...l }));
  }
  return { headers, lines };
}

const publicJob = (j) => ({ id: j.id, status: j.status, createdAt: j.createdAt, options: j.options, summary: j.status === 'done' ? j.summary : summarize(j), units: j.units.map(publicUnit), error: j.error });
module.exports = { jobs, bus, createJob, reprocessDoc, bulkPost, exportRows, publicJob, WORK };
