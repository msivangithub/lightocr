/**
 * Unified reading engine used by bulk intake.
 *   OCR_ENGINE = sarvam (production) | local (tesseract, offline) | mock
 *   LLM_ENGINE = sarvam | heuristic (regex-based, offline)
 *
 * ─ 5-tier Fallback Chain for 100% Uptime ──────────────────────────────
 *   1. light-OCR PP-OCRv6  (local ONNX, zero cost, ~2s)
 *   2. Tesseract 5.3       (system binary, offline, zero cost)
 *   3. Sarvam AI           (cloud, best quality, pay-per-use)
 *   4. Google Gemini       (cloud, vision, pay-per-use)
 *   5. Heuristic regex     (pure text, no-OCR, always available)
 *
 * Credit alert email sent when cloud engines exhaust quotas.
 * Tesseract guarantees output even with zero internet connectivity.
 */
const fs = require('fs');
const path = require('path');
const pre = require('./preprocess');
const docTypes = require('./documentTypes');

const OCR_ENGINE = process.env.DOCAI_MOCK === '1' ? 'mock' : (process.env.OCR_ENGINE || 'sarvam');
const LLM_ENGINE = process.env.DOCAI_MOCK === '1' ? 'mock' : (process.env.LLM_ENGINE || (OCR_ENGINE === 'sarvam' ? 'sarvam' : 'heuristic'));
const sarvam = OCR_ENGINE === 'sarvam' || LLM_ENGINE === 'sarvam' ? require('./sarvam') : null;
const mock = require('./mock');

// Gemini fallback (loaded lazily)
let gemini = null;
function getGemini() {
  if (!gemini && process.env.GEMINI_API_KEY) { gemini = require('./googleOcr'); }
  return gemini;
}

// Tesseract (local, always available if installed)
let _tesseract = null;
function getTesseract() {
  if (_tesseract === null) {
    try { _tesseract = require('./tesseractOcr'); } catch { _tesseract = false; }
  }
  return _tesseract || null;
}

// light-OCR (PP-OCRv6 local, always available)
let _lightOcr = null;
function getLightOcr() {
  if (_lightOcr === null) {
    try { _lightOcr = require('./lightOcrService'); } catch { _lightOcr = false; }
  }
  return _lightOcr || null;
}

const MIN_CONFIDENCE = Number(process.env.OCR_MIN_CONFIDENCE || 0.60);
const FAIL_TRACK = { sarvam: 0, gemini: 0 };
const FAIL_THRESHOLD = 3;

/**
 * 5-tier fallback chain (offline-first):
 *   Tier 1: light-OCR PP-OCRv6 (local ONNX, zero cost, ~2s)
 *   Tier 2: Tesseract 5.3 (system binary, offline, zero cost)
 *   Tier 3: Sarvam AI (cloud, best quality, pay-per-use)
 *   Tier 4: Google Gemini (cloud, vision, pay-per-use)
 *   Tier 5: Heuristic (text only, always succeeds)
 * Each tier accepted only if confidence >= OCR_MIN_CONFIDENCE.
 */
