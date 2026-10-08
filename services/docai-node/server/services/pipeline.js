/**
 * Universal Document Processing pipeline (spec §2):
 *  SOURCE → DETECT → EXTRACT → REVIEW → MAP → VALIDATE → CONVERT → RECONCILE → POST → RESULT
 *
 * Sarvam AI does reading (OCR) + structuring + type detection.
 * RetailCLIQ (this module + DB) owns master matching, validation, relationships, reconciliation, posting, audit.
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const XLSX = require('xlsx');
const docTypes = require('./documentTypes');
const db = require('./db');
const MOCK = process.env.DOCAI_MOCK === '1';
const engine = require('./ocrEngine');
const pre = require('./preprocess');
const sarvam = engine.LLM_ENGINE === 'sarvam' ? require('./sarvam') : null;

const STEPS = ['SOURCE', 'DETECT', 'EXTRACT', 'REVIEW', 'MAP', 'VALIDATE', 'CONVERT', 'RECONCILE', 'POST', 'RESULT'];

/* ======================================================== helpers */
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function similarity(a, b) { // token Jaccard + prefix bonus – cheap, good enough for master suggestions
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  const j = inter / (A.size + B.size - inter);
  return norm(a) === norm(b) ? 1 : norm(b).startsWith(norm(a)) || norm(a).startsWith(norm(b)) ? Math.max(j, 0.85) : j;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function validDate(y, m, d) { y = Number(y); m = Number(m); d = Number(d); if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null; const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCMonth() === m - 1 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; }
function isoDate(v) {
  if (!v) return null; const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return validDate(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})/); if (m) return validDate(m[3].length === 2 ? '20' + m[3] : m[3], m[2], m[1]);
  m = s.match(/^(\d{1,2})[\s\-\/.]*([A-Za-z]{3,9})[\s\-\/.,]*(\d{2,4})/); if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] || (m && MONTHS[m[2].slice(0, 3).toLowerCase()])) return validDate(m[3].length === 2 ? '20' + m[3] : m[3], MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  const d = new Date(s); if (isNaN(d)) return null; const iso = d.toISOString().slice(0, 10); return validDate(iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10));
}
function parseStructured(text) { try { const j = JSON.parse(text); return j && typeof j === 'object' && (j.header || j.lines) ? j : null; } catch { return null; } }
function audit(batch, event, detail) { batch.audit.push({ at: new Date().toISOString(), user: batch.user, event, detail }); }

/* ======================================================== 1. SOURCE */
async function createBatch({ user = 'admin', source, tenantDb, clientId }) {
  const batch = { 
    id: uuid(), user, createdAt: new Date().toISOString(), status: 'draft', step: 'SOURCE', source, 
    docType: null, detection: null, rawText: null, extraction: null, header: {}, lines: [], 
    corrections: [], mapping: {}, validation: null, relationship: null, reconciliation: null, 
    plan: null, result: null, audit: [],
    // Tenant context (populated from x-client-id header)
    tenantDb: tenantDb || process.env.DB_NAME || 'RC26erp_dev',
    clientId: clientId || null,
  };
  audit(batch, 'SOURCE', { kind: source.kind, fileName: source.fileName || null, tenantDb: batch.tenantDb });
  return db.saveBatch(batch);
}

/** Text from tabular / text sources that do not need OCR */
function readTabular(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const text = rows.map((r) => r.join(' | ')).join('\n');
  return { text, rows };
}
async function readPdfText(filePath) {
  try { const pdfParse = require('pdf-parse'); const out = await pdfParse(fs.readFileSync(filePath)); return (out.text || '').trim(); } catch { return ''; }
}

