/**
 * lightOcrService.js — PP-OCRv6 Small engine built directly on top of the
 * ONNX model files shipped in @arcships/light-ocr-main.zip.
 *
 * Architecture note: The npm package @arcships/light-ocr requires a
 * platform-specific native addon not yet available for linux-arm64-gnu.
 * This service loads the same PP-OCRv6 ONNX models from the local models/
 * directory using onnxruntime-node (which fully supports ARM64) and
 * implements the inference pipeline in pure JavaScript.
 *
 * Pipeline:
 *   1. Pre-process image  (resize, BGR normalise)
 *   2. Detection model    (DB algorithm → text region bounding boxes)
 *   3. Per-box crop       (affine-warp each region to 48 × 320)
 *   4. Recognition model  (CTC decode → character string + confidence)
 *   5. Return page lines  ({ text, confidence, box })
 *
 * Models used (CPU compatible):
 *   models/light-ocr/det/inference.onnx   — PP-OCRv6_small_det
 *   models/light-ocr/rec/inference.onnx   — PP-OCRv6_small_rec
 *   models/light-ocr/rec/dictionary.json  — CTC character dictionary
 *
 * analyzeLayout():
 *   Classifies each line into: key-value, table-row, list-item,
 *   identifier, or text (mirrors the original server.js helper).
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const MODELS_DIR = path.join(__dirname, '..', '..', 'models', 'light-ocr');
const DET_MODEL  = path.join(MODELS_DIR, 'det', 'inference.onnx');
const REC_MODEL  = path.join(MODELS_DIR, 'rec', 'inference.onnx');
const DICT_FILE  = path.join(MODELS_DIR, 'rec', 'dictionary.json');

// ── Lazy singletons ────────────────────────────────────────────────────────
let _detSession = null;
let _recSession = null;
let _dictionary = null;
let _ort        = null;

function getOrt() {
  if (!_ort) _ort = require('onnxruntime-node');
  return _ort;
}

async function getDetSession() {
  if (!_detSession) {
    const ort = getOrt();
    _detSession = await ort.InferenceSession.create(DET_MODEL, {
      executionProviders: ['cpu'],
      logSeverityLevel: 3, // suppress verbose warnings
    });
  }
  return _detSession;
}

async function getRecSession() {
  if (!_recSession) {
    const ort = getOrt();
    _recSession = await ort.InferenceSession.create(REC_MODEL, {
      executionProviders: ['cpu'],
      logSeverityLevel: 3,
    });
  }
  return _recSession;
}

function getDictionary() {
  if (!_dictionary) {
    const raw = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
    // dictionary.json format: {"characters": [...], "schemaVersion": "1.0"}
    if (raw && Array.isArray(raw.characters)) {
      _dictionary = raw.characters;
    } else if (Array.isArray(raw)) {
      _dictionary = raw;
    } else {
      // fallback: sort by value if it's an object mapping char → index
      _dictionary = Object.keys(raw).filter(k => k !== 'schemaVersion').sort((a, b) => raw[a] - raw[b]);
    }
  }
  return _dictionary;
}

// ── Image utilities (uses sharp) ───────────────────────────────────────────
const sharp = require('sharp');

/** Pad dimension up to nearest multiple of `n` */
const padToMultiple = (x, n) => Math.ceil(x / n) * n;

/**
 * Pre-process for the detection model.
 * Returns { buffer: Float32Array, width, height } (CHW, BGR, normalised)
 */
async function prepareForDet(imagePath, maxEdge = 960) {
  let img = sharp(imagePath, { failOn: 'none' }).rotate(); // EXIF orient
  const meta = await img.metadata();
  let w = meta.width  || 960;
  let h = meta.height || 960;

  // Scale so longest edge ≤ maxEdge, keep multiple of 32
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  w = padToMultiple(Math.round(w * scale), 32);
  h = padToMultiple(Math.round(h * scale), 32);

  const raw = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = raw.data; // uint8 RGB
  const size   = w * h;
  const mean   = [0.485, 0.456, 0.406];
  const std    = [0.229, 0.224, 0.225];
  const buf    = new Float32Array(3 * size);

  // Sharp outputs RGB; PP-OCR expects (B,G,R) channels in CHW
  for (let i = 0; i < size; i++) {
    const r = pixels[i * 3]     / 255;
    const g = pixels[i * 3 + 1] / 255;
    const b = pixels[i * 3 + 2] / 255;
    buf[0 * size + i] = (b - mean[2]) / std[2];  // B
    buf[1 * size + i] = (g - mean[1]) / std[1];  // G
    buf[2 * size + i] = (r - mean[0]) / std[0];  // R
  }
  return { buffer: buf, width: w, height: h, origW: meta.width, origH: meta.height };
}

