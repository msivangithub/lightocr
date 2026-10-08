const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const docTypes = require('../services/documentTypes');
const db = require('../services/db');
const P = require('../services/pipeline');
const erp = require('../services/erpMapper');

const router = express.Router();
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (_, f, cb) => cb(null, `${Date.now()}-${f.originalname.replace(/[^\w.\-]+/g, '_')}`) }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 200) * 1024 * 1024 },
  fileFilter: (_, f, cb) => cb(null, /\.(pdf|png|jpe?g|webp|xlsx|xls|csv|tsv|txt|zip)$/i.test(f.originalname)),
});

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(e.status || 400).json({ error: e.message }); });
async function loadBatch(req) { const b = await db.getBatch(req.params.id); if (!b) { const e = new Error('Batch not found'); e.status = 404; throw e; } return b; }
const slim = (b) => { const { mapItems, relationshipOptions, ...rest } = b; return { ...rest, mapItems: mapItems || [], relationshipOptions: relationshipOptions || [], rawText: b.rawText ? b.rawText.slice(0, 20000) : null }; };

/* ---- meta ---- */
const engine = require('../services/ocrEngine');
router.get('/health', (_, res) => res.json({ ok: true, mock: process.env.DOCAI_MOCK === '1', ocr: engine.OCR_ENGINE, llm: engine.LLM_ENGINE, db: db.isReady(), sarvam: process.env.DOCAI_MOCK === '1' ? 'mock' : (process.env.SARVAM_API_KEY ? 'configured' : 'missing-key'), gemini: process.env.GEMINI_API_KEY ? 'configured' : 'not-set', tesseract: 'configured', lightOcr: 'configured', mode: process.env.SARVAM_MODE || 'digitise+llm', fallback: '5-tier: light-ocr→tesseract→sarvam→gemini→heuristic', minConfidence: Number(process.env.OCR_MIN_CONFIDENCE || 0.60), steps: P.STEPS }));
router.get('/doc-types', (_, res) => res.json(docTypes.list()));
/** Setup diagnostics: 5-tier fallback chain */
router.get('/diag', wrap(async (_, res) => {
  const pre = require('../services/preprocess');
  const out = { node: process.version, mock: process.env.DOCAI_MOCK === '1', ocrEngine: engine.OCR_ENGINE, llmEngine: engine.LLM_ENGINE, sarvamMode: process.env.SARVAM_MODE || 'digitise+llm', fallbackChain: '⚡ light-OCR → 🔡 Tesseract → 🤖 Sarvam AI → ✨ Google Gemini → 📐 Heuristic', minConfidence: Number(process.env.OCR_MIN_CONFIDENCE || 0.60), db: db.isReady() ? 'connected' : 'not connected', tools: await pre.toolReport(), uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads') };
  if (engine.OCR_ENGINE === 'sarvam' || engine.LLM_ENGINE === 'sarvam') { try { out.sarvam = await require('../services/sarvam').ping(); } catch (e) { out.sarvam = { error: e.message }; } }
  if (process.env.GEMINI_API_KEY) { try { out.gemini = await require('../services/googleOcr').ping(); } catch (e) { out.gemini = { error: e.message }; } }
  else { out.gemini = { key: false, status: 'GEMINI_API_KEY not set' }; }
  try { out.tesseract = await require('../services/tesseractOcr').ping(); } catch (e) { out.tesseract = { ok: false, status: e.message }; }
  try { out.lightOcr = await require('../services/lightOcrService').ping(); } catch (e) { out.lightOcr = { ok: false, status: e.message }; }
  out.ok = !!(out.lightOcr?.ok || out.tesseract?.ok || out.sarvam?.chatOk || out.gemini?.ok);
  out.hints = [];
  if (!out.lightOcr?.ok) out.hints.push('light-OCR (PP-OCRv6) not loading — check models/light-ocr/ directory.');
  if (!out.tesseract?.ok) out.hints.push('Tesseract not installed — run: apt-get install -y tesseract-ocr');
  if (!out.gemini?.ok) out.hints.push('Gemini fallback not available — set GEMINI_API_KEY.');
  if (!out.tools.pdftoppm) out.hints.push('poppler (pdftoppm) not found — install: apt-get install poppler-utils');
  res.json(out);
}));
router.post('/doc-types', (req, res) => res.json(docTypes.upsert(req.body)));
router.get('/masters/:master', wrap(async (req, res) => res.json(await db.searchMaster(req.params.master, req.query.q || '', Number(req.query.limit || 50), req.tenantDb))));
router.post('/masters/:master', wrap(async (req, res) => res.json(await db.createMaster(req.params.master, req.body, req.tenantDb))));

/* ---- batches ---- */
router.get('/batches', wrap(async (_, res) => res.json(await db.listBatches())));
router.get('/batches/:id', wrap(async (req, res) => res.json(slim(await loadBatch(req)))));
router.get('/batches/:id/file', wrap(async (req, res) => { const b = await loadBatch(req); if (!b.source?.path) return res.status(404).end(); res.sendFile(b.source.path); }));

/* 1. SOURCE */
router.post('/batches', upload.single('file'), wrap(async (req, res) => {
  const user = req.body.user || req.headers['x-user'] || 'admin';
  const tenantDb = req.tenantDb || process.env.DB_NAME || 'RC26erp_dev';
  const clientId = req.tenantInfo?.clientId || null;
  let source;
  if (req.file) source = { kind: req.body.kind || 'file', fileName: req.file.originalname, path: req.file.path, size: req.file.size, mime: req.file.mimetype, contentType: req.body.contentType || 'printed' };
  else if (req.body.text) source = { kind: req.body.kind || 'text', fileName: req.body.fileName || null, text: req.body.text };
  else if (req.body.payload) source = { kind: 'api', fileName: req.body.fileName || 'api-payload.json', text: typeof req.body.payload === 'string' ? req.body.payload : JSON.stringify(req.body.payload, null, 2) };
  else return res.status(400).json({ error: 'Provide a file, text or payload' });
  const batch = await P.createBatch({ user, source, tenantDb, clientId });
  res.json(slim(batch));
}));

/* 2. DETECT (SSE progress optional via ?sse=1) */
/* detect / extract run in the background; the UI polls /progress (robust to proxy timeouts and long Sarvam jobs). ?sync=1 keeps the old blocking behaviour. */
router.post('/batches/:id/detect', wrap(async (req, res) => {
  const b = await loadBatch(req);
  if (req.query.sync === '1') { await P.detect(b); return res.json({ detection: b.detection, docType: b.docType, rawText: b.rawText?.slice(0, 20000), pages: b.pages }); }
  if (req.body?.retry) { b.rawText = null; b.pages = null; b.progress = null; }
  res.status(202).json(P.runStep(b, 'detect', (onProgress) => P.detect(b, onProgress)));
}));
router.get('/batches/:id/progress', wrap(async (req, res) => { const b = await loadBatch(req); const pr = P.progressOf(b); res.json({ ...pr, log: pr.log.slice(-40), batchStep: b.step, docType: b.docType, detection: b.detection || null }); }));
router.put('/batches/:id/doc-type', wrap(async (req, res) => { const b = await loadBatch(req); await P.setDocType(b, req.body.code); res.json({ docType: b.docType, type: docTypes.get(b.docType) }); }));

/* 3. EXTRACT */
router.post('/batches/:id/extract', wrap(async (req, res) => {
  const b = await loadBatch(req);
  if (req.query.sync === '1') { await P.extract(b); return res.json({ header: b.header, lines: b.lines, extraction: b.extraction, type: docTypes.get(b.docType) }); }
  res.status(202).json(P.runStep(b, 'extract', (onProgress) => P.extract(b, onProgress)));
}));

/* 4. REVIEW */
router.put('/batches/:id/review', wrap(async (req, res) => { const b = await loadBatch(req); await P.applyReview(b, req.body); res.json({ header: b.header, lines: b.lines, corrections: b.corrections }); }));

/* 5. MAP */
router.post('/batches/:id/map/suggest', wrap(async (req, res) => { const b = await loadBatch(req); res.json(await P.suggestMappings(b)); }));
router.put('/batches/:id/map', wrap(async (req, res) => { const b = await loadBatch(req); await P.applyMapping(b, req.body.decisions || []); res.json({ mapItems: b.mapItems, header: b.header, lines: b.lines }); }));

/* 6. VALIDATE */
router.post('/batches/:id/validate', wrap(async (req, res) => { const b = await loadBatch(req); res.json(await P.validate(b)); }));

/* 7. CONVERT */
router.get('/batches/:id/relationships', wrap(async (req, res) => { const b = await loadBatch(req); res.json(await P.relationships(b)); }));
router.put('/batches/:id/relationships', wrap(async (req, res) => { const b = await loadBatch(req); await P.setRelationship(b, req.body); res.json(b.relationship); }));

/* 8. RECONCILE */
router.post('/batches/:id/reconcile', wrap(async (req, res) => { const b = await loadBatch(req); res.json(await P.reconcile(b)); }));
router.post('/batches/:id/reconcile/override', wrap(async (req, res) => { const b = await loadBatch(req); await P.overrideCheck(b, req.body.key, req.body.reason); res.json(b.reconciliation); }));

/* 9. POST */
router.get('/batches/:id/plan', wrap(async (req, res) => { const b = await loadBatch(req); res.json(P.postingPlan(b)); }));
router.post('/batches/:id/post', wrap(async (req, res) => { const b = await loadBatch(req); res.json(await P.post(b, { approve: !!req.body.approve })); }));

/* ---- RetailCLIQ screen integration ---- */
/** ERP payload for a batch: header + rows (IMPORT_TARGET_FIELDS / grid columns) + Stock_Import_Export staging */
router.get('/batches/:id/erp', wrap(async (req, res) => { const b = await loadBatch(req); res.json(await erp.toErp(b, { targetScreen: req.query.screen || 'PI' })); }));
/**
 * Backend URL for the GRC screens' "📕 PDF / 🖨 Scan" import (Purchase_Invoice.html → importBackendUrl).
 * Screen POSTs multipart `file`; expects { ok:true, rows:[...] }. We also return header, batchId, warnings.
 * Runs the full pipeline synchronously: detect → extract → auto-map exact masters → validate → ERP mapping.
 */
router.post('/grc/extract', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'file is required' });
  const batch = await P.createBatch({ user: req.body.user || 'grc-screen', source: { kind: 'grc', fileName: req.file.originalname, path: req.file.path, size: req.file.size, mime: req.file.mimetype, contentType: req.body.contentType || 'mixed', rotate: Number(req.body.rotate || 0) } });
  await P.detect(batch);
  if (req.body.docType && docTypes.get(req.body.docType)) await P.setDocType(batch, req.body.docType);
  await P.extract(batch);
  await P.suggestMappings(batch);
  const auto = batch.mapItems.filter((i) => i.status === 'auto').map((i) => ({ id: i.id, action: 'map', selected: i.selected }));
  if (auto.length) await P.applyMapping(batch, auto);
  await P.validate(batch);
  batch.step = 'REVIEW'; await db.saveBatch(batch);
  const out = await erp.toErp(batch, { targetScreen: req.body.screen || 'PI' });
  out.detection = batch.detection; out.unmapped = batch.mapItems.filter((i) => !i.selected).map((i) => ({ master: i.master, value: i.value, line: i.line, candidates: (i.candidates || []).slice(0, 3) }));
  res.json(out);
}));
router.get('/supplier-profile/:code', (req, res) => res.json(erp.getProfile(req.params.code) || {}));
router.put('/supplier-profile/:code', (req, res) => res.json(erp.saveProfile(req.params.code, req.body || {})));
router.get('/hsn-map', (_, res) => res.json(erp.HSN_MAP));

