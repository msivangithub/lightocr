import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, API } from './api';
import { useI18n, LanguageSwitcher } from './lib/manchala-i18n.react.js';
import Dashboard from './Dashboard';

const STEPS = ['SOURCE', 'DETECT', 'EXTRACT', 'REVIEW', 'MAP', 'VALIDATE', 'CONVERT', 'RECONCILE', 'POST', 'RESULT'];

/** IST-aware date/time formatter */
const IST_OPTS = { timeZone: 'Asia/Kolkata' };
const fmtIST = (d) => {
  try {
    return new Date(d).toLocaleString('en-IN', { ...IST_OPTS, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(d || ''); }
};
const fmtTimeIST = (d) => {
  try { return new Date(d).toLocaleTimeString('en-IN', IST_OPTS); }
  catch { return String(d || ''); }
};

const money = (n) => n == null ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isNum = (f) => f && ['number', 'money', 'int'].includes(f.type);
const sumLines = (lines, key) => lines.reduce((s, l) => s + (Number(l[key]) || 0), 0);

function Toast({ msg, err, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, err ? 5000 : 2600); return () => clearTimeout(t); }, [err, onClose]);
  return <div className={`toast${err ? ' err' : ''}`}>{msg}</div>;
}

function Spinner({ msg }) {
  return (
    <div className="busy" data-testid="spinner">
      <div className="spin" />
      <div>{msg || 'Processing…'}</div>
    </div>
  );
}