/** Read an uploaded image / PDF into page texts using the configured OCR engine (with preprocessing). */
async function readDocumentFile(src, batch, onProgress) {
  const dir = path.join(path.dirname(src.path), 'pp-' + batch.id.slice(0, 8)); fs.mkdirSync(dir, { recursive: true });
  let pages = [];
  if (pre.isPdf(src.fileName || '')) {
    onProgress && onProgress({ stage: 'read', message: 'Reading PDF text layer…' });
    const text = await pre.pdfText(src.path); const cls = pre.classifyPdfText(text); batch.pdfClass = cls;
    const { pages: pageCount } = await pre.pdfInfo(src.path); batch.pageCount = pageCount;
    // previews are optional (need poppler); never block on them
    try { if (await pre.hasTool('pdftoppm')) { const rendered = await pre.renderPdfPages(src.path, path.join(dir, 'pages')); batch.source.pageImages = rendered.map((r) => r.path); } } catch {}
    if (cls === 'digital') {
      onProgress && onProgress({ stage: 'read', message: `Digital PDF (${pageCount} page(s)) – no OCR needed` });
      pages = []; for (let p = 1; p <= pageCount; p++) pages.push({ page: p, content: await pre.pdfText(src.path, p), engine: 'pdftext' });
      if (!pages.some((p) => p.content.trim())) pages = [{ page: 1, content: text, engine: 'pdftext' }];
    } else {
      onProgress && onProgress({ stage: 'ocr', message: `${cls === 'garbled' ? 'Broken font encoding' : 'Scanned PDF'} – OCR ${pageCount} page(s) via ${engine.OCR_ENGINE}` });
      const res = await engine.ocrPdf(src.path, dir, { contentType: src.contentType || 'mixed', onProgress: (m) => onProgress && onProgress({ stage: 'ocr', ...m }) });
      pages = res.map((r) => ({ page: r.page, content: r.text, engine: r.engine, jobId: r.jobId })); batch.ocrJobId = res[0]?.jobId;
    }
  } else if (pre.isImg(src.fileName || '')) {
    const img = await pre.prepareImage(src.path, path.join(dir, 'p-1.jpg'), { rotate: Number(src.rotate || 0) });
    batch.source.pageImages = [img.path];
    onProgress && onProgress({ stage: 'ocr', message: `OCR image via ${engine.OCR_ENGINE}` });
    const res = await engine.ocrPages([{ page: 1, path: img.path }], { contentType: src.contentType || 'mixed', onProgress: (m) => onProgress && onProgress({ stage: 'ocr', ...m }) });
    pages = res.map((r) => ({ page: r.page, content: r.text, engine: r.engine, jobId: r.jobId })); batch.ocrJobId = res[0]?.jobId;
  } else { pages = [{ page: 1, content: fs.readFileSync(src.path, 'utf8'), engine: 'raw' }]; }
  return { text: pages.map((p) => p.content).join('\n\n---- page ----\n\n'), pages };
}

/* ======================================================== background step runner (progress + errors survive HTTP timeouts) */
const RUNNING = new Map(); // batchId → Promise
function progressOf(batch) { return batch.progress || { running: false, done: false, step: null, stage: null, message: null, log: [], error: null }; }
function runStep(batch, stepName, fn) {
  if (RUNNING.has(batch.id)) return progressOf(batch);
  const pr = { running: true, done: false, step: stepName, stage: 'start', message: `Starting ${stepName}…`, log: [], error: null, startedAt: new Date().toISOString() };
  batch.progress = pr;
  const onProgress = (m) => { pr.stage = m.stage || pr.stage; pr.message = m.message || pr.message; pr.log.push({ at: new Date().toISOString(), stage: pr.stage, message: pr.message }); if (pr.log.length > 200) pr.log.shift(); };
  const task = (async () => {
    try { await fn(onProgress); pr.done = true; pr.message = `${stepName} finished`; }
    catch (e) { pr.error = e.message; pr.errorDetail = (e.body && JSON.stringify(e.body).slice(0, 500)) || null; pr.message = 'Failed: ' + e.message; console.error(`[pipeline] ${stepName} failed for ${batch.id}:`, e); }
    finally { pr.running = false; pr.finishedAt = new Date().toISOString(); RUNNING.delete(batch.id); await db.saveBatch(batch).catch(() => {}); }
  })();
  RUNNING.set(batch.id, task);
  return pr;
}

