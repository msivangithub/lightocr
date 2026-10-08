/**
 * RetailCLIQ DocAI bridge for the GRC screens (Purchase_Invoice.html, GRN_Against_PO.html, GRN_Against_PI.html,
 * Purchase_Invoice_Return.html, GRN_Return.html).
 *
 *   <script src="http://localhost:4010/docai-bridge.js" data-docai="http://localhost:4010"></script>
 *
 * What it does:
 *  1. Pre-fills the "Backend URL" of the 📕 PDF / 🖨 Scan import with <docai>/api/docai/grc/extract
 *     (the screen's own tryRealScanExtraction() then does the rest – rows land in the grid via submitImportedItems()).
 *  2. Wraps fetch() for that URL so the `header` block of the response is applied to the screen's
 *     Document / Supplier / Bill / Tax fields (fillHeader below – adjust selectors to your screen).
 *  3. Listens for postMessage { type:'RETAILCLIQ_DOCAI_IMPORT', payload } from the DocAI Inbox
 *     ("Send to open RetailCLIQ screen") and for the localStorage key retailcliq.docai.pending,
 *     and injects rows + header exactly like the import wizard would.
 */
(function () {
  const base = (document.currentScript && document.currentScript.dataset.docai) || location.origin;
  const EXTRACT_URL = base.replace(/\/$/, '') + '/api/docai/grc/extract';

  function setByLabel(label, value) {
    if (value == null || value === '') return;
    const el = [...document.querySelectorAll('label, .lbl, .k, th, td, span, div')].find((e) => e.children.length === 0 && e.textContent.trim().toLowerCase() === label.toLowerCase());
    if (!el) return;
    const row = el.closest('.field, .frow, .brow, .row, tr, div');
    const inp = row && row.querySelector('input, select, textarea');
    if (inp) { inp.value = value; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
    else { const v = row && row.querySelector('.v, .val, b'); if (v) v.textContent = value; }
  }
  function fillHeader(h) {
    if (!h) return;
    const d = (iso) => iso ? iso.split('-').reverse().join('-') : ''; // YYYY-MM-DD → DD-MM-YYYY for the screens
    setByLabel('Invoice Date', d(h.invoiceDate)); setByLabel('Invoice Ref', h.invoiceNo); setByLabel('Supplier', h.supplier);
    setByLabel('Remarks', h.remarks); setByLabel('GSTIN', h.gstin); setByLabel('St Code', h.stCode); setByLabel('L.R Ref', h.lrRef);
    setByLabel('Disc Perc%', h.discPct); setByLabel('Freight', h.freight); setByLabel('Round Off', h.roundOff);
    setByLabel('CGST Amt', h.cgstAmt); setByLabel('SGST Amt', h.sgstAmt); setByLabel('IGST Amt', h.igstAmt);
    setByLabel('Gross Amount', h.grossAmount); setByLabel('Discount', h.discount); setByLabel('GST Amount', h.gstAmount); setByLabel('Net Amount', h.netAmount);
    if (h.payMode) { const r = [...document.querySelectorAll('input[type=radio]')].find((x) => (x.value || x.nextSibling?.textContent || '').trim().toLowerCase() === h.payMode.toLowerCase()); if (r) r.checked = true; }
    window.__docaiHeader = h;
  }
  function injectRows(rows) {
    if (!Array.isArray(rows) || typeof window.submitImportedItems !== 'function') return false;
    const items = rows.map((r) => Object.assign({}, r, { valid: true, errors: [] }));
    window.__docaiRows = items;
    // importState is a top-level `let` in the screens → only reachable through global-scope (indirect) eval
    (0, eval)('if (typeof importState !== "undefined") { importState.parsedItems = window.__docaiRows; importState.usedRealBackend = true; } else { window.importState = { parsedItems: window.__docaiRows, usedRealBackend: true }; }');
    window.submitImportedItems(); return true;
  }
  // 1. default backend URL
  document.addEventListener('DOMContentLoaded', () => {
    try { if (!localStorage.getItem('scanImportBackendUrl')) localStorage.setItem('scanImportBackendUrl', EXTRACT_URL); } catch {}
    const inp = document.getElementById('importBackendUrl'); if (inp && !inp.value) inp.value = EXTRACT_URL;
    // 3b. pending payload from the Inbox
    try { const p = localStorage.getItem('retailcliq.docai.pending'); if (p) { const m = JSON.parse(p); if (m && m.payload && confirm('Load the document from DocAI Inbox (' + (m.payload.header.supplier || '') + ' / ' + (m.payload.header.invoiceNo || '') + ')?')) { fillHeader(m.payload.header); injectRows(m.payload.rows); } localStorage.removeItem('retailcliq.docai.pending'); } } catch {}
  });
  // 2. apply header when the screen calls the extract backend
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    const res = await origFetch(url, opts);
    try { if (typeof url === 'string' && url.indexOf('/api/docai/grc/extract') >= 0 && res.ok) { const clone = res.clone(); clone.json().then((j) => { if (j && j.ok) { fillHeader(j.header); if (j.warnings && j.warnings.length) console.info('[DocAI] warnings:', j.warnings); } }).catch(() => {}); } } catch {}
    return res;
  };
  // 3a. postMessage from the Inbox
  window.addEventListener('message', (ev) => { const m = ev.data; if (m && m.type === 'RETAILCLIQ_DOCAI_IMPORT' && m.payload) { fillHeader(m.payload.header); injectRows(m.payload.rows); } });
  window.RetailCLIQDocAI = { EXTRACT_URL, fillHeader, injectRows };
})();