// ── DB post-processing (text detection) ───────────────────────────────────
const DB_THRESH   = 0.3;
const DB_BOX_THRESH = 0.5;
const UNCLIP_RATIO = 2.0;

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * Convert probability map to text boxes.
 * Returns array of [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] rotated rectangles,
 * scaled back to original image dimensions.
 */
function extractBoxes(probData, mapW, mapH, origW, origH) {
  const scaleX = origW / mapW;
  const scaleY = origH / mapH;

  // Threshold the prob map
  const binary = new Uint8Array(mapW * mapH);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = probData[i] > DB_THRESH ? 255 : 0;
  }

  // Simple connected-component labelling: flood-fill rows of high probability
  // Then compute axis-aligned bounding boxes (sufficient for receipts/invoices)
  const boxes = [];
  const visited = new Uint8Array(mapW * mapH);

  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const idx = y * mapW + x;
      if (binary[idx] === 0 || visited[idx]) continue;

      // BFS to find region
      const queue = [[x, y]];
      visited[idx] = 1;
      let minX = x, maxX = x, minY = y, maxY = y;
      let count = 0;
      let sumProb = 0;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop();
        count++;
        sumProb += probData[cy * mapW + cx];
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbours = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
        for (const [nx, ny] of neighbours) {
          if (nx >= 0 && nx < mapW && ny >= 0 && ny < mapH) {
            const nIdx = ny * mapW + nx;
            if (!visited[nIdx] && binary[nIdx] > 0) {
              visited[nIdx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }

      if (count < 10) continue; // skip tiny blobs
      const avgProb = sumProb / count;
      if (avgProb < DB_BOX_THRESH) continue;

      // Unclip: expand box by UNCLIP_RATIO
      const area = (maxX - minX + 1) * (maxY - minY + 1);
      const perimeter = 2 * ((maxX - minX + 1) + (maxY - minY + 1));
      const distance = area * UNCLIP_RATIO / perimeter;
      const d = Math.round(distance);
      const bx1 = Math.max(0, minX - d);
      const by1 = Math.max(0, minY - d);
      const bx2 = Math.min(mapW - 1, maxX + d);
      const by2 = Math.min(mapH - 1, maxY + d);

      // Scale to original image coordinates
      boxes.push({
        box: [
          [Math.round(bx1 * scaleX), Math.round(by1 * scaleY)],
          [Math.round(bx2 * scaleX), Math.round(by1 * scaleY)],
          [Math.round(bx2 * scaleX), Math.round(by2 * scaleY)],
          [Math.round(bx1 * scaleX), Math.round(by2 * scaleY)],
        ],
        confidence: avgProb,
      });
    }
  }

  // Sort top-to-bottom, left-to-right
  boxes.sort((a, b) => {
    const ay = a.box[0][1], by = b.box[0][1];
    if (Math.abs(ay - by) < 10) return a.box[0][0] - b.box[0][0];
    return ay - by;
  });

  return boxes;
}

// ── Recognition pre-processing ─────────────────────────────────────────────
const REC_H = 48;
const REC_W = 320;

/**
 * Crop and resize an image region to REC_H × REC_W for the rec model.
 * box: [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]
 */