/* ======================================================== 2. DETECT */
async function detect(batch, onProgress) {
  const src = batch.source;
  let text = batch.rawText; let pages = batch.pages;
  if (!text) {
    // ── Tally XML / EDI source: parse directly, no OCR ──────────────────
    if (src.kind === 'text' || src.kind === 'api' || src.kind === 'manual') {
      text = src.text;
      // Auto-detect Tally XML
      if (text && /<TALLYMESSAGE/i.test(text)) {
        src._isTallyXml = true;
        onProgress && onProgress({ stage: 'detect', message: 'Tally XML detected — parsing structure…' });
      }
    }
    // ── Bank statement Excel/CSV or digital PDF: smart parse, no OCR ──
    else if (src.kind === 'file' && /\.(xlsx|xls|csv|tsv)$/i.test(src.fileName || '')) {
      onProgress && onProgress({ stage: 'detect', message: 'Parsing tabular file…' });
      const t = readTabular(src.path); text = t.text; batch.tabularRows = t.rows;
      // Try bank statement parser on the text
      try {
        const { parseTransactionText, extractBstHeader } = require('./bankParser');
        const bstHeader = extractBstHeader(text, src.fileName || '');
        if (bstHeader.bankName && bstHeader.bankName !== 'Unknown Bank') {
          batch.bstParsed = { header: bstHeader, lines: parseTransactionText(text), source: 'excel-direct' };
          src._isBankStmt = true;
        }
      } catch {}
    }
    else if (src.kind === 'file' && /\.pdf$/i.test(src.fileName || '')) {
      // Try bank statement PDF direct parse first (no OCR cost)
      const bankHint = src.bankName || '';
      onProgress && onProgress({ stage: 'read', message: 'Checking PDF text layer…' });
      try {
        const bankParser = require('./bankParser');
        const bst = await bankParser.parseBankStatement(src.path, bankHint);
        if (!bst.needsOcr && bst.lines.length >= 2) {
          console.log(`[pipeline] BST smart-parse: ${bst.lines.length} transactions from PDF text layer`);
          batch.bstParsed = bst;
          src._isBankStmt = true;
          text = bst.rawText || bst.lines.map(l => `${l.txDate} | ${l.description} | ${l.debit||''} | ${l.credit||''} | ${l.balance||''}`).join('\n');
          pages = [{ page: 1, content: text, engine: 'pdf-direct' }];
        } else {
          // Scanned PDF — needs OCR
          const r = await readDocumentFile(src, batch, onProgress);
          text = r.text; pages = r.pages;
        }
      } catch {
        const r = await readDocumentFile(src, batch, onProgress);
        text = r.text; pages = r.pages;
      }
    }
    else {
      const r = await readDocumentFile(src, batch, onProgress);
      text = r.text; pages = r.pages;
    }
    batch.rawText = text; batch.pages = pages || null;
  }

  onProgress && onProgress({ stage: 'detect', message: 'Identifying document type…' });
  let det;

  // Tally XML — auto-classify without AI
  if (src._isTallyXml && text) {
    const { parseTallyXml } = require('./tallyParser');
    const vouchers = parseTallyXml(text);
    if (vouchers.length > 0) {
      batch.tallyVouchers = vouchers;
      batch.structured = vouchers[0]; // Use first voucher for single-doc flow
      const docType = vouchers[0].docType || 'PT_PUR';
      det = { documentType: docType, confidence: 0.97, reasons: [`Tally XML voucher type: ${vouchers[0].header?.docNo || docType}`], alternatives: [], engine: 'tally-xml' };
    }
  }

  if (!det) {
    const structured = parseStructured(text);
    if (structured && (src.kind === 'api' || src.kind === 'manual')) {
      batch.structured = structured;
      det = { documentType: structured.documentType || 'OTHER', confidence: structured.documentType ? 1 : 0.5, reasons: ['Structured payload supplied by ' + src.kind], alternatives: [] };
    } else {
      // For bank statements already parsed, use fast detection
      if (src._isBankStmt || batch.bstParsed) {
        det = { documentType: 'BST', confidence: 0.96, reasons: ['Bank statement parsed directly from PDF/Excel text layer — no OCR required'], alternatives: [{ documentType: 'BRS', confidence: 0.08 }], engine: 'bank-parser' };
      } else {
        det = await engine.detect(text || '', src.fileName || '(typed)');
      }
    }
  }

  if (!docTypes.get(det.documentType)) det.documentType = 'OTHER';
  batch.detection = det; batch.docType = det.documentType; batch.step = 'DETECT';
  audit(batch, 'DETECT', { documentType: det.documentType, confidence: det.confidence, engine: det.engine });
  await db.saveBatch(batch);
  return batch;
}
async function setDocType(batch, code) {
  if (!docTypes.get(code)) throw new Error('Unknown document type ' + code);
  audit(batch, 'DOCTYPE_CHANGED', { from: batch.docType, to: code });
  batch.docType = code; return db.saveBatch(batch);
}