/* 10. RESULT / AUDIT */
router.get('/batches/:id/audit', wrap(async (req, res) => { const b = await loadBatch(req); res.json({ audit: b.audit, corrections: b.corrections, validation: b.validation, reconciliation: b.reconciliation, result: b.result, extraction: b.extraction }); }));

/* ---- BST GL Mapping endpoints ---- */
router.get('/batches/:id/bst-gl-mapping', wrap(async (req, res) => {
  const b = await loadBatch(req);
  if (b.docType !== 'BST') return res.status(400).json({ error: 'BST GL Mapping only applies to Bank Statement batches' });
  // Return lines with current GL mapping + account suggestions
  const accounts = await db.searchMaster('account', '', 200, req.tenantDb);
  const lines = b.lines.map(l => ({
    ...l,
    glAccount: b.bstGlMap?.[l.lineNo] || null,
    suggestedGl: suggestGlAccount(l.description, l.txType, accounts),
  }));
  res.json({ lines, accounts, summary: { total: lines.length, mapped: lines.filter(l=>l.glAccount).length }, bstGlMap: b.bstGlMap || {} });
}));
router.put('/batches/:id/bst-gl-mapping', wrap(async (req, res) => {
  const b = await loadBatch(req);
  if (b.docType !== 'BST') return res.status(400).json({ error: 'BST GL Mapping only for Bank Statement' });
  const { decisions } = req.body; // [{lineNo, glAccount, glAccountName}]
  if (!b.bstGlMap) b.bstGlMap = {};
  for (const d of (decisions || [])) { if (d.lineNo && d.glAccount) b.bstGlMap[d.lineNo] = d.glAccount; }
  // Write GL accounts back into lines
  b.lines = b.lines.map(l => ({ ...l, account: b.bstGlMap[l.lineNo] || l.account }));
  await db.saveBatch(b);
  res.json({ bstGlMap: b.bstGlMap, mapped: Object.keys(b.bstGlMap).length });
}));

