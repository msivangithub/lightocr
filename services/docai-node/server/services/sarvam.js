/**
 * Sarvam AI client for RetailCLIQ Document AI.
 * Endpoint shapes verified against the official `sarvamai` Python SDK (0.1.35) and `sarvam-mcp` (0.2.10).
 *
 * Document Intelligence (async jobs, base https://api.sarvam.ai):
 *   POST /doc-ai/v1/job/digitise   multipart: file, language, output_format(html|md|json), content_type(printed|handwritten|mixed), model
 *   POST /doc-ai/v1/job/extract    multipart: file, schema (JSON string) | config_id, language, output_format(json|csv|xlsx)
 *   GET  /doc-ai/v1/job/{job_id}/status        → { job_id, status, pipeline, usage{pages_total,...} }
 *   GET  /doc-ai/v1/job/{job_id}/results?format=json
 *          digitise → { type:'digitise', documents:[{file_name, pages:[{page_number, content}]}] }
 *          extract  → { type:'extract', result:{...}, annotations:{...confidence/sources}, version }
 *   GET  /doc-ai/v1/job/{job_id}/download-url  → { method, url }
 *   Terminal statuses: completed | partially_completed | failed | rejected
 *   Limits: PDF ≤ 10 pages, ZIP ≤ 10 images, 200 MB, 10 req/min.
 *
 * Chat: POST /v1/chat/completions  model sarvam-105b (sarvam-m / sarvam-30b are deprecated),
 *       supports response_format {type:'json_object'}.
 *
 * Auth header: api-subscription-key: <key>
 */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const BASE = (process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai').replace(/\/$/, '');
const KEY = process.env.SARVAM_API_KEY || '';
const KEY_2 = process.env.SARVAM_API_KEY_2 || '';  // backup key
const LANG = process.env.SARVAM_LANGUAGE || 'en-IN';
const CHAT_MODEL = process.env.SARVAM_CHAT_MODEL || 'sarvam-105b';
const POLL_MS = Number(process.env.SARVAM_POLL_INTERVAL_MS || 4000);
const POLL_TIMEOUT = Number(process.env.SARVAM_POLL_TIMEOUT_MS || 240000);
const TERMINAL = new Set(['completed', 'partially_completed', 'failed', 'rejected']);
const REQ_TIMEOUT = Number(process.env.SARVAM_REQUEST_TIMEOUT_MS || 90000);
const log = (...a) => console.log('[sarvam]', ...a);

// Track which key is active; switch to backup on auth failure
let activeKey = KEY;
function authHeaders(extra = {}) {
  const key = activeKey || KEY;
  if (!key) throw new Error('SARVAM_API_KEY is not set');
  return { 'api-subscription-key': key, ...extra };
}
function switchToBackupKey() {
  if (KEY_2 && activeKey !== KEY_2) {
    log('Switching to backup Sarvam key (SARVAM_API_KEY_2)');
    activeKey = KEY_2;
    return true;
  }
  return false;
}

async function readJson(res, what) {
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || body?.detail?.[0]?.msg || body?.detail || text.slice(0, 300);
    const err = new Error(`Sarvam ${what} failed (${res.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status; err.body = body; throw err;
  }
  return body;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- jobs */
async function startJob(kind, filePath, fields = {}) {
  const fd = new FormData();
  fd.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });
  fd.append('language', fields.language || LANG);
  for (const [k, v] of Object.entries(fields)) if (k !== 'language' && v != null) fd.append(k, String(v));
  log(`POST /doc-ai/v1/job/${kind}`, path.basename(filePath), JSON.stringify(fields));
  const res = await fetch(`${BASE}/doc-ai/v1/job/${kind}`, { method: 'POST', headers: authHeaders(fd.getHeaders()), body: fd, timeout: REQ_TIMEOUT });
  const out = await readJson(res, `${kind} job start`); log('job started', out.job_id, out.status); return out; // { job_id, status, pipeline }
}
async function getStatus(jobId) {
  return readJson(await fetch(`${BASE}/doc-ai/v1/job/${encodeURIComponent(jobId)}/status`, { headers: authHeaders(), timeout: REQ_TIMEOUT }), 'job status');
}
async function getResults(jobId, format = 'json') {
  return readJson(await fetch(`${BASE}/doc-ai/v1/job/${encodeURIComponent(jobId)}/results?format=${format}`, { headers: authHeaders(), timeout: REQ_TIMEOUT }), 'job results');
}
async function getDownloadUrl(jobId) {
  return readJson(await fetch(`${BASE}/doc-ai/v1/job/${encodeURIComponent(jobId)}/download-url`, { headers: authHeaders(), timeout: REQ_TIMEOUT }), 'download url');
}
async function waitForJob(jobId, onProgress) {
  const started = Date.now();
  for (;;) {
    const st = await getStatus(jobId);
    log('job', jobId, st.status, st.usage ? `${st.usage.pages_processed}/${st.usage.pages_total}` : '');
    onProgress && onProgress(st);
    const s = String(st.status || '').toLowerCase();
    if (TERMINAL.has(s)) {
      if (s === 'failed' || s === 'rejected') throw new Error(`Sarvam job ${jobId} ${s}${st.error_message ? ': ' + st.error_message : ''}`);
      return st;
    }
    if (Date.now() - started > POLL_TIMEOUT) throw new Error(`Sarvam job ${jobId} timed out after ${POLL_TIMEOUT} ms`);
    await sleep(POLL_MS);
  }
}

/** OCR a PDF/image → markdown text (page separated). */
async function digitiseToText(filePath, { contentType = 'printed', onProgress } = {}) {
  const job = await startJob('digitise', filePath, { output_format: 'md', content_type: contentType });
  await waitForJob(job.job_id, onProgress);
  const out = await getResults(job.job_id, 'json');
  const pages = [];
  for (const d of out.documents || []) for (const p of d.pages || []) pages.push({ page: p.page_number, content: p.content || '' });
  if (!pages.length && out.content) pages.push({ page: 1, content: out.content });
  return { jobId: job.job_id, usage: out.usage, pages, text: pages.map((p) => p.content).join('\n\n---- page ----\n\n') };
}

/** Schema-based field extraction. Returns { result, annotations } */
async function extractWithSchema(filePath, schema, { onProgress } = {}) {
  const job = await startJob('extract', filePath, { schema: JSON.stringify(schema), output_format: 'json' });
  await waitForJob(job.job_id, onProgress);
  const out = await getResults(job.job_id, 'json');
  return { jobId: job.job_id, usage: out.usage, result: out.result || {}, annotations: out.annotations || {} };
}

/* --------------------------------------------------------- chat / LLM */
async function chat(messages, { temperature = 0.1, max_tokens = 16000, json = false } = {}) {
  // sarvam-105b is a reasoning model: needs high max_tokens
  // reasoning_content uses tokens before content is produced; raise minimum significantly
  if (max_tokens < 4000) max_tokens = 4000;
  const body = { model: CHAT_MODEL, messages, temperature, max_tokens };
  if (json) body.response_format = { type: 'json_object' };
  log('POST /v1/chat/completions', CHAT_MODEL, `${JSON.stringify(messages).length} chars, max_tokens=${max_tokens}`);
  
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        timeout: REQ_TIMEOUT
      });
      if (res.status === 401 || res.status === 403) {
        // Auth failure - try switching to backup key
        if (attempt === 0 && switchToBackupKey()) continue;
        const text = await res.text();
        throw new Error(`Sarvam auth failed (${res.status}): ${text.slice(0, 200)}`);
      }
      if (res.status === 429) {
        // Rate limited - try backup key
        if (attempt === 0 && switchToBackupKey()) { await sleep(1000); continue; }
        throw new Error('Sarvam rate limit reached on all keys');
      }
      const out = await readJson(res, 'chat completion');
      const content = out.choices?.[0]?.message?.content;
      if (!content && out.choices?.[0]?.finish_reason === 'length') {
        throw new Error(`Sarvam chat ran out of tokens (max_tokens=${max_tokens}). Try reducing input size.`);
      }
      return content ?? '';
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && switchToBackupKey()) { await sleep(500); continue; }
      break;
    }
  }
  throw lastErr || new Error('Sarvam chat failed');
}
async function chatJson(system, user, opts = {}) {
  const content = await chat([
    { role: 'system', content: `${system}\nRespond with ONLY one valid JSON object. No markdown, no explanation, just raw JSON.` },
    { role: 'user', content: user },
  ], { ...opts, json: true });
  if (!content) throw new Error('Sarvam returned empty content (model ran out of tokens — reasoning used too many tokens; simplify input)');
  return parseLooseJson(content);
}
function parseLooseJson(text) {
  if (!text) throw new Error('Empty model response');
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

/** Lightweight connectivity/key check used by /api/docai/diag */
async function ping() {
  const out = { key: !!(KEY || KEY_2), base: BASE, model: CHAT_MODEL, keys: KEY ? (KEY_2 ? '2 keys (primary + backup)' : '1 key (primary)') : (KEY_2 ? '1 key (backup only)' : 'NO KEYS') };
  if (!KEY && !KEY_2) { out.chat = 'No SARVAM_API_KEY set'; return out; }
  try {
    const t0 = Date.now();
    const r = await chat([{ role: 'user', content: 'Reply with the single word OK' }], { max_tokens: 4000 });
    out.chat = `ok (${Date.now() - t0} ms): ${String(r).trim().slice(0, 20)}`;
    out.chatOk = true;
    out.activeKey = activeKey === KEY_2 ? 'backup' : 'primary';
  } catch (e) { out.chat = e.message; out.chatOk = false; }
  try {
    const r = await fetch(`${BASE}/doc-ai/v1/job/00000000-0000-0000-0000-000000000000/status`, { headers: authHeaders(), timeout: 20000 });
    out.docAi = r.status === 401 || r.status === 403 ? `auth rejected (${r.status})` : `reachable (HTTP ${r.status})`;
    out.docAiOk = r.status !== 401 && r.status !== 403;
  } catch (e) { out.docAi = e.message; out.docAiOk = false; }
  return out;
}

module.exports = { ping, enabled: !!KEY, model: CHAT_MODEL, startJob, getStatus, getResults, getDownloadUrl, waitForJob, digitiseToText, extractWithSchema, chat, chatJson, parseLooseJson };