/* ======================================================== 3. EXTRACT */
async function extract(batch, onProgress) {
  const type = docTypes.get(batch.docType);
  const schema = docTypes.schemaFor(type.code);
  let data;

  // ── Tally XML pre-parsed ──────────────────────────────────────────────
  if (batch.structured && batch.source?._isTallyXml) {
    data = batch.structured;
    onProgress && onProgress({ stage: 'extract', message: 'Using Tally XML parsed data (no AI needed)' });
  }
  // ── Bank Statement: use smart-parsed data ─────────────────────────────
  else if (batch.docType === 'BST' && batch.bstParsed) {
    const bst = batch.bstParsed;
    onProgress && onProgress({ stage: 'extract', message: `Bank statement: ${bst.lines.length} transactions via ${bst.source} (no OCR)` });
    data = { header: bst.header, lines: bst.lines, confidence: { header: 0.95, lines: 0.90, engine: bst.source } };
  }
  // ── Pre-structured payload ─────────────────────────────────────────────
  else if (batch.structured) {
    data = batch.structured;
  }
  // ── Sarvam schema extract mode ────────────────────────────────────────
  else if (engine.LLM_ENGINE === 'sarvam' && process.env.SARVAM_MODE === 'extract' && batch.source.path && /\.(pdf|png|jpe?g|zip)$/i.test(batch.source.fileName || '')) {
    onProgress && onProgress({ stage: 'extract', message: 'Sarvam Doc-AI schema extraction…' });
    await engine.throttle();
    const out = await sarvam.extractWithSchema(batch.source.path, schema, { onProgress: (st) => onProgress && onProgress({ stage: 'extract', message: `Sarvam job ${st.status}` }) });
    data = { ...out.result, confidence: out.annotations, jobId: out.jobId };
  }
  // ── Standard AI structuring (with Gemini fallback) ────────────────────
  else {
    onProgress && onProgress({ stage: 'extract', message: `Structuring with ${engine.LLM_ENGINE} (fallback: Gemini)…` });
    data = await engine.structure(batch.rawText || '', type.code, batch.source.fileName);
  }
  const header = {}; for (const f of type.headerFields) header[f.key] = coerce(f, data.header?.[f.key]);
  const lines = (data.lines || []).map((l, i) => { const o = { lineNo: i + 1 }; for (const f of type.lineFields) if (f.key !== 'lineNo') o[f.key] = coerce(f, l[f.key]); return o; });
  // derive missing amounts
  for (const l of lines) { if (l.amount == null && l.qty != null && l.rate != null) l.amount = r2(l.qty * l.rate - (l.discountAmt || 0)); if (l.taxAmt == null && l.taxPct != null && l.amount != null) l.taxAmt = r2(l.amount * l.taxPct / 100); }
  batch.extraction = { raw: data, confidence: data.confidence || null, at: new Date().toISOString() };
  batch.header = header; batch.lines = lines; batch.step = 'EXTRACT';
  audit(batch, 'EXTRACT', { lines: lines.length, ocr: engine.OCR_ENGINE, llm: engine.LLM_ENGINE, mode: process.env.SARVAM_MODE || 'digitise+llm' });
  await db.saveBatch(batch);
  return batch;
}
function coerce(f, v) {
  if (v === undefined) v = null;
  if (v != null && typeof v === 'object') v = v.value ?? v.text ?? JSON.stringify(v);
  switch (f.type) { case 'date': return isoDate(v); case 'number': case 'money': case 'int': return num(v); default: return v == null ? (f.default ?? null) : String(v).trim(); }
}

/* ======================================================== 4. REVIEW (user edits) */
async function applyReview(batch, { header, lines }) {
  const changes = [];
  if (header) for (const [k, v] of Object.entries(header)) if (JSON.stringify(batch.header[k]) !== JSON.stringify(v)) { changes.push({ scope: 'header', field: k, from: batch.header[k], to: v }); batch.header[k] = v; }
  if (lines) {
    lines.forEach((l, i) => { const cur = batch.lines[i] || {}; for (const [k, v] of Object.entries(l)) if (JSON.stringify(cur[k]) !== JSON.stringify(v)) changes.push({ scope: 'line', line: i + 1, field: k, from: cur[k], to: v }); });
    batch.lines = lines.map((l, i) => ({ ...l, lineNo: i + 1 }));
  }
  batch.corrections.push(...changes.map((c) => ({ ...c, at: new Date().toISOString(), user: batch.user })));
  batch.step = 'REVIEW'; audit(batch, 'REVIEW', { changes: changes.length });
  return db.saveBatch(batch);
}