/** Suggest GL account based on transaction description and keywords */
function suggestGlAccount(desc, txType, accounts) {
  if (!desc) return null;
  const t = String(desc).toLowerCase();
  const suggestions = [
    [/neft|rtgs|imps|transfer|payment|paid\s+to/i, 'Bank Transfer'],
    [/salary|wages|payroll/i, 'Salary & Wages'],
    [/rent|lease/i, 'Rent Expense'],
    [/electricity|eb\s*bill|power/i, 'Electricity'],
    [/telephone|mobile|internet|broadband/i, 'Communication'],
    [/fuel|petrol|diesel/i, 'Fuel & Transport'],
    [/insurance/i, 'Insurance'],
    [/interest.*received|interest.*credit/i, 'Interest Received'],
    [/interest.*charged|interest.*dr/i, 'Interest Paid'],
    [/purchase|supplier|vendor/i, 'Purchases'],
    [/sales|customer|revenue/i, 'Sales'],
    [/upi.*received|upi.*cr|cash.*received/i, 'Cash/UPI Receipt'],
    [/atm|cash.*withdrawal/i, 'Cash Withdrawal'],
    [/bank\s+charges|service\s+charge|maintenance/i, 'Bank Charges'],
    [/tax|tds|gst|advance\s+tax/i, 'Tax Payments'],
  ];
  const desc_lower = t;
  for (const [re, label] of suggestions) {
    if (re.test(desc_lower)) {
      const match = accounts.find(a => new RegExp(label.replace(/[^\w]/g,' ').trim().split(' ').join('|'), 'i').test(a.name));
      if (match) return match.code;
    }
  }
  return null;
}