function ProgressCard({ title, progress, onCancel }) {
  const p = progress || {};
  const log = (p.log || []).slice(-12);
  const pct = p.done ? 100 : p.error ? 100 : Math.min(90, 10 + (p.log?.length || 0) * 6);
  return (
    <div className="card" data-testid="progress-card">
      <h1>{title}</h1>
      <p className="sub">{p.message || 'Working…'}</p>
      <div className="prog"><i style={{ width: `${pct}%`, background: p.error ? 'var(--err)' : undefined }} /></div>
      <div className="audit">
        {log.length ? log.map((l, i) => (
          <div key={i}><code>{fmtTimeIST(l.at)}</code> <span className={`badge b-info`}>{l.stage || ''}</span> {l.message || ''}</div>
        )) : <div className="help" style={{ padding: 8 }}>Waiting for the server…</div>}
      </div>
      <div className="footer">
        <span className="help">Sarvam OCR jobs take 10–90 s; large scans longer.</span>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ErrorCard({ title, err, onReset, onRetry, onDiag }) {
  return (
    <div className="card" data-testid="error-card">
      <h1 style={{ color: 'var(--err)' }}>{title} failed</h1>
      <div className="issue"><span className="badge b-err">error</span>
        <div><b>{err.message}</b>{err.detail && <div className="help" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{err.detail}</div>}</div>
      </div>
      {(err.log || []).length > 0 && (
        <details><summary className="help">Progress log ({err.log.length})</summary>
          <div className="audit">{err.log.map((l, i) => <div key={i}><code>{fmtTimeIST(l.at)}</code> {l.message}</div>)}</div>
        </details>
      )}
      <p className="help" style={{ marginTop: 10 }}>Common causes: wrong/expired SARVAM_API_KEY, Sarvam Document AI not enabled, no outbound internet, PDF over 200 MB, or (local engine) tesseract/poppler missing.</p>
      <div className="footer">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onReset}>← Start over</button>
          <button className="btn" onClick={onDiag}>🩺 Check setup</button>
        </div>
        {onRetry && <button className="btn primary" onClick={onRetry}>Retry</button>}
      </div>
    </div>
  );
}

/* ==================================================================== DOCAI WIZARD */
export default function DocAIWizard({ initialBatchId, onGoToDashboard, onGoToBatches }) {
  const [step, setStep] = useState(0);       // 0-9 = wizard steps, -1 = inbox
  const [batch, setBatch] = useState(null);
  const [types, setTypes] = useState([]);
  const [type, setType] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState(null);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const [reviewTab, setReviewTab] = useState('preview');
  const [allHeader, setAllHeader] = useState(false);
  const [source, setSource] = useState({ kind: 'file', file: null, text: '' });
  const [inbox, setInbox] = useState({ jobs: [], job: null, files: [], engine: null, erp: null });
  const [tenant, setTenant] = useState({ clientId: null, clientName: null, tenantDb: null, resolved: false });
  const [showDashboard, setShowDashboard] = useState(false);
  const waitingRef = useRef(false);
  const camRef = useRef(null);
  const { formatDate, formatCurrency, lang } = useI18n();

  const showToast = useCallback((msg, isErr) => setToast({ msg, err: isErr }), []);

  // Init — detect tenant from URL or localStorage, then load health/types/history
  useEffect(() => {
    (async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const clientId = urlParams.get('clientId') || urlParams.get('client_id') || localStorage.getItem('retailcliq.clientId') || null;
        if (clientId) localStorage.setItem('retailcliq.clientId', clientId);

        const tenantHeaders = clientId ? { 'x-client-id': clientId } : {};
        const tenantRes = await fetch(`${window._BACKEND_URL || process.env.REACT_APP_BACKEND_URL}/api/docai/tenant/resolve${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`, { headers: tenantHeaders });
        if (tenantRes.ok) {
          const td = await tenantRes.json();
          setTenant({ clientId: td.clientId, clientName: td.clientName, tenantDb: td.tenantDb, resolved: td.resolved });
        }

        const [h, t, hist] = await Promise.all([api('/health'), api('/doc-types'), api('/batches')]);
        setHealth(h); setTypes(t); setHistory(hist.slice(0, 10)); // limit to 10

        // If an initial batch was passed (from Batch Report), open it
        if (initialBatchId) {
          const b = await api(`/batches/${initialBatchId}`);
          setBatch(b);
          setType(t.find(tp => tp.code === b.docType));
          setStep(Math.max(0, STEPS.indexOf(b.step)));
          if (b.status === 'posted') setStep(9);
        }
      } catch (e) { showToast('Server not reachable: ' + e.message, true); }
    })();
  }, [showToast, initialBatchId]);

  const reset = useCallback(() => {
    setErr(null); setProgress(null); setStep(0); setBatch(null); setType(null);
    setSource({ kind: 'file', file: null, text: '' }); setBusy(null);
    api('/batches').then(setHistory).catch(() => {});
  }, []);

  const goto = useCallback((i) => { setStep(i); setErr(null); }, []);

  // ---- WAIT STEP (poll progress) ----
  const waitStep = useCallback(async (stepName) => {
    waitingRef.current = true;
    for (;;) {
      if (!waitingRef.current) return null;
      await new Promise(r => setTimeout(r, 1500));
      let pr;
      try { pr = await api(`/batches/${batch.id}/progress`); } catch { continue; }
      setProgress(pr);
      if (pr.error) {
        waitingRef.current = false;
        setProgress(null);
        setErr({ step: stepName, message: pr.error, detail: pr.errorDetail, log: pr.log });
        return null;
      }
      if (pr.done && !pr.running) { waitingRef.current = false; return pr; }
    }
  }, [batch]);

  const cancelWait = useCallback(() => {
    waitingRef.current = false; setProgress(null);
    setErr({ step: step === 2 ? 'extract' : 'detect', message: 'Cancelled by user (the server may still finish in the background).' });
  }, [step]);

  // ---- SOURCE SUBMIT ----
  const submitSource = useCallback(async () => {
    try {
      setErr(null); setBusy('Uploading source…');
      let body;
      const k = source.kind;
      if (k === 'file' || k === 'camera') {
        body = new FormData();
        body.append('file', source.file);
        body.append('kind', k);
        body.append('contentType', document.getElementById('contentType')?.value || 'mixed');
      } else if (k === 'bankstmt') {
        // Bank statement upload — set docType hint to BST
        body = new FormData();
        body.append('file', source.file);
        body.append('kind', 'file');
        body.append('contentType', document.getElementById('contentType')?.value || 'printed');
        body.append('docTypeHint', 'BST');
        const bankName = document.getElementById('bankNameSel')?.value;
        const accType = document.getElementById('bankAccType')?.value;
        if (bankName) body.append('bankName', bankName);
        if (accType) body.append('bankAccountType', accType);
      } else if (k === 'edi') {
        // PT/EDI file
        const docIntent = document.getElementById('ediDocIntent')?.value;
        const erpSource = document.getElementById('erpSource')?.value;
        if (source.file) {
          body = new FormData();
          body.append('file', source.file);
          body.append('kind', 'file');
          body.append('contentType', 'printed');
          if (docIntent) body.append('docTypeHint', docIntent);
          if (erpSource) body.append('erpSource', erpSource);
        } else {
          body = { kind: 'text', text: source.text, docTypeHint: docIntent || 'PT_PUR', erpSource };
        }
      } else if (k === 'manual') {
        const lines = (document.getElementById('mLines')?.value || '').split('\n').filter(Boolean).map((l, i) => {
          const [description, qty, uom, rate, taxPct] = l.split(',').map(s => s.trim());
          return { lineNo: i + 1, description, qty: +qty, uom, rate: +rate, taxPct: +taxPct || 0, amount: +qty * +rate };
        });
        body = {
          kind: 'manual', fileName: 'manual-' + document.getElementById('manualType')?.value,
          payload: { documentType: document.getElementById('manualType')?.value, header: { party: document.getElementById('mParty')?.value, docNo: document.getElementById('mNo')?.value, docDate: document.getElementById('mDate')?.value, grandTotal: lines.reduce((s, l) => s + l.amount * (1 + l.taxPct / 100), 0) }, lines }
        };
      } else if (k === 'api') { body = { kind: 'api', payload: source.text }; }
      else { body = { kind: 'text', text: source.text }; }
      const newBatch = await api('/batches', { method: 'POST', body });
      setBatch(newBatch); setBusy(null);
      await runDetect(newBatch);
    } catch (e) {
      setBusy(null);
      setErr({ step: 'detect', message: e.message });
      setStep(1);
    }
  }, [source]);

  // ---- DETECT ----
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runDetect = useCallback(async (b, retry) => {
    const useBatch = b || batch;
    setErr(null); setStep(1); setProgress({ log: [], message: 'Starting…' });
    try {
      await api(`/batches/${useBatch.id}/detect`, { method: 'POST', body: { retry: !!retry } });
      const pr = await waitStepWithBatch(useBatch.id, 'detect');
      if (!pr) return;
      const full = await api(`/batches/${useBatch.id}`);
      setBatch(full); setType(types.find(t => t.code === full.docType)); setProgress(null);
    } catch (e) {
      setProgress(null);
      setErr({ step: 'detect', message: e.message, retry: () => runDetect(useBatch, true) });
    }
  }, [batch, types]); // eslint-disable-line react-hooks/exhaustive-deps

  const waitStepWithBatch = async (batchId, stepName) => {
    waitingRef.current = true;
    for (;;) {
      if (!waitingRef.current) return null;
      await new Promise(r => setTimeout(r, 1500));
      let pr;
      try { pr = await api(`/batches/${batchId}/progress`); } catch { continue; }
      setProgress(pr);
      if (pr.error) {
        waitingRef.current = false; setProgress(null);
        setErr({ step: stepName, message: pr.error, detail: pr.errorDetail, log: pr.log });
        return null;
      }
      if (pr.done && !pr.running) { waitingRef.current = false; return pr; }
    }
  };

  // ---- EXTRACT ----
  const runExtract = useCallback(async () => {
    setErr(null); setStep(2); setProgress({ log: [], message: 'Starting extraction…' });
    try {
      await api(`/batches/${batch.id}/extract`, { method: 'POST' });
      const pr = await waitStepWithBatch(batch.id, 'extract');
      if (!pr) return;
      const full = await api(`/batches/${batch.id}`);
      setBatch(full); setType(types.find(t => t.code === full.docType)); setProgress(null); setStep(3);
    } catch (e) {
      setProgress(null);
      setErr({ step: 'extract', message: e.message, retry: runExtract });
    }
  }, [batch, types]);

  // ---- DIAG ----
  const showDiag = useCallback(async () => {
    setBusy('Checking setup (key, Sarvam, binaries)…');
    let d;
    try { d = await api('/diag'); } catch (e) { d = { error: e.message }; }
    setBusy(null);

    const closeModal = () => { const m = document.getElementById('diagModal'); if (m) m.remove(); };
    const row = (k, v, ok) => `<div class="unit-row"><span class="badge ${ok === true ? 'b-ok' : ok === false ? 'b-err' : 'b-muted'}">${ok === true ? 'ok' : ok === false ? 'fail' : 'info'}</span><b style="min-width:160px">${k}</b><span class="help" style="flex:1">${typeof v === 'object' ? JSON.stringify(v) : String(v || '')}</span></div>`;

    const el = document.createElement('div');
    el.id = 'diagModal';
    el.className = 'modal';
    el.addEventListener('click', (ev) => { if (ev.target === el) closeModal(); });
    el.innerHTML = `<div class="box">
      <h1>Setup check ${d.ok ? '<span class="badge b-ok">all good</span>' : '<span class="badge b-err">problems found</span>'}</h1>
      ${d.error ? row('server', d.error, false) : ''}
      ${row('Mode', d.mock ? 'MOCK' : 'live', true)}
      ${row('OCR engine', d.ocrEngine, true)}
      ${row('LLM engine', d.llmEngine, true)}
      ${row('Sarvam mode', d.sarvamMode, true)}
      ${row('Fallback engine', d.fallbackEngine || 'gemini', true)}
      ${d.sarvam ? row('Sarvam keys', d.sarvam.key ? (d.sarvam.keys || 'present') : 'MISSING', !!d.sarvam.key) + row('Active key', d.sarvam.activeKey || 'primary', true) + row('Sarvam chat (' + (d.sarvam.model || 'sarvam-105b') + ')', d.sarvam.chat, !!d.sarvam.chatOk) + row('Sarvam Document AI', d.sarvam.docAi, !!d.sarvam.docAiOk) + row('Base URL', d.sarvam.base, true) : ''}
      ${d.gemini ? row('Gemini fallback (' + (d.gemini.model || 'gemini-2.5-flash') + ')', d.gemini.status || (d.gemini.ok ? 'ok' : 'not available'), !!d.gemini.ok) + row('Gemini active key', d.gemini.activeKey || 'key1', true) : row('Gemini fallback', 'Not configured (set GEMINI_API_KEY)', false)}
      ${d.tesseract ? row('Tesseract (local OCR)', d.tesseract.status || (d.tesseract.ok ? 'ok' : 'not installed'), !!d.tesseract.ok) + (d.tesseract.ok ? row('Tesseract version', d.tesseract.version || '5.x', true) + row('Tesseract languages', (d.tesseract.langs || []).join(', '), true) : '') : row('Tesseract', 'Not detected', false)}
      ${d.lightOcr ? row('⚡ light-OCR (PP-OCRv6, Tier 1)', d.lightOcr.status || (d.lightOcr.ok ? 'ok' : 'not available'), !!d.lightOcr.ok) + (d.lightOcr.ok ? row('light-OCR model', d.lightOcr.model || 'PP-OCRv6 Small', true) + row('light-OCR dict', (d.lightOcr.dictSize || 0) + ' chars', true) : '') : row('light-OCR', 'Not loaded — check models/light-ocr/', false)}
      <div style="margin: 8px 0; padding: 10px 14px; background: linear-gradient(135deg,#f0fdf4,#eff6ff); border-radius: 8px; font-size: 12px; border: 1px solid #bbf7d0;"><b>5-Tier Offline-First Chain:</b> ⚡ light-OCR → 🔡 Tesseract → 🤖 Sarvam AI → ✨ Gemini → 📐 Heuristic<br>Confidence threshold: <b>${d.minConfidence || 0.60}</b> · <b>100% uptime — 2 local engines run without internet</b></div>
      ${d.tools ? Object.entries(d.tools).map(([k, v]) => row('tool: ' + k, v ? 'found' : 'not found', k === 'tesseract' && d.ocrEngine !== 'local' ? null : k.startsWith('pdf') && d.ocrEngine === 'sarvam' ? null : !!v)).join('') : ''}
      ${row('Database', d.db, d.db === 'connected' ? true : null)}
      ${row('Node', d.node, true)}
      ${(d.hints || []).length ? '<h2 style="margin-top:12px">What to fix</h2>' + d.hints.map(h => `<div class="issue"><span class="badge b-warn">fix</span><div>${h}</div></div>`).join('') : ''}
      <div class="footer"><span class="help">Run again after changing .env and restarting.</span><button id="diagCloseBtn" class="btn primary" data-testid="btn-diag-close">Close</button></div>
    </div>`;
    document.body.appendChild(el);
    // Attach close handler after DOM insertion (avoids onclick="" issues in React)
    const closeBtn = document.getElementById('diagCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
  }, []);

  // ---- CHANGE TYPE ----
  const changeType = useCallback(async (code) => {
    try {
      const r = await api(`/batches/${batch.id}/doc-type`, { method: 'PUT', body: { code } });
      setBatch(b => ({ ...b, docType: r.docType }));
      setType(r.type);
    } catch (e) { showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- REVIEW ----
  const editHeader = useCallback((key, val, f) => {
    setBatch(b => ({ ...b, header: { ...b.header, [key]: isNum(f) ? (val === '' ? null : Number(val)) : val || null } }));
  }, []);
  const editLine = useCallback((i, key, val, f) => {
    setBatch(b => {
      const lines = [...b.lines];
      lines[i] = { ...lines[i], [key]: isNum(f) ? (val === '' ? null : Number(val)) : val || null };
      const l = lines[i];
      if (['qty', 'rate', 'discountAmt', 'taxPct'].includes(key) && l.qty != null && l.rate != null) {
        lines[i].amount = Math.round((l.qty * l.rate - (l.discountAmt || 0)) * 100) / 100;
        if (l.taxPct != null) lines[i].taxAmt = Math.round(lines[i].amount * l.taxPct) / 100;
      }
      return { ...b, lines };
    });
  }, []);
  const addLine = useCallback(() => setBatch(b => ({ ...b, lines: [...b.lines, { lineNo: b.lines.length + 1 }] })), []);
  const delLine = useCallback((i) => setBatch(b => ({ ...b, lines: b.lines.filter((_, j) => j !== i).map((l, j) => ({ ...l, lineNo: j + 1 })) })), []);

  const saveReview = useCallback(async () => {
    try {
      setBusy('Saving review & suggesting master mappings…');
      await api(`/batches/${batch.id}/review`, { method: 'PUT', body: { header: batch.header, lines: batch.lines } });
      const mapItems = await api(`/batches/${batch.id}/map/suggest`, { method: 'POST' });
      setBatch(b => ({ ...b, mapItems }));
      setStep(4); setBusy(null);
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- MAP ----
  const mapSel = useCallback((id, code) => {
    setBatch(b => ({
      ...b, mapItems: b.mapItems.map(it => it.id === id ? { ...it, selected: code || null, action: code ? 'map' : it.action, status: code ? 'mapped' : it.status } : it)
    }));
  }, []);
  const mapAct = useCallback((id, a) => {
    setBatch(b => ({
      ...b, mapItems: b.mapItems.map(it => {
        if (it.id !== id) return it;
        let selected = a === 'map' ? (it.selected || (it.candidates?.[0]?.code)) : null;
        let status = a === 'map' ? (selected ? 'mapped' : 'unmatched') : a === 'create' ? 'create' : a === 'skip' ? 'skipped' : 'later';
        return { ...it, action: a, selected, status };
      })
    }));
  }, []);
  const mapSearch = useCallback(async (id, master) => {
    const q = prompt(`Search ${master} master`);
    if (q == null) return;
    try {
      const rows = await api(`/masters/${master}?q=${encodeURIComponent(q)}`);
      setBatch(b => ({
        ...b, mapItems: b.mapItems.map(it => {
          if (it.id !== id) return it;
          const cands = rows.map(r => ({ ...r, score: 0.5 })).concat(it.candidates || []).slice(0, 15);
          return { ...it, candidates: cands, selected: rows[0]?.code || it.selected, action: rows[0] ? 'map' : it.action, status: rows[0] ? 'mapped' : it.status };
        })
      }));
    } catch (e) { showToast(e.message, true); }
  }, [showToast]);

  const applyMap = useCallback(async () => {
    const pending = (batch.mapItems || []).filter(i => !i.action);
    if (pending.length && !window.confirm(`${pending.length} reference(s) have no action — they will be flagged as New Master in validation. Continue?`)) return;
    try {
      setBusy('Applying mappings & validating…');
      const decisions = (batch.mapItems || []).filter(i => i.action).map(i => ({ id: i.id, action: i.action, selected: i.selected }));
      const r = await api(`/batches/${batch.id}/map`, { method: 'PUT', body: { decisions } });
      setBatch(b => ({ ...b, ...r }));
      const validation = await api(`/batches/${batch.id}/validate`, { method: 'POST' });
      setBatch(b => ({ ...b, validation }));
      setStep(5); setBusy(null);
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- BST GL MAP ----
  const saveBstGlMap = useCallback(async (decisions) => {
    try {
      setBusy('Saving GL account mappings…');
      await api(`/batches/${batch.id}/bst-gl-mapping`, { method: 'PUT', body: { decisions } });
      const validation = await api(`/batches/${batch.id}/validate`, { method: 'POST' });
      setBatch(b => ({ ...b, validation }));
      setStep(5); setBusy(null);
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- VALIDATE ----
  const revalidate = useCallback(async () => {
    try {
      setBusy('Validating…');
      await api(`/batches/${batch.id}/review`, { method: 'PUT', body: { header: batch.header, lines: batch.lines } });
      const validation = await api(`/batches/${batch.id}/validate`, { method: 'POST' });
      setBatch(b => ({ ...b, validation }));
      setBusy(null);
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- RELATIONSHIPS ----
  const loadRelationships = useCallback(async () => {
    try {
      setBusy('Looking up related documents…');
      const r = await api(`/batches/${batch.id}/relationships`);
      setBatch(b => ({ ...b, relationshipOptions: r.options, relationship: r.selected }));
      setStep(6); setBusy(null);
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [batch, showToast]);
  const setRel = useCallback(async (mode, target, linkedDocNo) => {
    try {
      const r = await api(`/batches/${batch.id}/relationships`, { method: 'PUT', body: { mode, target, linkedDocNo: linkedDocNo || null, autoCreate: mode === 'creates' ? [target] : [] } });
      setBatch(b => ({ ...b, relationship: r }));
    } catch (e) { showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- RECONCILE ----
  const runReconcile = useCallback(async () => {
    try {
      setBusy('Reconciling totals…');
      const reconciliation = await api(`/batches/${batch.id}/reconcile`, { method: 'POST' });
      setBatch(b => ({ ...b, reconciliation }));
      setStep(7); setBusy(null);
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [batch, showToast]);
  const overrideCheck = useCallback(async (key) => {
    const reason = prompt('Reason for overriding this mismatch (recorded in audit):');
    if (!reason) return;
    try {
      const reconciliation = await api(`/batches/${batch.id}/reconcile/override`, { method: 'POST', body: { key, reason } });
      setBatch(b => ({ ...b, reconciliation }));
    } catch (e) { showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- POST ----
  const loadPlan = useCallback(async () => {
    try {
      const plan = await api(`/batches/${batch.id}/plan`);
      setBatch(b => ({ ...b, plan }));
      setStep(8);
    } catch (e) { showToast(e.message, true); }
  }, [batch, showToast]);
  const doPost = useCallback(async (approve) => {
    try {
      setBusy(approve ? 'Approving & posting…' : 'Posting…');
      const result = await api(`/batches/${batch.id}/post`, { method: 'POST', body: { approve } });
      const full = await api(`/batches/${batch.id}`);
      setBatch(full); setStep(9); setBusy(null);
      showToast(result.status === 'posted' ? 'Posted ' + result.createdDocNo : 'Submitted for approval');
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [batch, showToast]);

  // ---- OPEN BATCH ----
  const openBatch = useCallback(async (id) => {
    try {
      setBusy('Opening batch…');
      const b = await api(`/batches/${id}`);
      setBatch(b);
      setType(types.find(t => t.code === b.docType));
      setStep(Math.max(0, STEPS.indexOf(b.step)));
      if (b.status === 'posted') setStep(9);
      setBusy(null);
    } catch (e) { setBusy(null); showToast(e.message, true); }
  }, [types, showToast]);

  // ---- ERP PREVIEW ----
  const erpPreview = useCallback(async (batchId) => {
    try {
      const screen = document.getElementById('ibScreen')?.value || 'PI';
      const erp = await api(`/batches/${batchId}/erp?screen=${encodeURIComponent(screen)}`);
      setInbox(i => ({ ...i, erp, job: null }));
      setStep(-1);
    } catch (e) { showToast(e.message, true); }
  }, [showToast]);

  // ---- INBOX ----
  const openInbox = useCallback(async (keep) => {
    setStep(-1); setBatch(null);
    if (!keep) {
      try {
        const [engine, jobs] = await Promise.all([api('/intake/engine').catch(() => null), api('/intake').catch(() => [])]);
        setInbox(i => ({ ...i, engine, jobs, erp: null, job: null }));
      } catch {}
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ibStart = useCallback(async () => {
    const fd = new FormData();
    inbox.files.forEach(f => fd.append('files', f));
    fd.append('split', document.getElementById('ibSplit')?.value || 'auto');
    fd.append('contentType', document.getElementById('ibContent')?.value || 'mixed');
    fd.append('rotate', document.getElementById('ibRotate')?.value || '0');
    try {
      const job = await api('/intake', { method: 'POST', body: fd });
      setInbox(i => ({ ...i, job, files: [] }));
      ibListen(job);
      showToast('Intake started');
    } catch (e) { showToast(e.message, true); }
  }, [inbox.files, showToast]);

  const ibEsRef = useRef(null);
  const ibListen = useCallback((job) => {
    if (ibEsRef.current) ibEsRef.current.close();
    const es = new EventSource(`${API}/intake/${job.id}/events`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      setInbox(i => {
        let j = i.job || job;
        if (ev.type === 'snapshot') j = ev.job;
        else if (ev.type === 'unit') { const idx = j.units.findIndex(u => u.id === ev.unit.id); j = { ...j, units: idx >= 0 ? j.units.map((u, k) => k === idx ? ev.unit : u) : [...j.units, ev.unit] }; }
        else if (ev.type === 'job') { j = { ...j, status: ev.status }; if (ev.summary) j.summary = ev.summary; if (ev.units) j.units = ev.units; if (ev.status === 'done') { es.close(); showToast('Intake finished'); } }
        return { ...i, job: j };
      });
    };
    ibEsRef.current = es;
  }, [showToast]);

  const ibPostClean = useCallback(async () => {
    if (!window.confirm('Post every document that passed validation & reconciliation?')) return;
    try {
      const r = await api(`/intake/${inbox.job.id}/post`, { method: 'POST', body: { onlyClean: true } });
      showToast(`${r.filter(x => x.status === 'posted').length} posted, ${r.filter(x => x.skipped).length} skipped, ${r.filter(x => x.error).length} errors`);
      const job = await api(`/intake/${inbox.job.id}`);
      setInbox(i => ({ ...i, job }));
    } catch (e) { showToast(e.message, true); }
  }, [inbox.job, showToast]);

  // ---- CAMERA ----
  const camStart = useCallback(async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (camRef.current) camRef.current.srcObject = st;
    } catch (e) { showToast('Camera not available: ' + e.message, true); }
  }, [showToast]);
  const camShot = useCallback(() => {
    const v = camRef.current;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(b => {
      const f = new File([b], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setSource(s => ({ ...s, file: f }));
      (v.srcObject?.getTracks() || []).forEach(t => t.stop());
    }, 'image/jpeg', 0.92);
  }, []);

  // ---- RENDER ----
  if (showDashboard) return <Dashboard onBack={() => setShowDashboard(false)} tenant={tenant} />;
  if (step === -1 && inbox.erp) return <ErpView erp={inbox.erp} batchId={inbox.erp.batchId} types={types} onBack={() => setInbox(i => ({ ...i, erp: null }))} onOpen={openBatch} onToast={showToast} />;
  if (step === -1) return <InboxView inbox={inbox} types={types} onStart={ibStart} onFiles={fl => setInbox(i => ({ ...i, files: [...fl] }))} onBack={() => { setStep(0); setBatch(null); api('/batches').then(setHistory).catch(() => {}); }} onErp={erpPreview} onPostClean={ibPostClean} onOpenJob={async id => { const job = await api(`/intake/${id}`); setInbox(i => ({ ...i, job })); if (job.status !== 'done') ibListen(job); }} onToast={showToast} engine={inbox.engine} />;

  const chips = [];
  if (health) {
    const label = health.mock ? 'MOCK MODE' : `⚡ light-OCR · 🔡 Tesseract · 🤖 Sarvam · ✨ Gemini`;
    const cls = health.mock ? 'mock' : 'live';
    chips.push(<span key="mode" className={`chip ${cls}`}>{label}</span>);
  }
  if (tenant.resolved) {
    chips.push(<span key="tenant" className="chip" title={`Database: ${tenant.tenantDb}`} style={{ background: '#fff4e0', color: '#8a5200', borderColor: '#f3d9a8' }}>🏢 {tenant.clientName}</span>);
  }
  if (batch) chips.push(<span key="batch" className="chip">Batch {batch.id.slice(0, 8)}</span>);

  return (
    <div className="app" data-testid="docai-wizard">
      <header className="top">
        <div className="logo">Retail<b>CLIQ</b> &nbsp;·&nbsp; AI Document Wizard</div>
        {chips}
        <div className="spacer" />
        <LanguageSwitcher data-testid="lang-switcher" />
        {onGoToDashboard && <button className="btn sm" onClick={onGoToDashboard} data-testid="btn-go-dashboard">🏠 Dashboard</button>}
        <button className="btn sm" onClick={() => setShowDashboard(true)} data-testid="btn-dashboard" title="Dashboard & Stats">📊 Stats</button>
        <button className="btn sm" onClick={() => openInbox()} data-testid="btn-inbox">📥 Inbox / Bulk intake</button>
        {onGoToBatches ? (
          <button className="btn sm" onClick={onGoToBatches} data-testid="btn-batches">📋 Batches</button>
        ) : (
          <button className="btn sm" onClick={() => { api('/batches').then(h => { setHistory(h.slice(0, 10)); setStep(0); setBatch(null); window.scrollTo(0, document.body.scrollHeight); }); }}>Batches</button>
        )}
        <button className="btn sm primary" onClick={reset} data-testid="btn-new">+ New</button>
      </header>

      <nav className="stepper" data-testid="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i < step ? 'done' : i === step ? 'active' : ''}`}
            onClick={i < step && batch ? () => goto(i) : undefined}>
            <span className="n">{i < step ? '✓' : i + 1}</span>{s}
            {i < STEPS.length - 1 && <span className="arrow">›</span>}
          </div>
        ))}
      </nav>

      <main>
        {busy && <Spinner msg={busy} />}
        {!busy && renderStep()}
      </main>

      {toast && <Toast msg={toast.msg} err={toast.err} onClose={() => setToast(null)} />}
    </div>
  );

  function renderStep() {
    if (err && step === 1 && err.step === 'detect') return <ErrorCard title="Identify document" err={err} onReset={reset} onRetry={() => runDetect(null, true)} onDiag={showDiag} />;
    if (err && step === 2 && err.step === 'extract') return <ErrorCard title="Extraction" err={err} onReset={reset} onRetry={runExtract} onDiag={showDiag} />;
    if (step === 1 && progress) return <ProgressCard title="Reading & identifying document…" progress={progress} onCancel={cancelWait} />;
    if (step === 2 && progress) return <ProgressCard title="AI document reading & extraction" progress={progress} onCancel={cancelWait} />;

    switch (step) {
      case 0: return <SourceView source={source} types={types} health={health} history={history} onKind={k => { setSource(s => ({ ...s, kind: k, file: null, text: '', bankName: '' })); if (k === 'camera') setTimeout(camStart, 100); if (k === 'bulk') setTimeout(() => openInbox(), 50); }} onFile={f => setSource(s => ({ ...s, file: f }))} onText={t => setSource(s => ({ ...s, text: t }))} onBankName={n => setSource(s => ({ ...s, bankName: n }))} onSubmit={submitSource} onDiag={showDiag} onOpen={openBatch} camRef={camRef} onCamShot={camShot} onCamStart={camStart} onGoToBatches={onGoToBatches} />;
      case 1: return <DetectView batch={batch} types={types} type={type} onChangeType={changeType} onAccept={runExtract} onBack={() => goto(0)} onReset={reset} />;
      case 2: return <ProgressCard title="AI document reading & extraction" progress={progress || {}} onCancel={cancelWait} />;
      case 3: return <ReviewView batch={batch} type={type} reviewTab={reviewTab} allHeader={allHeader} onTabChange={setReviewTab} onAllHeader={setAllHeader} onEditHeader={editHeader} onEditLine={editLine} onAddLine={addLine} onDelLine={delLine} onSave={saveReview} onBack={() => goto(1)} onErp={() => erpPreview(batch?.id)} />;
      case 4: return batch?.docType === 'BST'
        ? <BstGlMapView batch={batch} onApply={saveBstGlMap} onBack={() => goto(3)} onToast={showToast} />
        : <MapView batch={batch} types={types} onMapSel={mapSel} onMapAct={mapAct} onMapSearch={mapSearch} onApply={applyMap} onBack={() => goto(3)} />;
      case 5: return <ValidateView batch={batch} onRevalidate={revalidate} onContinue={loadRelationships} onBack={() => goto(3)} onFixMap={() => goto(4)} />;
      case 6: return <ConvertView batch={batch} types={types} type={type} onSetRel={setRel} onReconcile={runReconcile} onBack={() => goto(5)} />;
      case 7: return <ReconcileView batch={batch} onOverride={overrideCheck} onRerun={runReconcile} onPlan={loadPlan} onBack={() => goto(3)} />;
      case 8: return <PostView batch={batch} type={type} onPost={doPost} onBack={() => goto(7)} />;
      case 9: return <ResultView batch={batch} onReset={reset} onHistory={() => { api('/batches').then(h => { setHistory(h); setStep(0); setBatch(null); }); }} onDownload={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' })); a.download = `docai-${batch.id}.json`; a.click(); }} />;
      default: return null;
    }
  }
}

/* ============================================================ SOURCE */
const INDIAN_BANKS = [
  'HDFC Bank', 'ICICI Bank', 'State Bank of India (SBI)', 'Axis Bank', 'Kotak Mahindra Bank',
  'Punjab National Bank (PNB)', 'Bank of Baroda (BOB)', 'Union Bank of India', 'Canara Bank',
  'IndusInd Bank', 'Yes Bank', 'IDFC First Bank', 'Federal Bank', 'South Indian Bank',
  'Indian Overseas Bank (IOB)', 'Indian Bank', 'UCO Bank', 'Bank of India', 'Central Bank of India',
  'City Union Bank', 'Karur Vysya Bank (KVB)', 'Tamilnad Mercantile Bank (TMB)',
  'RBL Bank', 'ESAF Bank', 'CSB Bank', 'Dhanlaxmi Bank', 'Bandhan Bank',
  'Nainital Bank', 'Utkarsh Small Finance Bank', 'Jana Small Finance Bank', 'Other Bank',
];

const ERP_SOURCES = [
  ['tally', 'Tally XML / JSON'],
  ['sap', 'SAP IDOC / XML'],
  ['quickbooks', 'QuickBooks IIF/CSV'],
  ['marg', 'Marg ERP'],
  ['busy', 'BUSY Accounting'],
  ['zoho', 'Zoho Books'],
  ['custom_edi', 'EDI / EDIFACT'],
  ['portal_csv', 'Portal CSV / Excel Export'],
  ['other_erp', 'Other ERP'],
];

function SourceView({ source, types, health, history, onKind, onFile, onText, onSubmit, onDiag, onOpen, camRef, onCamShot, onCamStart, onGoToBatches, onBankName }) {
  const canSubmit = () => {
    const k = source.kind;
    if (k === 'bankstmt') return !!source.file;  // bank name is optional hint — file alone is sufficient
    if (k === 'edi') return !!source.file || !!source.text.trim();
    return (k === 'file' || k === 'camera') ? !!source.file : k === 'manual' ? true : !!source.text.trim();
  };

  const srcTiles = [
    ['file', '📄', 'Upload file', 'PDF · Scan · Image · Excel · CSV'],
    ['camera', '📷', 'Camera capture', 'Photo a bill or challan'],
    ['text', '📋', 'Paste text', 'Copied email / message'],
    ['manual', '⌨️', 'Manual entry', 'Type the document'],
    ['bankstmt', '🏦', 'Bank Statement', 'HDFC · SBI · ICICI · any bank'],
    ['edi', '🔄', 'PT / EDI File', 'Tally · SAP · ERP · B2B format'],
    ['api', '🔌', 'API / External ERP', 'JSON payload from any software'],
    ['bulk', '📥', 'Bulk intake', 'Many files · ZIP/RAR · scans'],
  ];
  return (
    <div className="card" data-testid="step-source">
      <h1>What do you want to process?</h1>
      <p className="sub">Upload or capture any business document — AI will identify the document type automatically.</p>
      <div className="src-grid">
        {srcTiles.map(([k, ic, t, d]) => (
          <div key={k} className={`src ${source.kind === k ? 'active' : ''}`} onClick={() => onKind(k)} data-testid={`src-${k}`}>
            <div className="ic">{ic}</div><div className="t">{t}</div><div className="d">{d}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>{srcBody()}</div>
      <div className="footer">
        <span className="help">
          <button className="btn sm" onClick={onDiag} data-testid="btn-diag">🩺 Check setup</button>
          {health && <span style={{ marginLeft: 8 }}>Engine: {health.mock ? 'Mock (offline demo)' : `Sarvam AI · ${health.mode}`} · DB: {health.db ? 'connected' : 'in-memory'}</span>}
        </span>
        <button className="btn primary" data-testid="btn-submit-source" onClick={onSubmit} disabled={!canSubmit()}>Identify document →</button>
      </div>
      {history.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Recent batches <span className="badge b-muted" style={{ fontSize: 11 }}>Last 10</span></h2>
            {onGoToBatches && (
              <button className="btn sm" onClick={onGoToBatches} data-testid="btn-view-all-batches">
                View all batches →
              </button>
            )}
          </div>
          <div className="tbl-wrap">
            <table className="hist">
              <thead><tr><th>Batch</th><th>Type</th><th>Doc No</th><th>Party</th><th className="num">Total</th><th>Status</th><th>Created (IST)</th></tr></thead>
              <tbody>
                {history.slice(0, 10).map(b => (
                  <tr key={b.id} onClick={() => onOpen(b.id)} data-testid={`batch-row-${b.id.slice(0, 8)}`}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.id.slice(0, 8)}</td><td><span className="badge b-muted">{b.docType || '—'}</span></td><td style={{ fontWeight: 600 }}>{b.docNo || ''}</td><td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.party || ''}</td>
                    <td className="num">{money(b.grandTotal)}</td>
                    <td><span className={`badge ${b.status === 'posted' ? 'b-ok' : b.status === 'pending-approval' ? 'b-warn' : 'b-muted'}`}>{b.status}</span></td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtIST(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  function srcBody() {
    const k = source.kind;
    if (k === 'bulk') return '';
    if (k === 'file') return (
      <div>
        <div className={`drop`} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over'); }} onDragLeave={e => e.currentTarget.classList.remove('over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFile(e.dataTransfer.files[0]); }} onClick={() => document.getElementById('fileInp').click()} data-testid="drop-zone">
          <div style={{ fontSize: 30 }}>⬆️</div>
          <div><b>Drop a document here</b> or click to browse</div>
          <div className="help">PDF, scanned PDF, JPG/PNG, XLSX, CSV, ZIP (≤10 pages / images, 200 MB)</div>
          {source.file && <div style={{ marginTop: 10 }}><span className="badge b-ok">{source.file.name} · {(source.file.size / 1024).toFixed(0)} KB</span></div>}
        </div>
        <input id="fileInp" type="file" style={{ display: 'none' }} accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.tsv,.txt,.zip" onChange={e => onFile(e.target.files[0])} />
        <div className="grid g3" style={{ marginTop: 10 }}>
          <div className="field"><label>Document content</label><select id="contentType"><option value="printed">Printed</option><option value="mixed">Mixed (printed + handwritten)</option><option value="handwritten">Handwritten</option></select></div>
          <div className="field"><label>Language hint</label><select id="lang"><option>en-IN</option><option>hi-IN</option><option>te-IN</option><option>ta-IN</option></select></div>
        </div>
      </div>
    );
    if (k === 'camera') return (
      <div>
        <video ref={camRef} className="cam" autoPlay playsInline />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={onCamStart}>Start camera</button>
          <button className="btn primary" onClick={onCamShot}>Capture</button>
        </div>
        {source.file && <div style={{ marginTop: 8 }}><span className="badge b-ok">Captured {source.file.name}</span></div>}
      </div>
    );
    if (k === 'text') return <textarea className="big" placeholder="Paste invoice / PO / voucher / bank statement text here…" defaultValue={source.text} onChange={e => onText(e.target.value)} data-testid="text-input" />;
    if (k === 'manual') return (
      <div>
        <div className="grid g2">
          <div className="field"><label>Document type</label><select id="manualType">{types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select></div>
          <div className="field"><label>Party</label><input id="mParty" placeholder="Supplier / customer name" /></div>
          <div className="field"><label>Document No</label><input id="mNo" /></div>
          <div className="field"><label>Date</label><input id="mDate" type="date" /></div>
        </div>
        <div className="field" style={{ marginTop: 10 }}><label>Lines (one per line: description, qty, uom, rate, tax%)</label><textarea className="big" id="mLines" placeholder="Basmati Rice 5kg, 40, PCS, 410, 5" /></div>
        <p className="help">Manual entry goes through the same validation &amp; posting path.</p>
      </div>
    );
    if (k === 'bankstmt') return (
      <div>
        <div style={{ background: '#e0f2fe', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#0369a1' }}>
          🏦 <b>Bank Statement Import</b> — Upload a bank statement PDF, Excel or CSV. Sarvam AI will extract all transactions and link them to GL accounts for reconciliation.
        </div>
        <div className="grid g3" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Bank Name <span style={{ color: 'var(--err)' }}>*</span></label>
            <select id="bankNameSel" defaultValue="" onChange={e => onBankName && onBankName(e.target.value)} data-testid="bank-name-select">
              <option value="">— Select Bank —</option>
              {INDIAN_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Account Type</label>
            <select id="bankAccType">
              <option value="Savings">Savings Account</option>
              <option value="Current">Current Account</option>
              <option value="OD">Overdraft (OD)</option>
              <option value="CC">Cash Credit (CC)</option>
            </select>
          </div>
          <div className="field">
            <label>Content</label>
            <select id="contentType">
              <option value="printed">Printed PDF</option>
              <option value="mixed">Mixed (printed + handwritten)</option>
            </select>
          </div>
        </div>
        <div className="drop" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over'); }} onDragLeave={e => e.currentTarget.classList.remove('over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFile(e.dataTransfer.files[0]); }} onClick={() => document.getElementById('bankFileInp').click()} data-testid="bank-drop-zone">
          <div style={{ fontSize: 30 }}>📊</div>
          <div><b>Drop bank statement here</b> or click to browse</div>
          <div className="help">PDF, Excel (.xlsx), CSV — up to 200 MB</div>
          {source.file && <div style={{ marginTop: 10 }}><span className="badge b-ok">{source.file.name} · {(source.file.size / 1024).toFixed(0)} KB</span></div>}
        </div>
        <input id="bankFileInp" type="file" style={{ display: 'none' }} accept=".pdf,.xlsx,.xls,.csv" onChange={e => onFile(e.target.files[0])} />
      </div>
    );
    if (k === 'edi') return (
      <div>
        <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#15803d' }}>
          🔄 <b>PT / EDI / External ERP Import</b> — Upload purchase/sales files from Tally, SAP, QuickBooks, distributor portals, or any B2B EDI format. AI will parse and map to RetailCLIQ fields.
        </div>
        <div className="grid g2" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Source ERP / Software</label>
            <select id="erpSource">
              {ERP_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Document Intent</label>
            <select id="ediDocIntent">
              <option value="PT_PUR">Purchase (received from supplier/ERP)</option>
              <option value="PT_SAL">Sales (outgoing to customer/marketplace)</option>
              <option value="">Auto-detect</option>
            </select>
          </div>
        </div>
        <div className="drop" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over'); }} onDragLeave={e => e.currentTarget.classList.remove('over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFile(e.dataTransfer.files[0]); }} onClick={() => document.getElementById('ediFileInp').click()}>
          <div style={{ fontSize: 30 }}>📂</div>
          <div><b>Drop EDI/PT file here</b> or click to browse</div>
          <div className="help">XML · JSON · CSV · Excel · EDIFACT · IIF · ZIP archive</div>
          {source.file && <div style={{ marginTop: 10 }}><span className="badge b-ok">{source.file.name}</span></div>}
        </div>
        <input id="ediFileInp" type="file" style={{ display: 'none' }} accept=".xml,.json,.csv,.xlsx,.xls,.txt,.edi,.iif,.zip" onChange={e => onFile(e.target.files[0])} />
        <p style={{ marginTop: 8 }} className="help">Or paste raw EDI/XML/JSON text below:</p>
        <textarea className="big" style={{ minHeight: 120 }} placeholder='Paste Tally XML / SAP IDOC / JSON payload here…' defaultValue={source.text} onChange={e => onText(e.target.value)} />
      </div>
    );
    if (k === 'api') return (
      <div>
        <div style={{ background: '#fdf4ff', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#7e22ce' }}>
          🔌 <b>API / External ERP Payload</b> — Send a structured JSON payload from any ERP (Tally, SAP, Oracle, Zoho) or directly post from a webhook. The wizard accepts both pre-structured data and raw text for AI extraction.
        </div>
        <textarea className="big" placeholder={`{"documentType":"PI","header":{...},"lines":[...]}\n\n— OR Tally XML, SAP IDOC, bank CSV, portal order JSON —`} defaultValue={source.text} onChange={e => onText(e.target.value)} />
        <p className="help" style={{ marginTop: 8 }}>External systems can also call <code>POST /api/docai/batches</code> with <code>payload</code> field. Supports: RetailCLIQ JSON, Tally XML, SAP IDOC, QuickBooks IIF, generic CSV/Excel, bank CSV.</p>
      </div>
    );
    return null;
  }
}

/* ============================================================ DETECT */
function DetectView({ batch, types, type, onChangeType, onAccept, onBack, onReset }) {
  if (!batch?.detection) return <div className="card"><p>Loading…</p></div>;
  const d = batch.detection;
  const pct = Math.round((d.confidence || 0) * 100);
  const ENGINE_BADGE = {
    'light-ocr':  { label: '⚡ light-OCR', cls: 'b-info', tip: 'PP-OCRv6 Small (local ONNX, zero cost)' },
    'tesseract':  { label: '🔡 Tesseract', cls: 'b-muted', tip: 'Tesseract 5.3 (local binary, offline)' },
    'sarvam':     { label: '🤖 Sarvam AI', cls: 'b-ok', tip: 'Sarvam AI (cloud, best for Indian docs)' },
    'gemini':     { label: '✨ Gemini', cls: 'b-new', tip: 'Google Gemini 2.5-flash (cloud, Vision)' },
    'heuristic':  { label: '📐 Heuristic', cls: 'b-warn', tip: 'Regex heuristic (all AI engines unavailable)' },
    'bank-parser':{ label: '🏦 Bank Parser', cls: 'b-info', tip: 'Direct PDF/Excel bank statement parser (no OCR)' },
    'tally-xml':  { label: '🔄 Tally XML', cls: 'b-new', tip: 'Tally XML format auto-detected' },
  };
  const eng = ENGINE_BADGE[d.engine || 'sarvam'] || ENGINE_BADGE['heuristic'];
  const isAI = ['sarvam', 'gemini', 'light-ocr', 'bank-parser', 'tally-xml'].includes(d.engine);
  const confColor = pct >= 85 ? 'var(--ok)' : pct >= 65 ? 'var(--warn)' : 'var(--err)';
  const confLabel = pct >= 85 ? 'High confidence' : pct >= 65 ? 'Medium confidence — verify type' : 'Low confidence — please verify or change type';

  return (
    <div className="card" data-testid="step-detect">
      <h1>Document identified</h1>
      <p className="sub">AI reading result — accept it or change the document type before processing continues.</p>
      <div className="detect">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="help">DETECTED TYPE</span>
            <span className={`badge ${eng.cls}`} title={eng.tip}>{eng.label}</span>
          </div>
          <div className="big">{type?.name || batch.docType}</div>
          <div className="help">{(d.reasons || []).join(' · ')}</div>
        </div>
        <div>
          <div className="conf">
            <div className="bar"><i style={{ width: `${pct}%`, background: confColor }} /></div>
            <b style={{ color: confColor }}>Confidence {pct}%</b>
          </div>
          <div className="help" style={{ marginTop: 4 }}>
            {confLabel}
            {!isAI && <div style={{ marginTop: 4, color: 'var(--warn)' }}>⚠️ Sarvam AI detection failed — heuristic fallback used. Verify type manually.</div>}
            {pct < 65 && isAI && <div style={{ marginTop: 4 }}>Sarvam classified this document but is uncertain. Change type below if needed.</div>}
          </div>
        </div>
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="field">
          <label>Change document type</label>
          <select value={batch.docType} onChange={e => onChangeType(e.target.value)} data-testid="type-select">
            <optgroup label="📦 Trading Documents">
              {types.filter(t => ['PO','SO','PI','SI','GRN','DC','EST','DN','CN','PT_PUR','PT_SAL'].includes(t.code)).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </optgroup>
            <optgroup label="💰 Financial Vouchers (GL)">
              {types.filter(t => ['PV','RV','JV','EXP','GL','CTV','PDC'].includes(t.code)).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </optgroup>
            <optgroup label="🏦 Banking">
              {types.filter(t => ['BST','BRS','TDS'].includes(t.code)).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </optgroup>
            <optgroup label="📦 Inventory">
              {types.filter(t => ['ST','SA'].includes(t.code)).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </optgroup>
            <optgroup label="📄 Other">
              {types.filter(t => !['PO','SO','PI','SI','GRN','DC','EST','DN','CN','PT_PUR','PT_SAL','PV','RV','JV','EXP','GL','CTV','PDC','BST','BRS','TDS','ST','SA'].includes(t.code)).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </optgroup>
          </select>
        </div>
        <div className="field">
          <label>AI alternatives</label>
          <div>{(d.alternatives || []).map(a => (
            <span key={a.documentType} className="badge b-info" style={{ marginRight: 4, cursor: 'pointer' }} onClick={() => onChangeType(a.documentType)} title={`Click to change type to ${a.documentType}`}>
              {types.find(t => t.code === a.documentType)?.name || a.documentType} {Math.round(a.confidence * 100)}%
            </span>
          )) || '—'}</div>
        </div>
      </div>
      {batch.rawText && <details style={{ marginTop: 12 }}><summary className="help">Show OCR / source text ({batch.rawText.length} chars{batch.ocrJobId ? ` · Job ${batch.ocrJobId.slice(0, 16)}` : ''})</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f7f9fc', padding: 10, borderRadius: 8, maxHeight: 260, overflow: 'auto' }}>{batch.rawText.slice(0, 6000)}</pre></details>}
      <div className="footer">
        <button className="btn" onClick={onReset}>Cancel</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onBack}>← Back</button>
          <button className="btn primary" onClick={onAccept} data-testid="btn-accept-extract">Accept &amp; extract →</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ REVIEW */
function ReviewView({ batch, type, reviewTab, allHeader, onTabChange, onAllHeader, onEditHeader, onEditLine, onAddLine, onDelLine, onSave, onBack, onErp }) {
  if (!batch || !type) return <div className="card"><p>Loading…</p></div>;
  const hf = type.headerFields || [];
  const lf = (type.lineFields || []).filter(f => f.key !== 'lineNo');
  const iss = (batch.validation?.issues || []).filter(i => i.level !== 'info');
  const lv = { error: 'b-err', warning: 'b-warn', 'new-master': 'b-new' };
  const important = ['party', 'partyGstin', 'docNo', 'docDate', 'refNo', 'subTotal', 'cgst', 'sgst', 'igst', 'grandTotal'];
  const visibleHf = hf.filter(f => allHeader || f.required || (batch.header[f.key] != null && batch.header[f.key] !== '') || important.includes(f.key));

  function preview() {
    const f = batch.source?.fileName || '';
    if (reviewTab === 'text') return <pre style={{ whiteSpace: 'pre-wrap', padding: 12, margin: 0, fontSize: 12 }}>{batch.rawText || '(no text)'}</pre>;
    if (reviewTab === 'json') return <pre style={{ whiteSpace: 'pre-wrap', padding: 12, margin: 0, fontSize: 12 }}>{JSON.stringify(batch.extraction?.raw, null, 2)}</pre>;
    if (batch.source?.pageImages?.length) return <>{batch.source.pageImages.map((p, i) => <img key={i} src={`${API}/intake/file?p=${encodeURIComponent(p)}`} style={{ marginBottom: 6, width: '100%' }} alt="" />)}</>;
    if (!batch.source?.path) return <pre style={{ whiteSpace: 'pre-wrap', padding: 12, margin: 0, fontSize: 12 }}>{batch.source?.text || batch.rawText || ''}</pre>;
    if (/\.pdf$/i.test(f)) return <iframe src={`${API}/batches/${batch.id}/file#toolbar=0`} title="doc" style={{ width: '100%', border: 0, minHeight: 360, display: 'block' }} />;
    if (/\.(png|jpe?g|webp)$/i.test(f)) return <img src={`${API}/batches/${batch.id}/file`} alt="doc" style={{ width: '100%' }} />;
    return <pre style={{ whiteSpace: 'pre-wrap', padding: 12, margin: 0, fontSize: 12 }}>{batch.rawText || ''}</pre>;
  }

  return (
    <div className="card" data-testid="step-review">
      <h1>Extraction review</h1>
      <p className="sub">Left: original document. Right: extracted data — edit anything before continuing.</p>
      <div className="review">
        <div>
          <div className="tabs">
            {['preview', 'text', 'json'].map(t => <button key={t} className={`tab ${reviewTab === t ? 'on' : ''}`} onClick={() => onTabChange(t)}>{t === 'preview' ? 'Original' : t === 'text' ? 'OCR text' : 'AI JSON'}</button>)}
          </div>
          <div className="preview">{preview()}</div>
        </div>
        <div>
          <h2>Header <button className="btn sm ghost" onClick={() => onAllHeader(!allHeader)}>{allHeader ? 'Show filled only' : `Show all ${hf.length} fields`}</button></h2>
          <div className="grid g3">
            {visibleHf.map(f => (
              <div key={f.key} className="field">
                <label>{f.label}{f.required ? ' *' : ''}</label>
                <input data-testid={`header-${f.key}`} type={f.type === 'date' ? 'date' : 'text'} defaultValue={batch.header[f.key] ?? ''} onChange={e => onEditHeader(f.key, e.target.value, f)} inputMode={isNum(f) ? 'decimal' : undefined} />
              </div>
            ))}
          </div>
          {iss.length > 0 && (
            <details style={{ marginTop: 10 }} open={iss.some(i => i.level === 'error')}>
              <summary><b>{iss.length} item(s) to fix before posting</b></summary>
              {iss.slice(0, 40).map((i, j) => <div key={j} className="issue" style={{ padding: '4px 8px', margin: '4px 0' }}><span className={`badge ${lv[i.level]}`}>{i.level}</span><div>{i.line ? `Line ${i.line} · ` : ''}<b>{i.field || i.scope}</b> — {i.message}</div></div>)}
            </details>
          )}
          <h2 style={{ marginTop: 14 }}>Line items <span className="badge b-muted">{batch.lines.length}</span> <button className="btn sm" onClick={onAddLine}>+ Add line</button></h2>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>#</th>{lf.map(f => <th key={f.key} className={isNum(f) ? 'num' : ''}>{f.label}</th>)}<th /></tr></thead>
              <tbody>
                {batch.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {lf.map(f => (
                      <td key={f.key} className={isNum(f) ? 'num' : ''}>
                        <input type={f.type === 'date' ? 'date' : 'text'} defaultValue={l[f.key] ?? ''} onChange={e => onEditLine(i, f.key, e.target.value, f)} style={iss.some(x => x.line === i + 1 && x.field === f.key) ? { borderColor: 'var(--err)', background: '#fdecec' } : {}} />
                      </td>
                    ))}
                    <td><button className="btn sm ghost" onClick={() => onDelLine(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th colSpan={lf.length - 1} className="num">Σ Lines</th><th className="num">{money(sumLines(batch.lines, 'amount'))}</th><th /></tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
      <div className="footer">
        <span className="help">{batch.corrections?.length || 0} correction(s) recorded</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onBack}>← Back</button>
          <button className="btn" onClick={onErp} data-testid="btn-erp-preview">→ RetailCLIQ screen payload</button>
          <button className="btn primary" onClick={onSave} data-testid="btn-save-review">Save &amp; map masters →</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ MAP */
function MapView({ batch, types, onMapSel, onMapAct, onMapSearch, onApply, onBack }) {
  if (!batch) return null;
  const items = batch.mapItems || [];
  const grp = {};
  items.forEach(it => { grp[it.master] = grp[it.master] || []; grp[it.master].push(it); });
  const unres = items.filter(i => !i.selected && !['skipped', 'later'].includes(i.status)).length;
  const badgeFor = st => st === 'auto' || st === 'mapped' || st === 'created' ? 'b-ok' : st === 'suggested' ? 'b-warn' : st === 'skipped' || st === 'later' ? 'b-muted' : 'b-new';
  return (
    <div className="card" data-testid="step-map">
      <h1>Master identification &amp; mapping</h1>
      <p className="sub">Every supplier, item, UOM, tax, warehouse and account in the document must resolve to a RetailCLIQ master.</p>
      <div className="stat">
        <div className="s"><b>{items.length}</b>references</div>
        <div className="s"><b style={{ color: 'var(--ok)' }}>{items.filter(i => ['auto', 'mapped', 'created'].includes(i.status)).length}</b>resolved</div>
        <div className="s"><b style={{ color: 'var(--new)' }}>{unres}</b>unresolved</div>
      </div>
      {Object.entries(grp).map(([m, arr]) => (
        <div key={m}>
          <h2 style={{ textTransform: 'capitalize' }}>{m} <span className="badge b-muted">{arr.length}</span></h2>
          <div className="tbl-wrap" style={{ marginBottom: 14 }}>
            <table>
              <thead><tr><th>Where</th><th>Document value</th><th>RetailCLIQ master</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {arr.map(it => (
                  <tr key={it.id} className="map-row" data-testid={`map-row-${it.id}`}>
                    <td className="help">{it.scope === 'header' ? 'Header' : `Line ${it.line}`}</td>
                    <td><b>{it.value}</b></td>
                    <td>
                      <select value={it.selected || ''} onChange={e => onMapSel(it.id, e.target.value)} style={{ maxWidth: 280 }}>
                        <option value="">— choose —</option>
                        {(it.candidates || []).map(c => <option key={c.code} value={c.code}>{c.name} ({c.code}) · {Math.round(c.score * 100)}%</option>)}
                      </select> <button className="btn sm" onClick={() => onMapSearch(it.id, it.master)}>🔍</button>
                    </td>
                    <td><span className={`badge ${badgeFor(it.status)}`}>{it.status}</span></td>
                    <td className="actions">
                      {[['map', 'Map'], ['create', 'Create new'], ['skip', 'Skip'], ['later', 'Later']].map(([a, l]) => (
                        <button key={a} className={`btn sm ${it.action === a ? 'on' : ''}`} onClick={() => onMapAct(it.id, a)}>{l}</button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="footer">
        <span className="help">Actions: Map existing · Create new · Skip · Review later</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onBack}>← Back</button>
          <button className="btn primary" onClick={onApply} data-testid="btn-apply-map">Apply &amp; validate →</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ VALIDATE */
function ValidateView({ batch, onRevalidate, onContinue, onBack, onFixMap }) {
  const v = batch?.validation;
  if (!v) return <div className="card"><p>No validation data yet.</p></div>;
  const lv = { error: 'b-err', warning: 'b-warn', 'new-master': 'b-new', info: 'b-info' };
  return (
    <div className="card" data-testid="step-validate">
      <h1>Field &amp; row-wise validation</h1>
      <p className="sub">Valid → continue · Warning → continue after review · Error → correction required · New Master → mapping needed.</p>
      <div className="stat">
        <div className="s"><b style={{ color: 'var(--err)' }}>{v.summary.errors}</b>Errors</div>
        <div className="s"><b style={{ color: 'var(--warn)' }}>{v.summary.warnings}</b>Warnings</div>
        <div className="s"><b style={{ color: 'var(--new)' }}>{v.summary.newMasters}</b>New masters</div>
        <div className="s"><b style={{ color: 'var(--ok)' }}>{(batch.lines?.length || 0) - new Set((v.issues || []).filter(i => i.level === 'error' && i.line).map(i => i.line)).size}</b>Valid lines</div>
      </div>
      {v.issues?.length ? v.issues.map((i, j) => <div key={j} className="issue"><span className={`badge ${lv[i.level]}`}>{i.level}</span><div><b>{i.line ? `Line ${i.line} · ` : ''}{i.field || i.scope}</b> — {i.message}</div></div>) : <div className="issue"><span className="badge b-ok">valid</span><div>All checks passed.</div></div>}
      <div className="footer">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onBack}>Fix in review</button>
          <button className="btn" onClick={onFixMap}>Fix mappings</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onRevalidate}>Re-validate</button>
          <button className="btn primary" onClick={onContinue} disabled={!v.canContinue} data-testid="btn-continue-validate">Continue →</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ CONVERT */
function ConvertView({ batch, types, type, onSetRel, onReconcile, onBack }) {
  const opts = batch?.relationshipOptions || [];
  const r = batch?.relationship || {};
  return (
    <div className="card" data-testid="step-convert">
      <h1>Document relationship &amp; conversion</h1>
      <p className="sub">Decide whether this document stands alone, links against an existing RetailCLIQ document, or should also create follow-on documents.</p>
      <div className="rel">
        {opts.map((op, i) => (
          <label key={i} className={r.mode === op.mode && r.target === op.target ? 'on' : ''}>
            <input type="radio" name="rel" checked={r.mode === op.mode && r.target === op.target} onChange={() => onSetRel(op.mode, op.target)} />
            <div>
              <b>{op.label}</b>
              {op.mode === 'against' && <div className="help">{op.candidates?.length ? 'Candidates: ' + op.candidates.slice(0, 5).map(c => c.docNo).join(', ') : `No posted ${op.target} found for this party — you can still post standalone.`}</div>}
              {op.mode === 'creates' && <div className="help">Chain: {type?.name} → {types.find(t => t.code === op.target)?.name}</div>}
            </div>
          </label>
        ))}
      </div>
      {r.mode === 'against' && <p className="help" style={{ marginTop: 8 }}>Linked document: <b>{r.linkedDocNo || 'none selected'}</b></p>}
      <div className="footer">
        <button className="btn" onClick={onBack}>← Back</button>
        <button className="btn primary" onClick={onReconcile} data-testid="btn-reconcile">Reconcile →</button>
      </div>
    </div>
  );
}

/* ============================================================ RECONCILE */
function ReconcileView({ batch, onOverride, onRerun, onPlan, onBack }) {
  const r = batch?.reconciliation;
  if (!r) return <div className="card"><p>No reconciliation data yet.</p></div>;
  return (
    <div className="card" data-testid="step-reconcile">
      <h1>Reconciliation</h1>
      <p className="sub">Totals and related documents are reconciled before posting. Critical mismatches block posting until resolved or explicitly overridden.</p>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Check</th><th className="num">Expected</th><th className="num">Actual</th><th className="num">Diff</th><th>Status</th><th /></tr></thead>
          <tbody>
            {r.checks.map((c, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'normal' }}>{c.label}{c.info && <div className="help">{c.info}</div>}{c.overridden && <div className="help">Overridden: {c.reason}</div>}</td>
                <td className="num">{money(c.expected)}</td><td className="num">{money(c.actual)}</td>
                <td className="num" style={{ color: Math.abs(c.diff) > 0 ? 'var(--err)' : 'inherit' }}>{money(c.diff)}</td>
                <td><span className={`badge ${c.ok ? (c.overridden ? 'b-warn' : 'b-ok') : c.critical ? 'b-err' : 'b-warn'}`}>{c.ok ? (c.overridden ? 'overridden' : 'ok') : c.critical ? 'mismatch' : 'warning'}</span></td>
                <td>{!c.ok && c.critical && <button className="btn sm" onClick={() => onOverride(c.key)}>Override</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="footer">
        <button className="btn" onClick={onBack}>Fix values</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onRerun}>Re-run</button>
          <button className="btn primary" onClick={onPlan} disabled={!r.canPost} data-testid="btn-review-posting">Review posting →</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ POST */
function PostView({ batch, type, onPost, onBack }) {
  const p = batch?.plan;
  if (!p) return <div className="card"><p>Loading plan…</p></div>;
  const h = batch.header;
  return (
    <div className="card" data-testid="step-post">
      <h1>Confirm &amp; post</h1>
      <p className="sub">These are the exact RetailCLIQ transactions that will be created.</p>
      <div className="grid g2">
        <div>
          <h2>Document</h2>
          <div className="kv">
            <b>Type</b><span>{p.documentType}</span>
            <b>Party</b><span>{p.summary.party || '—'}</span>
            <b>Doc No / Date</b><span>{p.summary.docNo} · {p.summary.docDate || ''}</span>
            <b>Lines</b><span>{p.summary.lines}</span>
            <b>Grand total</b><span>₹{money(p.summary.grandTotal)}</span>
            <b>Relationship</b><span>{p.linked?.mode}{p.linked?.linkedDocNo ? ' → ' + p.linked.linkedDocNo : ''}</span>
            <b>Impact</b><span>Inventory: {p.inventoryImpact} · Accounting: {p.accountingImpact} · Tax: {p.taxImpact}</span>
          </div>
        </div>
        <div>
          <h2>Transactions to be created</h2>
          <div className="plan">{p.transactions.map((t, i) => <div key={i} className="tx"><span className="badge b-info">{i + 1}</span>{t.name}</div>)}</div>
          {p.approvalRequired && <div className="issue" style={{ marginTop: 10 }}><span className="badge b-warn">approval</span><div>Approval workflow applies — the document will be submitted for approval instead of posting directly.</div></div>}
        </div>
      </div>
      <div className="footer">
        <button className="btn" onClick={onBack}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {p.approvalRequired ? <>
            <button className="btn primary" onClick={() => onPost(false)} data-testid="btn-submit-approval">Submit for approval</button>
            <button className="btn ok" onClick={() => onPost(true)} data-testid="btn-approve-post">Approve &amp; post (manager)</button>
          </> : <button className="btn ok" onClick={() => onPost(false)} data-testid="btn-confirm-post">CONFIRM &amp; POST</button>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ RESULT */
function ResultView({ batch, onReset, onHistory, onDownload }) {
  const r = batch?.result;
  if (!r) return null;
  const ok = r.status === 'posted';
  return (
    <div className="card" data-testid="step-result">
      <div className="result-hero">
        <div className="big">{ok ? '✅' : '🕒'}</div>
        <h1>{ok ? 'Posted successfully' : 'Submitted for approval'}</h1>
        <p className="sub">{ok ? <>Created <b>{r.createdDocNo}</b></> : r.message}</p>
      </div>
      <div className="grid g2">
        <div>
          <h2>Result</h2>
          <div className="kv">
            <b>Batch ID</b><span>{batch.id}</span>
            <b>Document</b><span>{r.createdDocNo || '—'}</span>
            <b>Posting</b><span>{r.postingStatus || r.status}</span>
            <b>Stock</b><span>{r.stockUpdated ? 'Updated' : 'No impact'}</span>
            <b>Accounting</b><span>{r.accountingPosted ? 'Posted' : 'No impact'}</span>
            <b>Tax</b><span>{r.taxPosted ? 'Posted' : 'No impact'}</span>
            <b>Related</b><span>{(r.related || []).join(', ') || '—'}</span>
            <b>Source</b><span>{batch.source?.fileName || batch.source?.kind}</span>
            <b>Corrections</b><span>{batch.corrections?.length || 0}</span>
            <b>Validation</b><span>{batch.validation ? `${batch.validation.summary.errors} err · ${batch.validation.summary.warnings} warn` : '—'}</span>
            <b>User / time</b><span>{batch.user} · {fmtIST(r.postedAt || Date.now())}</span>
          </div>
        </div>
        <div>
          <h2>Audit trail</h2>
          <div className="audit">
            {(batch.audit || []).map((a, i) => <div key={i}><code>{fmtTimeIST(a.at)}</code> <b>{a.event}</b> <span className="help">{JSON.stringify(a.detail)}</span></div>)}
          </div>
        </div>
      </div>
      <div className="footer">
        <button className="btn" onClick={onDownload}>Download audit JSON</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onHistory}>All batches</button>
          <button className="btn primary" onClick={onReset} data-testid="btn-process-another">Process another document</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ INBOX */
function InboxView({ inbox, types, onStart, onFiles, onBack, onErp, onPostClean, onOpenJob, onToast, engine }) {
  const j = inbox.job;
  const docs = j ? j.units.flatMap(u => (u.docs || []).map(d => ({ ...d, file: u.fileName }))) : [];
  const done = j ? j.units.filter(u => ['done', 'failed', 'skipped'].includes(u.status)).length : 0;

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }} data-testid="inbox-view">
      <div className="card">
        {/* Header with Back to Home */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={onBack} data-testid="btn-inbox-back" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            ← Back to Home
          </button>
          <h1 style={{ margin: 0, flex: 1 }}>📥 Inbox · bulk document intake</h1>
        </div>
        <p className="sub">Drop supplier invoices in any form — PDFs, scans, photos, ZIP/RAR, multi-invoice PDFs. Pages are split into documents, read by {engine ? (engine.ocr === 'sarvam' ? 'Sarvam Document Intelligence' : engine.ocr + ' OCR') : '…'}, mapped to RetailCLIQ masters and validated; each document then waits here for review or posting.</p>
        <div className="inbox-top">
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Files</label>
            <div className="drop" style={{ padding: 16 }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
              onDragLeave={e => e.currentTarget.classList.remove('over')}
              onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); onFiles(e.dataTransfer.files); }}
              onClick={() => document.getElementById('ibFilesInput').click()}
              data-testid="inbox-drop">
              <b>{inbox.files.length ? `${inbox.files.length} file(s) selected` : 'Drop files / ZIP / RAR here or click'}</b>
              <div className="help">{inbox.files.slice(0, 6).map(f => f.name).join(', ')}{inbox.files.length > 6 ? ' …' : ''}</div>
            </div>
            <input id="ibFilesInput" type="file" multiple style={{ display: 'none' }} accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,.rar,.xlsx,.csv" onChange={e => onFiles(e.target.files)} />
          </div>
          <div className="field"><label>Page grouping</label><select id="ibSplit"><option value="auto">Auto</option><option value="page">One per page</option><option value="file">One per file</option></select></div>
          <div className="field"><label>Content</label><select id="ibContent"><option value="mixed">Mixed</option><option value="printed">Printed</option><option value="handwritten">Handwritten</option></select></div>
          <div className="field"><label>Rotate photos</label><select id="ibRotate"><option value="0">Auto (EXIF)</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></div>
          <div className="field"><label>Target screen</label><select id="ibScreen"><option value="PI">Purchase Invoice</option><option value="GRN_PO">GRN Against PO</option><option value="GRN_PI">GRN Against PI</option><option value="PIR">Purchase Invoice Return</option></select></div>
          <button className="btn primary" onClick={onStart} disabled={!inbox.files.length} data-testid="btn-intake-start">Start intake →</button>
        </div>

        {j && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <b>Job {j.id.slice(0, 8)} · {j.status}</b>
              <span className="help">{done}/{j.units.length} files · {docs.length} documents · {j.summary?.clean || 0} clean · {j.summary?.needsReview || 0} need review · {j.summary?.posted || 0} posted</span>
            </div>
            <div className="prog"><i style={{ width: j.units.length ? `${Math.round(done / j.units.length * 100)}%` : '0%' }} /></div>
            <div className="stat">
              <div className="s"><b>{j.units.length}</b>files</div>
              <div className="s"><b>{docs.length}</b>documents</div>
              <div className="s"><b style={{ color: 'var(--ok)' }}>{docs.filter(d => d.status === 'ready').length}</b>ready to post</div>
              <div className="s"><b style={{ color: 'var(--warn)' }}>{docs.filter(d => d.status === 'needs-review').length}</b>need review</div>
              <div className="s"><b style={{ color: 'var(--err)' }}>{docs.filter(d => d.status === 'failed').length + j.units.filter(u => u.status === 'failed').length}</b>failed</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <a className="btn sm" href={`${API}/intake/${j.id}/export.xlsx`}>⬇ Excel</a>
              <a className="btn sm" href={`${API}/intake/${j.id}/export.json`}>⬇ JSON</a>
              <button className="btn sm ok" onClick={onPostClean} disabled={j.status !== 'done'} data-testid="btn-post-clean">Post all clean documents</button>
            </div>
            <div className="doc-grid">
              {docs.map(d => (
                <div key={d.id} className={`doc ${d.status}`}>
                  <div className="th" style={{ backgroundImage: d.thumb ? `url('${d.thumb}')` : undefined }}>{!d.thumb && '📄'}</div>
                  <div className="body">
                    <div className="fn">{d.file} · p{d.pages?.join(',')}</div>
                    <div className="party">{d.party || '(supplier not read)'}</div>
                    <div className="meta">{types.find(t => t.code === d.docType)?.name || d.docType || ''} {d.confidence != null ? `${Math.round(d.confidence * 100)}%` : ''} · {d.docNo || 'no inv no'} · {d.docDate || ''}</div>
                    <div className="meta"><b>₹{money(d.grandTotal)}</b> · {d.lines || 0} lines</div>
                    <div style={{ marginTop: 4 }}>
                      {d.status === 'posted' ? <span className="badge b-ok">posted {d.createdDocNo || ''}</span> : d.status === 'failed' ? <span className="badge b-err">{d.error || 'failed'}</span> : d.validation ? <><span className={`badge ${d.validation.errors ? 'b-err' : 'b-ok'}`}>{d.validation.errors} err</span> <span className="badge b-warn">{d.validation.warnings} warn</span> <span className="badge b-new">{d.validation.newMasters} new</span></> : <span className="badge b-info">{d.status}</span>}
                    </div>
                    <div className="acts">
                      {d.batchId && <><button className="btn sm primary" onClick={() => onOpenJob && onErp(d.batchId)}>Open in wizard</button><button className="btn sm" onClick={() => onErp(d.batchId)}>→ ERP screen</button></>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!j && inbox.jobs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h2>Previous intake jobs</h2>
            {inbox.jobs.map(x => (
              <div key={x.id} className="unit-row">
                <span className={`badge ${x.status === 'done' ? 'b-ok' : 'b-info'}`}>{x.status}</span>
                <b>{x.id.slice(0, 8)}</b>
                <span className="help">{fmtIST(x.createdAt)} · {x.units?.length || 0} files · {x.summary?.docs || '-'} docs</span>
                <button className="btn sm" onClick={() => onOpenJob(x.id)}>Open</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================ ERP VIEW */
function ErpView({ erp, batchId, types, onBack, onOpen, onToast }) {
  if (!erp) return null;
  const cols = ['oemCode', 'itemName', 'hsn', 'qty', 'uom', 'rate', 'mrp', 'disc', 'inTax', 'cgst', 'sgst', 'igst', 'amount', 'division', 'dept', 'category', 'subcatg', 'brand', 'style', 'size', 'color'];
  const copyJson = () => { navigator.clipboard.writeText(JSON.stringify(erp, null, 2)).then(() => onToast('Copied')); };
  const downloadJson = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(erp, null, 2)], { type: 'application/json' })); a.download = `retailcliq-${erp.header.screen}-${(erp.header.invoiceNo || batchId?.slice(0, 8) || 'doc').replace(/[^\w-]+/g, '_')}.json`; a.click(); };
  const sendMsg = () => { const msg = { type: 'RETAILCLIQ_DOCAI_IMPORT', payload: erp }; if (window.opener) window.opener.postMessage(msg, '*'); localStorage.setItem('retailcliq.docai.pending', JSON.stringify(msg)); onToast('Payload handed to RetailCLIQ screen'); };
  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }} data-testid="erp-view">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button className="btn sm" onClick={onBack} data-testid="btn-erp-back">← Back to Inbox</button>
          <h1 style={{ margin: 0, flex: 1 }}>RetailCLIQ {erp.header.screen} payload</h1>
        </div>
        <p className="sub">Exactly what the Purchase Invoice / GRN screen receives.</p>
        {erp.warnings?.length > 0 && <div className="issue"><span className="badge b-warn">{erp.warnings.length} warnings</span><div>{erp.warnings.slice(0, 8).join('; ')}</div></div>}
        <div className="grid g2">
          <div>
            <h2>Document information</h2>
            <div className="kv">
              <b>Supplier</b><span>{erp.header.supplier} {erp.header.supplierCode ? `(${erp.header.supplierCode})` : <span className="badge b-new">new supplier</span>}</span>
              <b>GSTIN / St Code</b><span>{erp.header.gstin} · {erp.header.stCode}</span>
              <b>Invoice No / Date</b><span>{erp.header.invoiceNo} · {erp.header.invoiceDate} (HBS {erp.header.invoiceDateHBS ?? '-'})</span>
              <b>Invoice Ref / LR</b><span>{erp.header.invoiceRef} · {erp.header.lrRef}</span>
              <b>Pay mode / A/c</b><span>{erp.header.payMode} · {erp.header.purchaseAc}</span>
              <b>Transport / E-way</b><span>{erp.header.transporter} · {erp.header.ewayBillNo}</span>
            </div>
          </div>
          <div>
            <h2>Bill · tax · amounts</h2>
            <div className="kv">
              <b>Gross</b><span>₹{money(erp.header.grossAmount)}</span>
              <b>Discount</b><span>₹{money(erp.header.discount)} ({erp.header.discPct}%)</span>
              <b>CGST / SGST / IGST</b><span>₹{money(erp.header.cgstAmt)} / ₹{money(erp.header.sgstAmt)} / ₹{money(erp.header.igstAmt)} {erp.header.interState ? <span className="badge b-info">inter-state</span> : ''}</span>
              <b>Freight / TCS / Round</b><span>₹{money(erp.header.freight)} / ₹{money(erp.header.tcs)} / ₹{money(erp.header.roundOff)}</span>
              <b>Net amount</b><span><b>₹{money(erp.header.netAmount)}</b></span>
              <b>Lines / Qty</b><span>{erp.header.lineCount} / {erp.header.totalQty}</span>
            </div>
          </div>
        </div>
        <h2 style={{ marginTop: 12 }}>Item grid ({erp.rows?.length || 0})</h2>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>#</th>{cols.map(c => <th key={c}>{c}</th>)}<th>matched</th></tr></thead>
            <tbody>
              {(erp.rows || []).map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {cols.map(c => <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>{typeof r[c] === 'number' ? money(r[c]) : String(r[c] ?? '')}{c === 'oemCode' && r.oemCodeSynthesized ? <span className="badge b-warn" style={{ marginLeft: 4 }}>auto</span> : null}</td>)}
                  <td>{r.matched ? <span className="badge b-ok">master</span> : <span className="badge b-new">new item</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="footer">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" onClick={downloadJson}>⬇ Download JSON</button>
            <button className="btn" onClick={copyJson}>Copy JSON</button>
            <button className="btn" onClick={sendMsg}>Send to open RetailCLIQ screen</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onBack}>← Inbox</button>
            {batchId && <button className="btn primary" onClick={() => onOpen(batchId)}>Review in wizard</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ BST GL MAP */
function BstGlMapView({ batch, onApply, onBack, onToast }) {
  const [lines, setLines] = React.useState([]);
  const [accounts, setAccounts] = React.useState([]);
  const [glMap, setGlMap] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const BACKEND = process.env.REACT_APP_BACKEND_URL;

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${BACKEND}/api/docai/batches/${batch.id}/bst-gl-mapping`);
        const d = await r.json();
        setLines(d.lines || []);
        setAccounts(d.accounts || []);
        const initMap = {};
        (d.lines || []).forEach(l => { if (l.glAccount) initMap[l.lineNo] = l.glAccount; });
        setGlMap(initMap);
      } catch (e) { onToast('Failed to load GL mapping: ' + e.message, true); }
      setLoading(false);
    })();
  }, [batch.id]);

  const totalDr = lines.filter(l => l.debit).reduce((s, l) => s + (l.debit || 0), 0);
  const totalCr = lines.filter(l => l.credit).reduce((s, l) => s + (l.credit || 0), 0);
  const mapped = Object.keys(glMap).length;

  const applyAll = async () => {
    setSaving(true);
    const decisions = Object.entries(glMap).map(([lineNo, glAccount]) => ({ lineNo: Number(lineNo), glAccount }));
    await onApply(decisions);
    setSaving(false);
  };

  const autoMap = () => {
    const newMap = { ...glMap };
    lines.forEach(l => { if (!newMap[l.lineNo] && l.suggestedGl) newMap[l.lineNo] = l.suggestedGl; });
    setGlMap(newMap);
    onToast(`Auto-mapped ${lines.filter(l => l.suggestedGl && !glMap[l.lineNo]).length} transactions`);
  };

  if (loading) return <div className="card"><div className="busy"><div className="spin" /><div>Loading GL mapping suggestions…</div></div></div>;

  return (
    <div className="card" data-testid="step-bst-gl-map">
      <h1>🏦 Bank Statement · GL Account Mapping</h1>
      <p className="sub">Map each bank transaction to a GL account for automatic reconciliation posting.</p>

      <div className="stat">
        <div className="s"><b>{lines.length}</b>Transactions</div>
        <div className="s"><b style={{ color: 'var(--ok)' }}>{mapped}</b>GL mapped</div>
        <div className="s"><b style={{ color: 'var(--warn)' }}>{lines.length - mapped}</b>Unmapped</div>
        <div className="s"><b>₹{(totalDr || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</b>Total Debits</div>
        <div className="s"><b>₹{(totalCr || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</b>Total Credits</div>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Ref/Chq</th>
              <th>Type</th>
              <th className="num">Debit (Dr)</th>
              <th className="num">Credit (Cr)</th>
              <th className="num">Balance</th>
              <th style={{ minWidth: 220 }}>GL Account</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.lineNo} style={{ background: glMap[l.lineNo] ? '' : (l.debit || l.credit ? '#fff9ec' : '') }}>
                <td style={{ whiteSpace: 'nowrap' }}>{l.txDate || ''}</td>
                <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description}>{l.description}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{l.refNo || ''}</td>
                <td><span className={`badge ${l.txType === 'CR' || l.credit ? 'b-ok' : l.txType === 'DR' || l.debit ? 'b-err' : 'b-muted'}`}>{l.txType || '—'}</span></td>
                <td className="num" style={{ color: 'var(--err)' }}>{l.debit ? l.debit.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''}</td>
                <td className="num" style={{ color: 'var(--ok)' }}>{l.credit ? l.credit.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''}</td>
                <td className="num">{l.balance != null ? l.balance.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''}</td>
                <td>
                  <select
                    value={glMap[l.lineNo] || ''}
                    onChange={e => setGlMap(g => ({ ...g, [l.lineNo]: e.target.value || undefined }))}
                    style={{ width: '100%', fontSize: 12, border: glMap[l.lineNo] ? '1px solid var(--ok)' : '1px solid var(--line)', borderRadius: 6, padding: '4px 6px' }}
                  >
                    <option value="">— select GL —</option>
                    {l.suggestedGl && <option value={l.suggestedGl} style={{ color: 'var(--ok)' }}>⭐ {accounts.find(a => a.code === l.suggestedGl)?.name || l.suggestedGl}</option>}
                    {accounts.filter(a => a.code !== l.suggestedGl).map(a => (
                      <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="footer">
        <button className="btn" onClick={onBack}>← Back to Review</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={autoMap}>⚡ Auto-map suggestions</button>
          <button className="btn primary" onClick={applyAll} disabled={saving} data-testid="btn-apply-gl-map">
            {saving ? 'Saving…' : `Save GL Map & Validate →`}
          </button>
        </div>
      </div>
    </div>
  );
}