/* ======================================================== 5. MAP */
async function suggestMappings(batch) {
  const type = docTypes.get(batch.docType);
  const items = {};
  const partyMaster = type.headerFields.find((f) => f.key === 'party')?.master;
  const want = (master, key, value, scope, line) => { if (value == null || value === '') return; const id = `${scope}:${line ?? ''}:${key}`; items[id] = { id, master, scope, line, field: key, value: String(value) }; };
  for (const f of type.headerFields) if (f.type === 'master' && f.master) want(f.master, f.key, batch.header[f.key], 'header');
  batch.lines.forEach((l, i) => {
    want('item', 'description', l.description, 'line', i + 1);
    if (l.uom) want('uom', 'uom', l.uom, 'line', i + 1);
    if (l.taxPct != null) want('tax', 'taxPct', l.taxPct, 'line', i + 1);
    if (l.account) want('account', 'account', l.account, 'line', i + 1);
    if (l.batch) want('batch', 'batch', l.batch, 'line', i + 1);
  });
  const cache = {};
  for (const it of Object.values(items)) {
    const master = it.master; cache[master] = cache[master] || (await db.allMasters(master, batch.tenantDb));
    const line = it.line ? batch.lines[it.line - 1] : null;
    let cands = cache[master].map((m) => ({ ...m, score: score(master, it.value, m, line, batch.header) })).filter((c) => c.score > 0.2).sort((a, b) => b.score - a.score).slice(0, 5);
    const prev = batch.mapping[it.id];
    const best = cands[0];
    it.candidates = cands;
    it.status = prev?.status || (best && best.score >= 0.99 ? 'auto' : best && best.score >= 0.6 ? 'suggested' : 'unmatched');
    it.selected = prev?.selected || (it.status === 'auto' ? best.code : null);
    it.action = prev?.action || (it.status === 'auto' ? 'map' : null); // map | create | skip | later
    batch.mapping[it.id] = { status: it.status, selected: it.selected, action: it.action, master, value: it.value };
  }
  batch.mapItems = Object.values(items); batch.step = 'MAP';
  await db.saveBatch(batch);
  return batch.mapItems;
}
function score(master, value, m, line, header) {
  const v = String(value);
  if (master === 'item') {
    const bc = line?.barcode && String(line.barcode);
    if (bc && ((m.barcode && bc === String(m.barcode)) || (m.oemCode && bc === String(m.oemCode)) || (m.artCode && bc === String(m.artCode)))) return 1;
    if (line?.itemCode && m.code && (norm(line.itemCode) === norm(m.code) || (m.oemCode && norm(line.itemCode) === norm(m.oemCode)))) return 1;
    if (line?.styleNo && m.style && norm(line.styleNo) === norm(m.style)) return Math.max(0.9, similarity(v, m.name));
    return similarity(v, m.name);
  }
  if (master === 'tax') return m.pct != null && Number(v) === Number(m.pct) ? 1 : 0;
  if (master === 'uom') return norm(v) === norm(m.code) || norm(v) === norm(m.name) ? 1 : similarity(v, m.name) * 0.8;
  if ((master === 'supplier' || master === 'customer') && header?.partyGstin && m.gstin && header.partyGstin === m.gstin) return 1;
  return Math.max(similarity(v, m.name), norm(v) === norm(m.code) ? 1 : 0);
}
async function applyMapping(batch, decisions) {
  // decisions: [{ id, action: map|create|skip|later, selected?, create?:{...} }]
  for (const d of decisions) {
    const it = batch.mapItems.find((x) => x.id === d.id); if (!it) continue;
    const m = batch.mapping[d.id];
    if (d.action === 'create') { const row = await db.createMaster(it.master, { name: it.value, ...(d.create || {}) }); m.selected = row.code; m.created = row; m.status = 'created'; }
    else if (d.action === 'map') { m.selected = d.selected; m.status = 'mapped'; }
    else if (d.action === 'skip') { m.selected = null; m.status = 'skipped'; }
    else if (d.action === 'later') { m.selected = null; m.status = 'later'; }
    m.action = d.action; it.status = m.status; it.selected = m.selected; it.action = d.action;
    audit(batch, 'MAP', { id: d.id, action: d.action, selected: m.selected });
    // write back resolved codes into header/lines
    if (m.selected) {
      if (it.scope === 'header') { batch.header[it.field] = m.selected; if (it.field === 'party') batch.header.partyName = it.value; }
      else { const l = batch.lines[it.line - 1]; if (it.master === 'item') l.itemCode = m.selected; else if (it.master === 'uom') l.uom = m.selected; else if (it.master === 'tax') l.taxCode = m.selected; else if (it.master === 'account') l.accountCode = m.selected; else if (it.master === 'batch') l.batchCode = m.selected; }
    }
  }
  return db.saveBatch(batch);
}

