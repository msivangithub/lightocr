/**
 * tallyParser.js — Parse Tally XML exports (purchase/sales vouchers) into DocAI batch format.
 *
 * Supports:
 *  - Tally Prime / ERP 9 XML export (TALLYMESSAGE format)
 *  - Tally ASCII / CSV exports
 *  - Auto-detects PT_PUR vs PT_SAL based on voucher type
 *
 * Tally XML structure:
 * <TALLYMESSAGE>
 *   <VOUCHER VCHTYPE="Purchase" REMOTEID="..." ACTION="Create">
 *     <DATE>20260901</DATE>               (YYYYMMDD)
 *     <VOUCHERNUMBER>PI-001</VOUCHERNUMBER>
 *     <PARTYLEDGERNAME>SriLakshmi</PARTYLEDGERNAME>
 *     <NARRATION>Purchase of goods</NARRATION>
 *     <ALLINVENTORYENTRIES.LIST>
 *       <STOCKITEMNAME>Basmati Rice 5kg</STOCKITEMNAME>
 *       <ACTUALQTY> 40 Nos</ACTUALQTY>
 *       <RATE>410/Nos</RATE>
 *       <AMOUNT>-16400</AMOUNT>
 *       <BILLEDQTY> 40 Nos</BILLEDQTY>
 *     </ALLINVENTORYENTRIES.LIST>
 *     <LEDGERENTRIES.LIST>
 *       <LEDGERNAME>CGST</LEDGERNAME>
 *       <AMOUNT>-820</AMOUNT>
 *     </LEDGERENTRIES.LIST>
 *   </VOUCHER>
 * </TALLYMESSAGE>
 */

// ── XML helpers (no external parser needed for basic Tally XML) ───────────────
function getTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m  = re.exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}
function getAllTags(xml, tag) {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
  return (xml.match(re) || []);
}

// ── Tally date YYYYMMDD → ISO YYYY-MM-DD ─────────────────────────────────────
function tallyDate(s) {
  if (!s) return null;
  s = s.trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  // Try standard date parse as fallback
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return null;
}

// ── Amount (Tally stores as negative for purchases in some configs) ───────────
function tallyAmt(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.abs(n) : null;
}

// ── Qty: " 40 Nos" → { qty: 40, uom: 'Nos' } ────────────────────────────────
function tallyQty(s) {
  if (!s) return { qty: null, uom: null };
  const m = String(s).trim().match(/([\d.]+)\s*([A-Za-z]+)?/);
  return m ? { qty: Number(m[1]), uom: m[2] || 'PCS' } : { qty: null, uom: null };
}

// ── Rate: "410/Nos" → 410 ────────────────────────────────────────────────────
function tallyRate(s) {
  if (!s) return null;
  const n = Number(String(s).split('/')[0].trim().replace(/[^0-9.]/g,''));
  return Number.isFinite(n) ? n : null;
}

// ── Parse one VOUCHER element ─────────────────────────────────────────────────
function parseVoucher(voucherXml) {
  const vchType = (voucherXml.match(/VCHTYPE="([^"]+)"/i)?.[1] || '').trim();
  const docType = /purchase|pi\b/i.test(vchType) ? 'PT_PUR' :
                  /sales|si\b/i.test(vchType) ? 'PT_SAL' :
                  /journal|jv\b/i.test(vchType) ? 'JV' :
                  /payment|pv\b/i.test(vchType) ? 'PV' :
                  /receipt|rv\b/i.test(vchType) ? 'RV' :
                  /contra|ctv\b/i.test(vchType) ? 'CTV' :
                  null; // will be OTHER

  const date   = tallyDate(getTag(voucherXml, 'DATE'));
  const docNo  = getTag(voucherXml, 'VOUCHERNUMBER');
  const party  = getTag(voucherXml, 'PARTYLEDGERNAME') || getTag(voucherXml, 'PARTYNAME');
  const narr   = getTag(voucherXml, 'NARRATION');
  const refNo  = getTag(voucherXml, 'REFERENCE') || getTag(voucherXml, 'REFERENCENUMBER');

  // Line items from ALLINVENTORYENTRIES.LIST
  const invEntries = getAllTags(voucherXml, 'ALLINVENTORYENTRIES.LIST');
  const lines = invEntries.map((e, i) => {
    const desc = getTag(e, 'STOCKITEMNAME') || '';
    const { qty, uom } = tallyQty(getTag(e, 'ACTUALQTY') || getTag(e, 'BILLEDQTY'));
    const rate   = tallyRate(getTag(e, 'RATE'));
    const amount = tallyAmt(getTag(e, 'AMOUNT'));
    const hsn    = getTag(e, 'HSNCODE') || getTag(e, 'HSNSACCODE');
    const batch  = getTag(e, 'BATCHNAME');
    return { lineNo: i+1, description: desc, qty, uom, rate, amount, hsn, batch,
             erpCode: null, partnerSKU: null, eanCode: null };
  });

  // Tax ledger entries for totals
  const ledgers = getAllTags(voucherXml, 'LEDGERENTRIES.LIST');
  let cgst=0, sgst=0, igst=0, subTotal=0;
  for (const l of ledgers) {
    const name = (getTag(l,'LEDGERNAME')||'').toUpperCase();
    const amt  = tallyAmt(getTag(l,'AMOUNT')) || 0;
    if (name.includes('CGST')) cgst += amt;
    else if (name.includes('SGST')) sgst += amt;
    else if (name.includes('IGST')) igst += amt;
    else if (!name.includes('GST') && !name.includes('TCS') && !name.includes('TDS')) subTotal += amt;
  }
  const taxTotal  = cgst + sgst + igst;
  const grandTotal = subTotal + taxTotal || lines.reduce((s,l)=>s+(l.amount||0),0);

  // GSTIN extraction from XML attributes or text
  const gstinMatch = voucherXml.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/);
  const partyGstin = gstinMatch ? gstinMatch[0] : null;

  return {
    docType: docType || 'OTHER',
    erpSource: 'tally',
    fileFormat: 'XML',
    header: {
      docNo, docDate: date, party, partyGstin, refNo,
      remarks: narr, subTotal: subTotal || null,
      cgst: cgst || null, sgst: sgst || null, igst: igst || null,
      taxTotal: taxTotal || null, grandTotal: grandTotal || null,
      currency: 'INR',
    },
    lines,
  };
}

// ── Main: parse full Tally XML file (may have multiple vouchers) ──────────────
function parseTallyXml(content) {
  if (typeof content !== 'string') content = content.toString('utf8');

  // Find all VOUCHER elements
  const vouchers = getAllTags(content, 'VOUCHER');
  if (!vouchers.length) {
    // Try single-voucher format without wrapper
    if (/<DATE>/.test(content) && /<VOUCHERNUMBER>/.test(content)) {
      const v = parseVoucher(content);
      return [v];
    }
    return [];
  }
  return vouchers.map(parseVoucher).filter(v => v.lines.length > 0 || v.header.docNo);
}

// ── Tally CSV / plain text export fallback ───────────────────────────────────
function parseTallyCsv(content) {
  const XLSX = require('xlsx');
  const wb   = XLSX.read(content, { type: 'string' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:'' });
  // Generic fallback — return text for AI parsing
  return { text: rows.map(r=>r.join(' | ')).join('\n'), source: 'tally-csv' };
}

module.exports = { parseTallyXml, parseTallyCsv, parseVoucher, tallyDate, tallyAmt };