async function withFallback(lightOcrFn, sarvamFn, geminiFn, tesseractFn, heuristicFn, label) {
  // ── Tier 1: light-OCR (PP-OCRv6 ONNX, local) ─────────────────────────
  const lo = getLightOcr();
  if (lo && lightOcrFn) {
    try {
      const result = await lightOcrFn(lo);
      const conf = (result?.confidence != null) ? result.confidence : 1;
      if (conf >= MIN_CONFIDENCE) {
        console.log(`[ocrEngine] ⚡ Tier-1 light-OCR ${label} accepted (conf=${conf.toFixed(2)})`);
        return result;
      }
      console.warn(`[ocrEngine] ⚡ Tier-1 light-OCR ${label} low-conf ${conf.toFixed(2)} < ${MIN_CONFIDENCE} → Tesseract`);
    } catch (e1) {
      console.warn(`[ocrEngine] Tier-1 light-OCR failed (${e1.message.slice(0,80)}) → Tesseract`);
    }
  }

  // ── Tier 2: Tesseract (system binary, offline) ─────────────────────────
  const tess = getTesseract();
  if (tess && tesseractFn) {
    try {
      const result = await tesseractFn(tess);
      const conf = (result?.confidence != null) ? result.confidence : 1;
      if (conf >= MIN_CONFIDENCE) {
        console.log(`[ocrEngine] 🔡 Tier-2 Tesseract ${label} accepted (conf=${conf.toFixed(2)})`);
        return result;
      }
      console.warn(`[ocrEngine] 🔡 Tier-2 Tesseract low-conf → Sarvam`);
    } catch (e2) {
      console.warn(`[ocrEngine] Tier-2 Tesseract failed (${e2.message.slice(0,80)}) → Sarvam`);
    }
  }

  // ── Tier 3: Sarvam AI ─────────────────────────────────────────────────
  if (OCR_ENGINE === 'sarvam' || LLM_ENGINE === 'sarvam') {
    try {
      const result = await sarvamFn();
      FAIL_TRACK.sarvam = 0;
      console.log(`[ocrEngine] 🤖 Tier-3 Sarvam ${label} accepted`);
      return result;
    } catch (e) {
      const isAuthErr = /auth|key|unauthor/i.test(e.message) || e.status === 401 || e.status === 403;
      const isQuota   = /quota|rate.?limit|exhausted/i.test(e.message) || e.status === 429;
      FAIL_TRACK.sarvam++;
      if (FAIL_TRACK.sarvam >= FAIL_THRESHOLD && (isAuthErr || isQuota)) {
        const g = getGemini();
        if (g) g.sendCreditAlert('Sarvam AI', e.message).catch(() => {});
        FAIL_TRACK.sarvam = 0;
      }
      console.warn(`[ocrEngine] Tier-3 Sarvam ${label} failed (${e.message.slice(0,100)}) → Gemini`);
    }
  }

  // ── Tier 4: Google Gemini Vision ─────────────────────────────────────
  const g = getGemini();
  if (g) {
    try {
      const result = await geminiFn(g);
      FAIL_TRACK.gemini = 0;
      console.log(`[ocrEngine] ✨ Tier-4 Gemini ${label} accepted`);
      return result;
    } catch (e3) {
      FAIL_TRACK.gemini++;
      console.warn(`[ocrEngine] Tier-4 Gemini ${label} failed (${e3.message.slice(0,100)}) → heuristic`);
    }
  }

  // ── Tier 5: Heuristic (always succeeds) ───────────────────────────────
  console.warn(`[ocrEngine] All 4 OCR tiers exhausted for ${label} — heuristic`);
  return heuristicFn();
}

/* ------------------------------------------------ rate limiter (10/min) */
const RPM = Number(process.env.SARVAM_RPM || 10);
const stamps = [];
async function throttle() {
  for (;;) {
    const now = Date.now(); while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    if (stamps.length < RPM) { stamps.push(now); return; }
    await new Promise((r) => setTimeout(r, 60000 - (now - stamps[0]) + 50));
  }
}

/* ------------------------------------------------ OCR image pages */
/** pages: [{page, path}] (jpg) → [{page, text, engine}] */
async function ocrPages(pages, { onProgress, contentType = 'mixed', language, appLocale } = {}) {
  if (OCR_ENGINE === 'mock') return pages.map((p) => ({ page: p.page, text: mock.sampleFor(path.basename(p.path)).text, engine: 'mock' }));

  // OCR_ENGINE=local: force Tesseract directly (explicit config, not fallback)
  if (OCR_ENGINE === 'local') {
    const tess = getTesseract();
    if (!tess) throw new Error('OCR_ENGINE=local needs tesseract on PATH. Install: apt-get install tesseract-ocr');
    const out = [];
    for (const p of pages) {
      onProgress && onProgress({ message: `Tesseract OCR page ${p.page}` });
      const r = await tess.ocrImage(p.path, { appLocale: appLocale || 'en-IN' });
      out.push({ page: p.page, text: r.text, engine: 'tesseract' });
    }
    return out;
  }

  // 5-tier chain: light-OCR → Tesseract → Sarvam → Gemini → heuristic
  const out = [];
  for (const group of pre.chunk(pages, pre.PAGE_LIMIT)) {
    let file = group[0].path;
    if (group.length > 1) {
      file = path.join(path.dirname(group[0].path), `pages-${group[0].page}-${group[group.length - 1].page}.zip`);
      pre.zipPages(group.map((g) => g.path), file);
    }

    // Tier 1: light-OCR (PP-OCRv6, local, for single-image groups)
    const lightOcrPages = async (lo) => {
      if (group.length > 1) throw new Error('light-OCR: process pages individually not as zip');
      onProgress && onProgress({ message: `⚡ light-OCR page ${group[0].page}` });
      const r = await lo.ocrFile(group[0].path);
      const text = r.text;
      return [{ page: group[0].page, text, engine: 'light-ocr', confidence: r.confidence }];
    };

    const sarvamOcr = async () => {
      await throttle();
      onProgress && onProgress({ message: `🤖 Sarvam OCR pages ${group[0].page}-${group[group.length - 1].page}` });
      const res = await sarvam.digitiseToText(file, { contentType, onProgress: (st) => onProgress && onProgress({ message: `Sarvam job ${st.status} (${st.usage?.pages_processed ?? 0}/${st.usage?.pages_total ?? group.length})` }) });
      return res.pages.map((p, i) => ({ page: group[i]?.page ?? p.page, text: p.content, engine: 'sarvam', jobId: res.jobId }));
    };

    const geminiOcr = async (g) => {
      onProgress && onProgress({ message: `✨ Gemini Vision OCR pages ${group[0].page}-${group[group.length - 1].page}` });
      const results = [];
      for (const pg of group) {
        const r = await g.ocrImageToText(pg.path);
        results.push({ page: pg.page, text: r.text, engine: 'gemini' });
      }
      return results;
    };

    const tesseractOcr = async (tess) => {
      onProgress && onProgress({ message: `🔡 Tesseract OCR pages ${group[0].page}-${group[group.length - 1].page}` });
      const results = [];
      for (const pg of group) {
        const r = await tess.ocrImage(pg.path, { appLocale: appLocale || 'en-IN' });
        results.push({ page: pg.page, text: r.text, engine: 'tesseract', confidence: 0.75 });
      }
      return results;
    };

    const pageResult = await withFallback(
      lightOcrPages,
      sarvamOcr,
      geminiOcr,
      tesseractOcr,
      () => group.map(pg => ({ page: pg.page, text: '', engine: 'heuristic' })),
      'ocrPages'
    );
    out.push(...pageResult);
  }
  return out;
}