/* ---- Tally XML parse endpoint (test/validate) ---- */
router.post('/parse-tally-xml', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  try {
    const { parseTallyXml } = require('../services/tallyParser');
    const vouchers = parseTallyXml(content);
    res.json({ ok: true, vouchers: vouchers.length, data: vouchers });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Engine fallback status ---- */
router.get('/fallback-status', wrap(async (_, res) => {
  const tessInfo = require('../services/tesseractOcr').ping ? await require('../services/tesseractOcr').ping() : { ok: false };
  const loInfo   = require('../services/lightOcrService').ping ? await require('../services/lightOcrService').ping() : { ok: false };
  res.json({
    tier1: { engine: 'light-ocr', label: '⚡ light-OCR (PP-OCRv6 ONNX)', configured: loInfo.ok, model: 'PP-OCRv6 Small', dictSize: loInfo.dictSize, version: loInfo.version, role: 'offline-first, zero cost, ~2s per page' },
    tier2: { engine: 'tesseract', label: '🔡 Tesseract 5.3', configured: tessInfo.ok, version: tessInfo.version, langs: tessInfo.langs, langCount: tessInfo.langCount, role: 'local/offline, system binary, zero cost' },
    tier3: { engine: 'sarvam', label: '🤖 Sarvam AI', configured: !!(process.env.SARVAM_API_KEY), keys: '2 keys', role: 'cloud, best quality for Indian documents' },
    tier4: { engine: 'gemini', label: '✨ Google Gemini 2.5-flash', configured: !!(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', role: 'cloud, multimodal vision fallback' },
    tier5: { engine: 'heuristic', label: '📐 Heuristic regex', configured: true, role: 'always available' },
    fallbackChain: '⚡ light-OCR → 🔡 Tesseract → 🤖 Sarvam AI → ✨ Gemini → 📐 Heuristic',
    minConfidence: Number(process.env.OCR_MIN_CONFIDENCE || 0.60),
    coverage: '100% uptime — 2 local engines guarantee offline operation',
    creditAlertEmail: process.env.CREDIT_ALERT_EMAIL || 'msivan@myaccounts.in',
  });
}));

module.exports = router;