/* ======================================================== 6. VALIDATE */
async function validate(batch) {
  const type = docTypes.get(batch.docType); const h = batch.header;
  const issues = []; const push = (level, scope, field, message, line) => issues.push({ level, scope, field, message, line });
  // mandatory
  for (const k of type.requiredFields) if (h[k] == null || h[k] === '') push('error', 'header', k, `${type.headerFields.find((f) => f.key === k)?.label || k} is required`);
  // dates
  if (h.docDate) { const d = new Date(h.docDate); const today = new Date(); if (isNaN(d)) push('error', 'header', 'docDate', 'Invalid date'); else if (d > today) push('warning', 'header', 'docDate', 'Document date is in the future'); else if ((today - d) / 86400000 > 180) push('warning', 'header', 'docDate', 'Document is older than 180 days'); }
  // duplicate
  const dup = await db.findDuplicate(type.code, h);
  if (dup) push('error', 'header', 'docNo', `Duplicate: ${type.name} ${h.docNo} for this party already posted (${dup.createdDocNo || dup.CreatedDocNo})`);
  // masters
  for (const it of batch.mapItems || []) { const m = batch.mapping[it.id]; if (!m.selected && m.status !== 'skipped') push(m.status === 'later' ? 'warning' : 'new-master', it.scope, it.field, `${it.master} "${it.value}" is not mapped`, it.line); }
  // lines
  if (!batch.lines.length) push('error', 'lines', null, 'No line items extracted');
  batch.lines.forEach((l, i) => {
    const n = i + 1;
    if (type.category !== 'accounting') {
      if (l.qty == null || l.qty === 0) push('error', 'line', 'qty', 'Quantity missing/zero', n);
      if (l.qty != null && l.qty < 0 && type.code !== 'SA') push('error', 'line', 'qty', 'Negative quantity', n);
      if (l.rate == null) push(type.code === 'GRN' || type.code === 'ST' ? 'warning' : 'error', 'line', 'rate', 'Rate missing', n);
      if (l.qty != null && l.rate != null && l.amount != null) { const exp = r2(l.qty * l.rate - (l.discountAmt || 0)); if (Math.abs(exp - l.amount) > 1) push('warning', 'line', 'amount', `Qty×Rate = ${exp} but amount is ${l.amount}`, n); }
      if (!l.uom) push('warning', 'line', 'uom', 'UOM missing', n);
      if (l.taxPct != null && ![0, 5, 12, 18, 28].includes(Number(l.taxPct))) push('warning', 'line', 'taxPct', `Unusual GST rate ${l.taxPct}%`, n);
      if (l.expiry && new Date(l.expiry) < new Date()) push('error', 'line', 'expiry', 'Item already expired', n);
    } else {
      if (!l.debit && !l.credit) push('error', 'line', 'debit', 'Debit or credit required', n);
    }
  });
  if (type.category === 'accounting') { const dr = batch.lines.reduce((s, l) => s + (l.debit || 0), 0), cr = batch.lines.reduce((s, l) => s + (l.credit || 0), 0); if (Math.abs(dr - cr) > 0.5) push('error', 'lines', null, `Debits ${r2(dr)} ≠ Credits ${r2(cr)}`); }
  // business rule: approval threshold
  if (type.approval?.required && type.approval.threshold && (h.grandTotal || 0) > type.approval.threshold) push('info', 'header', 'grandTotal', `Above ₹${type.approval.threshold.toLocaleString('en-IN')} – approval workflow will apply`);
  const summary = { errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level === 'warning').length, newMasters: issues.filter((i) => i.level === 'new-master').length, info: issues.filter((i) => i.level === 'info').length };
  batch.validation = { issues, summary, canContinue: summary.errors === 0 && summary.newMasters === 0, at: new Date().toISOString() };
  batch.step = 'VALIDATE'; audit(batch, 'VALIDATE', summary);
  await db.saveBatch(batch);
  return batch.validation;
}