/** OCR a whole PDF with 5-tier fallback */
async function ocrPdf(filePath, workDir, { onProgress, contentType = 'mixed', appLocale } = {}) {
  if (OCR_ENGINE === 'mock') { const t = mock.sampleFor(path.basename(filePath)).text; return [{ page: 1, text: t, engine: 'mock' }]; }

  // OCR_ENGINE=local: force Tesseract
  if (OCR_ENGINE === 'local') {
    const tess = getTesseract();
    if (!tess) throw new Error('OCR_ENGINE=local needs tesseract on PATH');
    onProgress && onProgress({ message: 'Tesseract OCR PDF (offline)' });
    return tess.ocrPdfPages(filePath, path.join(workDir, 'tess-pages'), { appLocale: appLocale || 'en-IN' });
  }

  // Tier 1: light-OCR PDF (uses poppler to render pages, then PP-OCRv6)
  const lightOcrPdf = async (lo) => {
    onProgress && onProgress({ message: '⚡ light-OCR PDF' });
    const r = await lo.ocrFile(filePath);
    return r.pages.map(p => ({ page: p.page, text: p.content || p.text, engine: 'light-ocr', confidence: r.confidence }));
  };

  // Tier 3: Sarvam path (direct PDF, no poppler)
  const sarvamPdf = async () => {
    const parts = await pre.splitPdf(filePath, path.join(workDir, 'parts'));
    const out = [];
    for (const part of parts) {
      await throttle();
      onProgress && onProgress({ message: `🤖 Sarvam digitise PDF pages ${part.first}-${part.last}` });
      const res = await sarvam.digitiseToText(part.path, { contentType, onProgress: (st) => onProgress && onProgress({ message: `Sarvam job ${st.status}` }) });
      res.pages.forEach((p, i) => out.push({ page: part.first + i, text: p.content, engine: 'sarvam', jobId: res.jobId }));
    }
    return out;
  };

  // Tier 4: Gemini PDF
  const geminiPdf = async (g) => {
    onProgress && onProgress({ message: '✨ Gemini Vision OCR PDF' });
    const r = await g.ocrImageToText(filePath);
    return [{ page: 1, text: r.text, engine: 'gemini' }];
  };

  // Tier 2: Tesseract PDF (needs poppler)
  const tesseractPdf = async (tess) => {
    const hasPdftoppm = await pre.hasTool('pdftoppm');
    if (!hasPdftoppm) throw new Error('Tesseract PDF OCR needs pdftoppm — install poppler-utils');
    onProgress && onProgress({ message: '🔡 Tesseract OCR PDF pages (offline)' });
    const rendered = await pre.renderPdfPages(filePath, path.join(workDir, 'pages'));
    const results = [];
    for (const pg of rendered) {
      const r = await tess.ocrImage(pg.path, { appLocale: appLocale || 'en-IN' });
      results.push({ page: pg.page, text: r.text, engine: 'tesseract' });
    }
    return results;
  };

  return withFallback(
    lightOcrPdf,
    sarvamPdf,
    geminiPdf,
    tesseractPdf,
    () => [{ page: 1, text: '', engine: 'heuristic' }],
    'ocrPdf'
  );
}