async function cropForRec(imagePath, box) {
  const x0 = Math.max(0, box[0][0]);
  const y0 = Math.max(0, box[0][1]);
  const x2 = box[2][0];
  const y2 = box[2][1];
  const w  = Math.max(1, x2 - x0);
  const h  = Math.max(1, y2 - y0);

  const mean = [0.5, 0.5, 0.5];
  const std  = [0.5, 0.5, 0.5];

  const raw = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .extract({ left: x0, top: y0, width: w, height: h })
    .resize(REC_W, REC_H, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = raw.data;
  const size   = REC_W * REC_H;
  const buf    = new Float32Array(3 * size);

  for (let i = 0; i < size; i++) {
    const r = pixels[i * 3]     / 255;
    const g = pixels[i * 3 + 1] / 255;
    const b = pixels[i * 3 + 2] / 255;
    buf[0 * size + i] = (r - mean[0]) / std[0];
    buf[1 * size + i] = (g - mean[1]) / std[1];
    buf[2 * size + i] = (b - mean[2]) / std[2];
  }
  return buf;
}

// ── CTC decoding ───────────────────────────────────────────────────────────
/**
 * Greedy CTC decode.
 * PP-OCRv6 convention: index 0 = CTC blank, index 1..N = dictionary[0..N-1]
 * Returns { text, confidence }.
 */
function ctcDecode(output, seqLen, vocabSize, dictionary) {
  const BLANK = 0; // PP-OCRv6: blank token is index 0
  const chars  = [];
  const confs  = [];
  let lastIdx  = -1;

  for (let t = 0; t < seqLen; t++) {
    const offset = t * vocabSize;
    // argmax
    let maxVal = -Infinity, maxIdx = 0;
    for (let c = 0; c < vocabSize; c++) {
      if (output[offset + c] > maxVal) { maxVal = output[offset + c]; maxIdx = c; }
    }
    if (maxIdx !== BLANK && maxIdx !== lastIdx) {
      // character index = maxIdx - 1 (since blank occupies index 0)
      const charIdx = maxIdx - 1;
      if (charIdx >= 0 && charIdx < dictionary.length) {
        chars.push(dictionary[charIdx]);
        // confidence: treat raw logit via sigmoid as approximation
        confs.push(Math.min(1, Math.max(0, 1 / (1 + Math.exp(-maxVal)))));
      }
    }
    lastIdx = maxIdx;
  }

  const text = chars.join('');
  const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text, confidence };
}

// ── analyzeLayout (ported from light-ocr-server/src) ──────────────────────
const KEY_VALUE_RE = /^[\w\s#/]{1,40}[:]\s+\S/;
const ID_RE        = /^[A-Z0-9]{6,}$|GSTIN|PAN|CIN|TAN|IFSC|INV|GST|REG|BATCH|SER/i;
const AMOUNT_RE    = /₹|INR|\bRs\.?\b|[0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}/;

function analyzeLayout(lines) {
  return lines.map((line, idx) => {
    const t = (line.text || '').trim();
    let type = 'text';

    if (KEY_VALUE_RE.test(t)) type = 'key-value';
    else if (ID_RE.test(t)) type = 'identifier';
    else if (AMOUNT_RE.test(t)) type = 'amount';
    else if (/^[\s|]+$/.test(t) || (t.includes('|') && t.split('|').length >= 3)) type = 'table-row';
    else if (/^[-*•]\s/.test(t) || /^\d+[.)]\s/.test(t)) type = 'list-item';

    return { ...line, layoutType: type, index: idx };
  });
}

// ── Main OCR function ──────────────────────────────────────────────────────
/**
 * Run full PP-OCRv6 pipeline on an image file.
 * @param {string} imagePath
 * @returns {{ lines: [{text, confidence, box, layoutType}], avgConfidence, engine }}
 */