/* ======================================================== 7. CONVERT / RELATIONSHIP */
async function relationships(batch) {
  const type = docTypes.get(batch.docType);
  const posted = db.STORE.posted;
  const options = [];
  for (const rel of type.relationships) {
    if (rel.against) {
      const relType = docTypes.get(rel.against);
      // find candidate source documents: same party, ref number match first
      const cands = posted.filter((p) => p.docType === rel.against && (!batch.header.party || p.header.party === batch.header.party))
        .map((p) => ({ docNo: p.createdDocNo, sourceDocNo: p.header.docNo, date: p.header.docDate, total: p.header.grandTotal, match: batch.header.refNo && (p.header.docNo === batch.header.refNo || p.createdDocNo === batch.header.refNo) ? 'reference' : 'party' }));
      options.push({ mode: 'against', target: rel.against, label: `Link against ${relType.name}`, candidates: cands.slice(0, 10) });
    }
    if (rel.creates) options.push({ mode: 'creates', target: rel.creates, label: `Also create ${docTypes.get(rel.creates).name}`, when: rel.when || null });
  }
  options.unshift({ mode: 'standalone', target: type.code, label: `Create ${type.name} (standalone)` });
  batch.relationship = batch.relationship || { mode: 'standalone', target: type.code, linkedDocNo: null, autoCreate: [] };
  batch.relationshipOptions = options; batch.step = 'CONVERT';
  await db.saveBatch(batch);
  return { options, selected: batch.relationship };
}
async function setRelationship(batch, rel) { batch.relationship = { ...batch.relationship, ...rel }; audit(batch, 'CONVERT', rel); return db.saveBatch(batch); }

/* ======================================================== 8. RECONCILE */
async function reconcile(batch) {
  const type = docTypes.get(batch.docType); const h = batch.header; const L = batch.lines; const checks = [];
  const add = (key, label, expected, actual, tol = 1, critical = true) => { const diff = r2((actual ?? 0) - (expected ?? 0)); checks.push({ key, label, expected: r2(expected ?? 0), actual: r2(actual ?? 0), diff, ok: Math.abs(diff) <= tol, critical }); };
  if (type.category !== 'accounting') {
    const lineSum = L.reduce((s, l) => s + (l.amount || 0), 0);
    const lineTax = L.reduce((s, l) => s + (l.taxAmt || 0), 0);
    add('subtotal', 'Σ line amounts = Sub Total', lineSum, h.subTotal ?? lineSum);
    const gstParts = (h.cgst || 0) + (h.sgst || 0) + (h.igst || 0);
    const taxTotal = h.taxTotal ?? (gstParts || null) ?? lineTax;
    add('tax', 'Σ line tax = Tax Total', lineTax, taxTotal, 2, false);
    if (h.taxTotal != null && gstParts) add('gst-split', 'CGST + SGST + IGST = Tax Total', gstParts, h.taxTotal, 1, false);
    const expectedGrand = (h.subTotal ?? lineSum) - (h.discountTotal || 0) + taxTotal + (h.charges || 0) + (h.tcs || 0) + (h.roundOff || 0);
    add('grand', 'Sub Total − Discount + Tax + Charges + Round Off = Grand Total', expectedGrand, h.grandTotal);
    // stock impact
    const qty = L.reduce((s, l) => s + (l.qty || 0), 0);
    checks.push({ key: 'stock', label: `Stock impact (${type.inventoryImpact})`, expected: qty, actual: qty, diff: 0, ok: true, critical: false, info: `${L.length} items, ${qty} units, value ₹${r2(lineSum).toLocaleString('en-IN')}` });
    // against-document quantity reconciliation
    if (batch.relationship?.mode === 'against' && batch.relationship.linkedDocNo) {
      const src = db.STORE.posted.find((p) => p.createdDocNo === batch.relationship.linkedDocNo);
      if (src) {
        const srcQty = src.lines.reduce((s, l) => s + (l.qty || 0), 0);
        add('qty-vs-source', `Qty vs ${src.docType} ${src.createdDocNo}`, srcQty, qty, 0.001, true);
        add('amount-vs-source', `Amount vs ${src.docType} ${src.createdDocNo}`, src.header.grandTotal, h.grandTotal, 1, false);
      }
    }
  } else {
    const dr = L.reduce((s, l) => s + (l.debit || 0), 0), cr = L.reduce((s, l) => s + (l.credit || 0), 0);
    add('drcr', 'Σ Debit = Σ Credit', dr, cr, 0.5);
    add('amount', 'Voucher amount = Σ Debit', dr, h.grandTotal);
  }
  const unresolved = checks.filter((c) => !c.ok && c.critical);
  batch.reconciliation = { checks, canPost: unresolved.length === 0, overrides: batch.reconciliation?.overrides || [], at: new Date().toISOString() };
  batch.step = 'RECONCILE'; audit(batch, 'RECONCILE', { failed: checks.filter((c) => !c.ok).map((c) => c.key) });
  await db.saveBatch(batch);
  return batch.reconciliation;
}
async function overrideCheck(batch, key, reason) {
  const c = batch.reconciliation?.checks.find((x) => x.key === key); if (!c) throw new Error('No such check');
  c.ok = true; c.overridden = true; c.reason = reason; batch.reconciliation.overrides.push({ key, reason, at: new Date().toISOString(), user: batch.user });
  batch.reconciliation.canPost = batch.reconciliation.checks.every((x) => x.ok || !x.critical);
  audit(batch, 'RECONCILE_OVERRIDE', { key, reason }); return db.saveBatch(batch);
}