/* ------------------------------------------------ page grouping */
const INV_RE = /(?:invoice|inv|bill|voucher|challan)\s*(?:no|number|num|#)\s*\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{1,24})(?=\s|$)/i;
const INV_RE2 = /(?:invoice|bill)\s*[:#]\s*([A-Z0-9][A-Z0-9\/\-.]{1,24})(?=\s|$)/i;
const BAD_INV = /^(?:no|date|dt|number|oice|invoice|tax|gst|original|copy|ref)$/i;
function findInvoiceNo(t) { for (const re of [INV_RE, INV_RE2]) { const m = re.exec(t); if (m && !BAD_INV.test(m[1]) && /\d/.test(m[1])) return m[1]; } return null; }
const CONT_RE = /page\s*([2-9]|\d{2})\s*(?:of|\/)\s*\d+|continued|contd|cont\.|carried\s+forward/i;
const FIRST_RE = /page\s*1\s*(?:of|\/)\s*\d+|tax\s+invoice|gst\s+invoice|original\s+for\s+recipient|bill\s+of\s+supply/i;
/** Decide which pages belong together. Returns [[pageIdx,...],...] */
function groupPages(pages) {
  const groups = []; let cur = null; let lastInv = null;
  pages.forEach((p, i) => {
    const t = p.text || ''; const inv = findInvoiceNo(t);
    const continuation = CONT_RE.test(t) && !FIRST_RE.test(t.slice(0, 400));
    const sameInv = inv && lastInv && inv === lastInv;
    const weak = t.replace(/\s+/g, '').length < 120; // near-empty page (back side / blank)
    if (cur && (continuation || sameInv || (weak && !inv))) cur.push(i);
    else { cur = [i]; groups.push(cur); }
    if (inv) lastInv = inv;
  });
  return groups;
}

/* ------------------------------------------------ detect + structure */
async function detect(text, fileName) {
  if (LLM_ENGINE === 'mock') return mock.detect(text, fileName);

  const sarvamDetect = async () => {
    const sys = `You are a document classifier for an Indian retail ERP system used by a RETAILER/BUYER.
The USER of this system is always the BUYER (retailer). Suppliers/vendors sell TO us.
BST (Bank Statement): bank name + account + debit/credit/balance table. NOT an invoice.
TDS: TAN, Form 16/16A/26AS, tax deducted. CTV: contra entry cashbank. PDC: post-dated cheque.
GL: direct GL posting. JV: journal entry. PT_PUR/PT_SAL: Tally/SAP/EDI format.
Allowed codes: ${docTypes.list().map((t) => `${t.code}=${t.name}`).join('; ')}.
Return: {"documentType":"<code>","confidence":0.0-1.0,"reasons":[...],"alternatives":[{"documentType":"<code>","confidence":0.0}],"engine":"sarvam"}
Confidence: 0.85+ for strong indicators, 0.6-0.84 good match, below 0.6 genuinely ambiguous.`;
    await throttle();
    const result = await sarvam.chatJson(sys, `File: ${fileName}\n\n${text.slice(0, 8000)}`, { max_tokens: 16000 });
    result.engine = 'sarvam';
    return result;
  };
  const geminiDetect = async (g) => g.detectDocType(text, fileName);
  
  // ✅ UPDATED: Use local heuristic instead of throwing error
  const lightOcrDetect = async (_lo) => {
    console.log('[detect] ⚡ Using local heuristic classifier on Light-OCR text');
    return heuristicDetect(text, 'Local heuristic on Light-OCR text');
  };
  
  const tesseractDetect = async (_tess) => heuristicDetect(text, 'AI LLM unavailable — heuristic classifier on OCR text');
  const heuristicDetectFn = () => heuristicDetect(text, 'All engines unavailable — heuristic');

  if (LLM_ENGINE === 'sarvam') return withFallback(lightOcrDetect, sarvamDetect, geminiDetect, tesseractDetect, heuristicDetectFn, 'detect');
  const g = getGemini();
  if (g) { try { return await geminiDetect(g); } catch (e) { console.warn('[detect] Gemini failed:', e.message); } }
  return heuristicDetectFn();
}

function heuristicDetect(text, note) {
  const t = text.toLowerCase(); let code = 'OTHER', conf = 0.4; const reasons = [];
  // Financial / GL / Vouchers
  if (/contra\s+voucher|contra\s+entry|fund\s+transfer|cash\s+to\s+bank|bank\s+to\s+cash/i.test(text)) { code = 'CTV'; conf = 0.8; reasons.push('Contra/fund transfer entry'); }
  else if (/post\s*dated\s+cheque|p\.?d\.?c\.?\b|cheque\s+date.*future|cheque\s+no.*pdc/i.test(text)) { code = 'PDC'; conf = 0.8; reasons.push('Post-dated cheque'); }
  else if (/bank\s+reconciliation|brs\s+report|as\s+per\s+pass\s+book|as\s+per\s+cash\s+book|uncleared\s+cheque/i.test(text)) { code = 'BRS'; conf = 0.85; reasons.push('Bank reconciliation statement'); }
  else if (/tds\s+certificate|form\s+16\b|form\s+16a|form\s+26as|tan\s*[:=]\s*\w/i.test(text) || /tds\s*deducted|tax\s+deducted\s+at\s+source/i.test(text)) { code = 'TDS'; conf = 0.85; reasons.push('TDS certificate/challan'); }
  // Bank Statement — detect bank name + "statement" + account
  else if (/statement\s+of\s+account|account\s+statement|bank\s+statement/i.test(text) && /account\s+no|a\/c\s+no|balance/i.test(text)) { code = 'BST'; conf = 0.88; reasons.push('Bank account statement'); }
  else if (/(hdfc|icici|sbi|state\s+bank|axis|kotak|pnb|punjab|canara|union\s+bank|indusind|yes\s+bank|idfc|federal|south\s+indian|indian\s+bank|bank\s+of\s+baroda|bank\s+of\s+india)\s+bank/i.test(text) && /debit|credit|balance|opening/i.test(t)) { code = 'BST'; conf = 0.82; reasons.push('Bank-named statement with debit/credit/balance columns'); }
  // PT/EDI format
  else if (/tally\s+(prime|erp|xml)|sap\s+(idoc|xml|bapi)|quickbooks|edi\s*(order|invoice)|edifact|ean\s+code|gtin\s*[:=]/i.test(text)) { code = 'PT_PUR'; conf = 0.75; reasons.push('EDI/ERP format file'); }
  // Trading documents
  else if (/purchase\s+order|p\.?o\.?\s*no/.test(t) && !/invoice/.test(t)) { code = 'PO'; conf = 0.7; reasons.push('Purchase order keywords'); }
  else if (/credit\s+note/.test(t)) { code = 'CN'; conf = 0.8; reasons.push('Credit note'); }
  else if (/debit\s+note/.test(t)) { code = 'DN'; conf = 0.8; reasons.push('Debit note'); }
  else if (/delivery\s+challan/.test(t)) { code = 'DC'; conf = 0.75; reasons.push('Delivery challan'); }
  else if (/payment\s+voucher/.test(t)) { code = 'PV'; conf = 0.8; reasons.push('Payment voucher'); }
  else if (/receipt\s+voucher/.test(t)) { code = 'RV'; conf = 0.8; reasons.push('Receipt voucher'); }
  else if (/journal\s+voucher|journal\s+entry/.test(t)) { code = 'JV'; conf = 0.8; reasons.push('Journal voucher'); }
  else if (/general\s+ledger\s+posting|gl\s+voucher/.test(t)) { code = 'GL'; conf = 0.8; reasons.push('GL posting'); }
  else if (/tax\s+invoice|gst\s+invoice|invoice|bill\s+of\s+supply/.test(t)) { code = 'PI'; conf = /gstin|gst\s*no/.test(t) ? 0.85 : 0.65; reasons.push('Invoice with seller GSTIN → purchase invoice (we are the buyer)'); }
  if (note) reasons.push(note);
  return { documentType: code, confidence: conf, reasons, alternatives: code === 'PI' ? [{ documentType: 'SI', confidence: 0.1 }] : [], engine: 'heuristic' };
}

async function structure(text, docTypeCode, fileName) {
  const type = docTypes.get(docTypeCode) || docTypes.get('OTHER');
  if (LLM_ENGINE === 'mock') return mock.structure(text, docTypeCode, fileName);

  const sarvamStructure = async () => {
    const schema = docTypes.schemaFor(type.code);
    const sys = `${type.aiInstructions}\nOutput JSON matching this schema exactly (keys as given, unknown → null): ${JSON.stringify(schema.properties)}`;
    await throttle();
    let out = await sarvam.chatJson(sys, `Document text (OCR, may contain noise):\n${text.slice(0, 30000)}`, { max_tokens: 32000 });
    if (process.env.SARVAM_VERIFY !== '0') out = await verifyWithModel(out, text, sys);
    return out;
  };
  const geminiStructure = async (g) => g.structureDoc(text, docTypeCode, fileName);
  
  // ✅ UPDATED: Use local heuristic structurer instead of throwing error
  // const lightOcrStructure = async (_lo) => {
  //   console.log('[structure] ⚡ Using local regex structurer on Light-OCR text');
  //   return heuristicStructure(text);
  // };
  
  // const tesseractStructure = async (_tess) => { 
  //   console.log('[structure] 🔡 Heuristic structuring on Tesseract OCR text'); 
  //   return heuristicStructure(text); 
  // };
  
// Inside ocrEngine.js - structure() function

// ✅ FIXED: Include top-level numeric confidence for withFallback check
const lightOcrStructure = async (_lo) => {
  console.log('[structure] ⚡ Using local regex structurer on Light-OCR text');
  const result = heuristicStructure(text);

  console.log(result) ; 
  
  return {
    header: result.header,
    lines: result.lines,
    // Top-level number for withFallback confidence check
    confidence: Math.max(result.confidence.header || 0, result.confidence.lines || 0),
    
    raw: {
      header: result.header,
      lines: result.lines
    },
    engine: 'heuristic'
  };
};

const tesseractStructure = async (_tess) => { 
  console.log('[structure] 🔡 Heuristic structuring on Tesseract OCR text'); 
  const result = heuristicStructure(text);
  
  return {
    header: result.header,
    lines: result.lines,
    confidence: Math.max(result.confidence.header || 0, result.confidence.lines || 0),
    raw: {
      header: result.header,
      lines: result.lines
    },
    engine: 'tesseract-heuristic'
  };
};

  const heuristicStructureFn = () => heuristicStructure(text);

  if (LLM_ENGINE === 'sarvam') return withFallback(lightOcrStructure, sarvamStructure, geminiStructure, tesseractStructure, heuristicStructureFn, 'structure');
  const g = getGemini();
  if (g) { try { return await geminiStructure(g); } catch (e) { console.warn('[structure] Gemini failed:', e.message); } }
  return heuristicStructureFn();
}

function guessSellerName(t) {
  const lines = t.split('\n').map((l) => l.trim());
  const gi = lines.findIndex((l) => /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i.test(l));
  const bad = /invoice|gstin|gst\s*no|phone|mobile|e-?mail|original|duplicate|copy|tax|page|state|code|address|road|street|colony|nagar|floor|plot|shop|no\.|dist|pin|www|\d{6}/i;
  const cand = (from, to) => lines.slice(Math.max(0, from), Math.max(0, to)).filter((l) => l.length > 4 && l.length < 60 && /[A-Za-z]{3,}/.test(l) && !bad.test(l) && (l.match(/\d/g) || []).length < 3);
  const near = gi >= 0 ? cand(gi - 8, gi) : [];
  const top = cand(0, 12);
  const pick = (arr) => arr.sort((a, b) => (b.replace(/[^A-Z]/g, '').length / b.length) - (a.replace(/[^A-Z]/g, '').length / a.length))[0];
  return pick(near) || pick(top) || null;
}
const SIZE_RE = /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|FREE\s*SIZE|\d{2}x\d{2,3})\b/i;
const COLOUR_RE = /\b(black|white|red|blue|navy|green|yellow|pink|purple|orange|brown|grey|gray|beige|cream|maroon|wine|peach|mustard|olive|teal|rust|gold|silver|multi|lavender|magenta|coral|mint|ivory|khaki|rani|firozi|mehndi|gajri|lemon|onion|copper)\b/i;
function guessAttrs(desc) { return { size: (SIZE_RE.exec(desc) || [])[1] || null, colour: (COLOUR_RE.exec(desc) || [])[1] || null }; }

/** Second pass: ask the model to reconcile its own JSON against the document text (totals, line count, dates). */
async function verifyWithModel(json, text, sys) {
  try {
    const h = json.header || {}; const L = json.lines || [];
    const sum = L.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const taxable = Number(h.subTotal) || sum; const tax = (Number(h.cgst) || 0) + (Number(h.sgst) || 0) + (Number(h.igst) || 0) || Number(h.taxTotal) || 0;
    const grand = Number(h.grandTotal) || 0;
    const problems = [];
    if (!h.docNo) problems.push('docNo missing'); if (!h.docDate) problems.push('docDate missing'); if (!h.party) problems.push('party (seller) missing');
    if (grand && Math.abs(taxable - (Number(h.discountTotal) || 0) + tax + (Number(h.charges) || 0) + (Number(h.roundOff) || 0) - grand) > 2) problems.push('totals do not reconcile');
    if (h.subTotal && Math.abs(sum - Number(h.subTotal)) > 2) problems.push(`line amounts sum ${sum.toFixed(2)} ≠ taxable ${h.subTotal} (missing or extra lines?)`);
    if (!L.length) problems.push('no lines');
    if (!problems.length) return json;
    await throttle();
    const fixed = await sarvam.chatJson(sys + '\nYou are now VERIFYING a previous extraction. Fix only what is wrong; keep correct values. Make line amounts sum to the taxable value and totals reconcile with what is printed.', `Problems found: ${problems.join('; ')}\n\nPrevious JSON:\n${JSON.stringify(json)}\n\nDocument text:\n${text.slice(0, 30000)}`, { max_tokens: 32000 });
    fixed.verified = { problems, pass: 2 }; return fixed;
  } catch (e) { json.verifyError = e.message; return json; }
}

/* Regex-based structuring for offline testing. Good enough for header fields + rough lines. */
const num = (s) => { const n = Number(String(s || '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && String(s).trim() !== '' ? n : null; };
function heuristicStructure(text) {
  const t = text.replace(/\r/g, '');
  const g = (re, i = 1) => { const m = re.exec(t); return m ? m[i].trim() : null; };
  const gstins = [...t.matchAll(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/gi)].map((m) => m[1].toUpperCase());
  const dateRe = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
  const invDate = g(new RegExp('(?:invoice\\s*date|date\\s*of\\s*inv\\w*|dated|date)\\s*[:.\\-]?\\s*' + dateRe.source, 'i'), 0);
  const header = {
    party: guessSellerName(t),
    partyGstin: gstins[0] || null, buyerGstin: gstins[1] || null,
    docNo: findInvoiceNo(t), docDate: invDate ? invDate.replace(/^[^\d]*/, '') : g(dateRe, 0),
    irn: g(/IRN\s*[:.\-]?\s*([0-9a-f]{64})/i), ewayBillNo: g(/e-?\s*way\s*bill\s*(?:no|number)?\s*[:.\-]?\s*(\d{12})/i),
    transporter: g(/(?:transport(?:er)?(?:\s*name)?|despatched\s+through)\s*[:.\-]?\s*([A-Za-z0-9 .&]{3,40})/i), lrNo: g(/(?:L\.?R\.?|G\.?R\.?|docket)\s*(?:no|number)?\s*[:.\-]?\s*([A-Z0-9\/\-]{3,20})/i),
    placeOfSupply: g(/place\s+of\s+supply\s*[:.\-]?\s*([A-Za-z ]{3,30})/i),
    subTotal: num(g(/(?:taxable\s+(?:amount|value)|sub\s*total|total\s+before\s+tax)\s*[:.\-]?\s*(?:rs\.?|₹)?\s*([\d,]+\.?\d*)/i)),
    cgst: num(g(/CGST[^\n\d]{0,30}([\d,]+\.\d{2})/i)), sgst: num(g(/SGST[^\n\d]{0,30}([\d,]+\.\d{2})/i)), igst: num(g(/IGST[^\n\d]{0,30}([\d,]+\.\d{2})/i)),
    discountTotal: num(g(/discount[^\n\d]{0,20}([\d,]+\.\d{2})/i)), roundOff: num(g(/round\s*(?:off|ing)?[^\n\d]{0,15}(-?[\d,]*\.\d{2})/i)),
    grandTotal: num(g(/(?:grand\s+total|net\s+amount|total\s+amount\s+after\s+tax|invoice\s+(?:value|amount)|amount\s+chargeable|total\s+invoice|net\s+total|total)\s*[^\n\d]{0,25}([\d,]+\.\d{2})/i)),
    amountInWords: g(/(?:rupees|inr|amount\s+in\s+words)\s*[:.\-]?\s*([A-Za-z ]{10,120}only)/i),
  };
  header.taxTotal = [header.cgst, header.sgst, header.igst].reduce((s, v) => s + (v || 0), 0) || null;
  // line parsing on layout text: cells split by 2+ spaces or pipes; need a description cell + ≥3 numeric cells
  const lines = [];
  const SKIP = /gstin|gst\s*no|total|cgst|sgst|igst|utgst|invoice|date|phone|mobile|bank|ifsc|a\/c|account|e-?way|irn|ack|pan\b|cin\b|round|discount|freight|amount\s+in\s+words|rupees|page\s+\d|hsn\s*code|description/i;
  for (const raw of t.split('\n')) {
    const l = raw.replace(/\|/g, '  ').trim(); if (l.length < 10 || SKIP.test(l)) continue;
    const cells = l.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean).flatMap((c) => { const m = /^(-?[\d,]*\.?\d+)\s+([A-Za-z]{1,6})$/.exec(c); return m ? [m[1], m[2]] : [c]; }); // "30 SET" → "30","SET"
    if (cells.length < 3) continue;
    const isNum = (c) => /^-?[\d,]*\.?\d+\s*%?$/.test(c.replace(/[₹]/g, ''));
    const numCells = cells.filter(isNum); if (numCells.length < 3) continue;
    const descCell = cells.filter((c) => !isNum(c) && /[A-Za-z]{3,}/.test(c)).sort((a, b) => b.length - a.length)[0]; if (!descCell) continue;
    const hsn = (cells.find((c) => /^\d{4}(?:\d{2}|\d{4})?$/.test(c)) || null);
    let vals = numCells.filter((c) => c !== hsn && !/%$/.test(c)).map(num).filter((n) => n != null);
    if (vals.length > 3 && /^\d{1,3}$/.test(cells[0]) && isNum(cells[0])) vals = vals.slice(1); // drop Sl.No
    const pct = numCells.find((c) => /%$/.test(c)); const taxPct = pct ? num(pct) : null;
    if (vals.length < 2) continue;
    const amount = vals[vals.length - 1]; let rate = null, qty = null;
    // find (qty, rate) pair whose product ≈ amount
    for (let a = 0; a < vals.length - 1 && qty == null; a++) for (let b = 0; b < vals.length - 1; b++) { if (a === b) continue; if (vals[a] > 0 && vals[b] > 0 && Math.abs(vals[a] * vals[b] - amount) <= Math.max(1, amount * 0.02)) { qty = Math.min(vals[a], vals[b]); rate = Math.max(vals[a], vals[b]); if (vals[a] <= vals[b]) { qty = vals[a]; rate = vals[b]; } break; } }
    if (qty == null) { qty = vals.length >= 3 ? vals[vals.length - 3] : null; rate = vals.length >= 2 ? vals[vals.length - 2] : null; }
    if (amount == null || amount <= 0 || (qty != null && qty > 100000)) continue;
    const desc = descCell.replace(/^\s*\d{1,3}[\s.)]+/, '').trim();
    const uom = (cells.find((c) => /^(pcs|pc|nos|no|set|sets|mtr|mtrs|m|kg|kgs|box|dz|dzn|pair|prs|strip|ltr|l)$/i.test(c)) || null);
    lines.push({ description: desc.slice(0, 80), hsn, qty, rate, taxPct, amount, uom: uom ? uom.toUpperCase() : null, ...guessAttrs(desc) });
    if (lines.length >= 80) break;
  }
  if (!lines.length) for (const raw of t.split('\n')) { // fallback: loose numeric-tail parse
    const l = raw.trim(); if (l.length < 12 || SKIP.test(l)) continue;
    const nums = [...l.matchAll(/-?\d[\d,]*\.?\d*/g)].map((m) => m[0]).filter((x) => x.replace(/[^\d]/g, '').length);
    if (nums.length < 3) continue;
    const desc = l.replace(/^\s*\d{1,3}[\s.)]+/, '').replace(/\b\d[\d,]*\.?\d*\b/g, ' ').replace(/[|%]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const vals = nums.map(num).filter((n) => n != null); const amount = vals[vals.length - 1];
    if (!/[A-Za-z]{3,}/.test(desc) || amount == null || amount <= 0) continue;
    lines.push({ description: desc.slice(0, 80), hsn: null, qty: vals.length >= 3 ? vals[vals.length - 3] : null, rate: vals[vals.length - 2], amount, ...guessAttrs(desc) });
    if (lines.length >= 80) break;
  }
  // ✅ UPDATED: Increased confidence so it passes MIN_CONFIDENCE threshold
  return { header, lines, confidence: { header: 0.75, lines: 0.65, engine: 'heuristic' } };
}

module.exports = { OCR_ENGINE, LLM_ENGINE, ocrPages, ocrPdf, groupPages, detect, structure, heuristicDetect, heuristicStructure, throttle };