async function recognizeImage(imagePath) {
  const ort  = getOrt();
  const dict = getDictionary();

  // 1. Prepare detection input
  const { buffer: detBuf, width: dW, height: dH, origW, origH } = await prepareForDet(imagePath);

  // 2. Run detection model
  const detSession = await getDetSession();
  const detInput   = { x: new ort.Tensor('float32', detBuf, [1, 3, dH, dW]) };
  const detOut     = await detSession.run(detInput);
  const probMap    = detOut[detSession.outputNames[0]].data;
  const [, , mapH, mapW] = detOut[detSession.outputNames[0]].dims;

  // 3. Extract text boxes from probability map
  const boxes = extractBoxes(probMap, mapW, mapH, origW || dW, origH || dH);

  if (!boxes.length) {
    return { lines: [], avgConfidence: 0, engine: 'light-ocr' };
  }

  // 4. Recognition
  const recSession = await getRecSession();
  const results    = [];
  const vocabSize  = dict.length + 1; // +1 for blank

  for (const { box, confidence: detConf } of boxes) {
    try {
      const recBuf = await cropForRec(imagePath, box);
      const recInput = { x: new ort.Tensor('float32', recBuf, [1, 3, REC_H, REC_W]) };
      const recOut   = await recSession.run(recInput);
      const recData  = recOut[recSession.outputNames[0]].data;
      const dims     = recOut[recSession.outputNames[0]].dims;
      const seqLen   = dims[1] || dims[0] || Math.floor(recData.length / vocabSize);

      const { text, confidence: recConf } = ctcDecode(recData, seqLen, vocabSize, dict);
      if (text.trim()) {
        results.push({
          text: text.trim(),
          confidence: (detConf * 0.4 + recConf * 0.6),
          box,
        });
      }
    } catch {
      // skip unreadable boxes
    }
  }

  // 5. Add layout analysis
  const lines = analyzeLayout(results);
  const avgConf = lines.length
    ? lines.reduce((s, l) => s + (l.confidence || 0), 0) / lines.length
    : 0;

  return {
    lines,
    avgConfidence: avgConf,
    engine: 'light-ocr',
    pageCount: 1,
  };
}

/**
 * OCR a file (image or PDF) and return { text, pages, engine, confidence }.
 * For PDFs, renders pages via pdftoppm then OCRs each page.
 */
async function ocrFile(filePath, opts = {}) {
  const ext = path.extname(filePath).toLowerCase();

  if (/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(ext)) {
    const result = await recognizeImage(filePath);
    const text   = result.lines.map(l => l.text).join('\n');
    return {
      text,
      pages: [{ page: 1, content: text, engine: 'light-ocr', lines: result.lines }],
      engine:     'light-ocr',
      confidence: result.avgConfidence,
    };
  }

  if (/\.pdf$/i.test(ext)) {
    const pre    = require('./preprocess');
    const hasPdf = await pre.hasTool('pdftoppm');
    if (!hasPdf) throw new Error('light-ocr PDF needs pdftoppm — install poppler-utils');

    const workDir = path.join(path.dirname(filePath), 'locrpdf-' + Date.now());
    fs.mkdirSync(workDir, { recursive: true });
    try {
      const rendered = await pre.renderPdfPages(filePath, path.join(workDir, 'pages'));
      const pages    = [];
      const allLines = [];

      for (const pg of rendered) {
        const r = await recognizeImage(pg.path);
        const t = r.lines.map(l => l.text).join('\n');
        pages.push({ page: pg.page, content: t, engine: 'light-ocr', lines: r.lines });
        allLines.push(...r.lines);
      }

      const avgConf = allLines.length
        ? allLines.reduce((s, l) => s + (l.confidence || 0), 0) / allLines.length
        : 0;

      return {
        text: pages.map(p => p.content).join('\n\n---- page ----\n\n'),
        pages,
        engine:     'light-ocr',
        confidence: avgConf,
      };
    } finally {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }

  throw new Error(`light-ocr: unsupported file type ${ext}`);
}

// ── Health / ping ──────────────────────────────────────────────────────────
async function ping() {
  const out = {
    engine:    'light-ocr',
    available: false,
    model:     'PP-OCRv6 Small (ONNX, local)',
    note:      '@arcships/light-ocr ARM64 binary unavailable — running via onnxruntime-node',
  };

  if (!fs.existsSync(DET_MODEL) || !fs.existsSync(REC_MODEL)) {
    out.status  = `Model files missing in ${MODELS_DIR}`;
    out.ok      = false;
    return out;
  }

  try {
    await getDetSession();
    await getRecSession();
    const dict = getDictionary();
    out.available  = true;
    out.ok         = true;
    out.dictSize   = dict.length;
    out.detModel   = path.basename(DET_MODEL);
    out.recModel   = path.basename(REC_MODEL);
    out.status     = `ok — PP-OCRv6 Small, ${dict.length} chars dict, onnxruntime-node`;
    out.version    = '0.5.8-local'; // mirrors npm package version
  } catch (e) {
    out.ok     = false;
    out.status = e.message.slice(0, 150);
  }
  return out;
}

module.exports = { ocrFile, recognizeImage, analyzeLayout, ping };
