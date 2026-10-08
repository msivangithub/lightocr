/**
 * googleOcr.js — Google Gemini Vision as OCR/LLM fallback when Sarvam AI is unavailable.
 *
 * Used automatically when:
 *   - Sarvam returns 401/403 (auth error)
 *   - Sarvam returns 429 (rate limit)
 *   - Sarvam job fails/times out
 *   - OCR_FALLBACK=gemini in .env
 *
 * Endpoints used:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=KEY
 *
 * Sends credit alert email when Gemini returns 429 or quota exceeded.
 */
const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
const GEMINI_KEY_2 = process.env.GEMINI_API_KEY_2 || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const log = (...a) => console.log('[gemini]', ...a);

// Track which key is active
let _activeKey = GEMINI_KEY;
function activeKey() { return _activeKey || GEMINI_KEY; }

async function switchGeminiKey() {
  if (GEMINI_KEY_2 && _activeKey !== GEMINI_KEY_2) {
    log('Switching to Gemini key 2');
    _activeKey = GEMINI_KEY_2;
    return true;
  }
  return false;
}

// Send urgent alert email when credits exhausted
async function sendCreditAlert(service, error) {
  const recipient = process.env.CREDIT_ALERT_EMAIL || process.env.DIGEST_EMAIL || 'msivan@myaccounts.in';
  try {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({
      from: `"RetailCLIQ DocAI Alert" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
      to: recipient,
      subject: `🚨 URGENT: ${service} API Credits Exhausted — RetailCLIQ DocAI`,
      html: `<div style="font-family:Segoe UI,sans-serif;max-width:600px;background:#fff;padding:20px;border-radius:12px">
        <div style="background:#c62828;color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:16px">
          <h2 style="margin:0">🚨 ${service} Credits Exhausted</h2>
        </div>
        <p><b>Service:</b> ${service}</p>
        <p><b>Error:</b> ${error}</p>
        <p><b>Impact:</b> Document OCR / AI extraction will be degraded until credits are reloaded.</p>
        <p><b>Action Required:</b>
          <ul>
            <li>For Sarvam AI: Visit <a href="https://dashboard.sarvam.ai/billing">dashboard.sarvam.ai/billing</a></li>
            <li>For Google Gemini: Visit <a href="https://console.cloud.google.com/billing">Google Cloud Console</a></li>
          </ul>
        </p>
        <p><b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
        <hr>
        <p style="font-size:12px;color:#6b7280">RetailCLIQ DocAI · Auto-alert System · Fallback OCR is now active</p>
      </div>`,
    });
    log(`Credit alert sent to ${recipient} for ${service}`);
  } catch (e) {
    console.error('[gemini] Credit alert email failed:', e.message);
  }
}

// ── Core API call ────────────────────────────────────────────────────────────
async function generateContent(parts, opts = {}) {
  const model = opts.model || MODEL;
  const key   = activeKey();
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const body = {
    contents: [{ parts }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens || 8192,
      temperature: opts.temperature || 0.1,
      ...(opts.json ? { response_mime_type: 'application/json' } : {}),
    },
  };

  log('POST', model, `${JSON.stringify(parts).length} chars`);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE}/${model}:generateContent?key=${activeKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 90000,
    });

    if (res.status === 401 || res.status === 403) {
      if (attempt === 0 && await switchGeminiKey()) continue;
      const txt = await res.text();
      throw new Error(`Gemini auth failed (${res.status}): ${txt.slice(0, 200)}`);
    }

    if (res.status === 429 || res.status === 503) {
      const txt = await res.text();
      // Credit exhausted — try key 2
      if (attempt === 0 && await switchGeminiKey()) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      // Both keys exhausted — send alert
      sendCreditAlert('Google Gemini', txt.slice(0, 300)).catch(() => {});
      throw new Error(`Gemini quota exhausted (${res.status}) — credit alert sent`);
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${txt.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) throw new Error('Gemini returned empty response');
    log('response', text.slice(0, 100));
    return text;
  }
  throw new Error('Gemini: all keys failed');
}

// ── OCR: image file → markdown text ─────────────────────────────────────────
async function ocrImageToText(filePath) {
  const ext  = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[ext] || 'image/jpeg';
  const data = fs.readFileSync(filePath).toString('base64');

  log('OCR', path.basename(filePath), `(${mime}, ${Math.round(data.length * 0.75 / 1024)} KB)`);

  const text = await generateContent([
    { text: 'Extract ALL text from this document exactly as printed. Preserve table structure using | separators. Include all numbers, dates, labels and totals. Output plain text only — no markdown, no explanation.' },
    { inline_data: { mime_type: mime, data } },
  ], { maxTokens: 8192 });

  return { text, engine: 'gemini-vision', pages: [{ page: 1, content: text }] };
}

// ── Detect document type ──────────────────────────────────────────────────────
async function detectDocType(text, fileName) {
  const docTypes = require('./documentTypes');
  const sys = `You are a document classifier for an Indian retail ERP. Given document text, identify its type.
Allowed codes: ${docTypes.list().map(t => `${t.code}=${t.name}`).join('; ')}.
Bank statement indicators: bank name + account number + debit/credit/balance columns.
Return JSON: {"documentType":"<code>","confidence":0.0-1.0,"reasons":["..."],"alternatives":[{"documentType":"<code>","confidence":0.0}],"engine":"gemini"}`;

  const raw = await generateContent([
    { text: `${sys}\n\nFile: ${fileName}\n\n${text.slice(0, 8000)}` },
  ], { json: true });

  try {
    let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    const result = JSON.parse(t);
    result.engine = 'gemini';
    return result;
  } catch (e) {
    throw new Error(`Gemini detect parse error: ${e.message}`);
  }
}

// ── Structure document ────────────────────────────────────────────────────────
async function structureDoc(text, docTypeCode, fileName) {
  const docTypes = require('./documentTypes');
  const type = docTypes.get(docTypeCode) || docTypes.get('OTHER');
  const schema = docTypes.schemaFor(type.code);

  const sys = `${type.aiInstructions}\nOutput JSON matching this schema exactly (keys as given, unknown → null): ${JSON.stringify(schema.properties)}`;

  const raw = await generateContent([
    { text: `${sys}\n\nDocument text:\n${text.slice(0, 30000)}` },
  ], { json: true, maxTokens: 16384 });

  try {
    let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    return JSON.parse(t);
  } catch (e) {
    throw new Error(`Gemini structure parse error: ${e.message}`);
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
async function ping() {
  const out = { key: !!(GEMINI_KEY || GEMINI_KEY_2), model: MODEL, activeKey: activeKey() === GEMINI_KEY_2 ? 'key2' : 'key1' };
  if (!GEMINI_KEY && !GEMINI_KEY_2) { out.status = 'no key'; return out; }
  try {
    const t0 = Date.now();
    const r = await generateContent([{ text: 'Say OK in one word.' }], { maxTokens: 500 });
    out.status = `ok (${Date.now() - t0}ms): ${String(r).trim().slice(0,20)}`;
    out.ok = true;
  } catch (e) { out.status = e.message.slice(0,100); out.ok = false; }
  return out;
}

module.exports = { ocrImageToText, detectDocType, structureDoc, ping, sendCreditAlert, enabled: !!(GEMINI_KEY || GEMINI_KEY_2) };