/* ======================================================== 9. POST */
function postingPlan(batch) {
  const type = docTypes.get(batch.docType);
  const h = batch.header;
  const plan = { documentType: type.name, transactions: type.posting.map((p) => ({ name: p })), inventoryImpact: type.inventoryImpact, accountingImpact: type.accountingImpact, taxImpact: type.taxImpact, approvalRequired: !!(type.approval?.required && (!type.approval.threshold || (h.grandTotal || 0) > type.approval.threshold)), linked: batch.relationship, summary: { party: h.partyName || h.party, docNo: h.docNo, docDate: h.docDate, lines: batch.lines.length, grandTotal: h.grandTotal } };
  if (batch.relationship?.autoCreate?.length) for (const c of batch.relationship.autoCreate) plan.transactions.push({ name: `${docTypes.get(c)?.name || c} (auto-created from this document)` });
  batch.plan = plan; return plan;
}
async function post(batch, { approve = false } = {}) {
  if (!batch.validation?.canContinue) throw new Error('Validation has unresolved errors');
  if (!batch.reconciliation?.canPost) throw new Error('Reconciliation has unresolved critical mismatches');
  const plan = postingPlan(batch);
  if (plan.approvalRequired && !approve) {
    batch.status = 'pending-approval'; batch.step = 'POST'; audit(batch, 'SUBMIT_FOR_APPROVAL', { grandTotal: batch.header.grandTotal });
    batch.result = { status: 'pending-approval', batchId: batch.id, message: 'Submitted for approval. Posting will happen once approved.' };
    await db.saveBatch(batch); return batch.result;
  }
  const rec = await db.postDocument(batch, plan);
  batch.status = 'posted'; batch.step = 'RESULT';
  batch.result = { status: 'posted', batchId: batch.id, createdDocNo: rec.createdDocNo, postedAt: rec.postedAt, postingStatus: 'Posted', stockUpdated: plan.inventoryImpact !== 'none', accountingPosted: plan.accountingImpact !== 'none', taxPosted: plan.taxImpact !== 'none', related: batch.relationship?.linkedDocNo ? [batch.relationship.linkedDocNo] : [], transactions: plan.transactions, corrections: batch.corrections.length, validation: batch.validation.summary, user: batch.user };
  audit(batch, 'POST', { createdDocNo: rec.createdDocNo });
  await db.saveBatch(batch); return batch.result;
}

module.exports = { STEPS, runStep, progressOf, readDocumentFile, createBatch, detect, setDocType, extract, applyReview, suggestMappings, applyMapping, validate, relationships, setRelationship, reconcile, overrideCheck, postingPlan, post, readTabular };
