/**
 * bankParser.js — Smart bank statement parser.
 *
 * Strategy (no LLM needed for digital docs):
 *   1. Digital PDF (text layer present)  → pdf-parse text extraction + regex table parser
 *   2. Excel / CSV download from bank portal → xlsx direct parse
 *   3. Scanned PDF / image               → OCR (Sarvam/Gemini) then regex table parser
 *
 * Supports output formats from major Indian banks:
 *   HDFC, ICICI, SBI, Axis, Kotak, PNB, BOB, Union Bank, Canara, IndusInd, Yes Bank, IDFC, Federal, etc.
 */
const path = require('path');
const fs   = require('fs');

// ── Bank name normalisation ───────────────────────────────────────────────────
const BANK_PATTERNS = [
  [/axis\s+bank/i, 'Axis Bank'],
  [/hdfc\s+bank/i, 'HDFC Bank'],
  [/icici\s+bank/i, 'ICICI Bank'],
  [/state\s+bank\s+of\s+india|\bsbi\b/i, 'State Bank of India (SBI)'],
  [/kotak\s+mahindra|kotak\s+bank/i, 'Kotak Mahindra Bank'],
  [/punjab\s+national\s+bank|\bpnb\b/i, 'Punjab National Bank (PNB)'],
  [/bank\s+of\s+baroda|\bbob\b/i, 'Bank of Baroda (BOB)'],
  [/union\s+bank\s+of\s+india|union\s+bank/i, 'Union Bank of India'],
  [/canara\s+bank/i, 'Canara Bank'],
  [/indusind\s+bank/i, 'IndusInd Bank'],
  [/yes\s+bank/i, 'Yes Bank'],
  [/idfc\s+first\s+bank|idfc\s+bank/i, 'IDFC First Bank'],
  [/federal\s+bank/i, 'Federal Bank'],
  [/south\s+indian\s+bank/i, 'South Indian Bank'],
  [/indian\s+overseas\s+bank|\biob\b/i, 'Indian Overseas Bank (IOB)'],
  [/indian\s+bank/i, 'Indian Bank'],
  [/bank\s+of\s+india/i, 'Bank of India'],
  [/central\s+bank/i, 'Central Bank of India'],
  [/city\s+union\s+bank/i, 'City Union Bank'],
  [/karur\s+vysya|\bkvb\b/i, 'Karur Vysya Bank'],
  [/rbl\s+bank/i, 'RBL Bank'],
  [/bandhan\s+bank/i, 'Bandhan Bank'],
];

/**
 * Detect bank name from statement HEADER ONLY (first 400 chars or "Statement of X Account").
 * Does NOT scan transaction descriptions to avoid false matches (e.g., NEFT counterparty bank names).
 */
function normBankName(text) {
  if (!text) return null;
  // Priority 1: "Statement of Axis Bank Account No :" or similar
  const stmtMatch = text.match(/statement\s+of\s+([A-Za-z ]{2,30}?)\s+(?:account|a\/c)/i);
  if (stmtMatch) {
    const seg = stmtMatch[1].trim();
    for (const [re, name] of BANK_PATTERNS) {
      if (re.test(seg)) return name;
    }
  }
  // Priority 2: Look only in first 400 chars (header section — before transactions start)
  const hdr = text.slice(0, 400);
  for (const [re, name] of BANK_PATTERNS) {
    if (re.test(hdr)) return name;
  }
  return null;
}

// ── Date normaliser (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD MMM YYYY) ─────────
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) { const y = m[3].length===2 ? '20'+m[3] : m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  // DD MMM YYYY
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase().slice(0,3)]) {
    const y = m[3].length===2 ? '20'+m[3] : m[3];
    return `${y}-${String(MONTHS[m[2].toLowerCase().slice(0,3)]).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return null;
}

// ── Amount parser ─────────────────────────────────────────────────────────────
function parseAmt(s) {
  if (s == null || s === '' || s === '-' || s === 'nil' || s === '—') return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── Transaction table parser from plain text ──────────────────────────────────
/**
 * Parses bank statement transaction rows from extracted PDF text.
 * Handles multiple bank formats including:
 *  - Axis Bank: "01/09/202601/09/2026\nNEFT/...\n26,763.00CR1,28,846.39"
 *  - HDFC: standard pipe-separated
 *  - Generic: date | description | debit | credit | balance
 */
function parseTransactionText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const txns  = [];

  // ── Axis Bank specific parser ──────────────────────────────────────────────
  // Axis format: each row spreads across ~3 lines:
  //   Line 1: "N<dd/mm/yyyy><dd/mm/yyyy>"  (serial no + txDate + valueDate merged)
  //   Line 2: "NEFT/particulars/..."
  //   Line 3: "amount.00CR/DRbalance.00..."
  const AXIS_ROW_RE = /^(\d{1,3})(\d{2}\/\d{2}\/\d{4})(\d{2}\/\d{2}\/\d{4})\s*$/;
  const AXIS_AMT_RE = /([\d,]+\.\d{2})(CR|DR)([\d,]+\.\d{2})/;

  let i = 0;
  while (i < lines.length) {
    const axisMatch = AXIS_ROW_RE.exec(lines[i]);
    if (axisMatch && i + 1 < lines.length) {
      const txDate   = parseDate(axisMatch[2]);
      const valueDate = parseDate(axisMatch[3]);
      if (txDate) {
        // Collect description lines until we find amount line
        const descLines = [];
        let j = i + 1;
        while (j < lines.length && !AXIS_AMT_RE.test(lines[j])) {
          // Stop if we hit the next row number+date pattern
          if (AXIS_ROW_RE.test(lines[j])) break;
          descLines.push(lines[j].trim());
          j++;
        }
        const desc = descLines.filter(d => d.length > 1 && !/^\d+$/.test(d)).join(' ').trim().slice(0, 200);

        // Parse amount line
        let debit = null, credit = null, balance = null, txType = null;
        if (j < lines.length) {
          const amtLine = lines[j];
          const axisAmt = AXIS_AMT_RE.exec(amtLine);
          if (axisAmt) {
            const amt = parseAmt(axisAmt[1]);
            const drCr = axisAmt[2].toUpperCase();
            balance = parseAmt(axisAmt[3]);
            if (drCr === 'DR') { debit = amt; txType = 'DR'; }
            else               { credit = amt; txType = 'CR'; }
          }
          j++; // skip amount line
        }

        // TX type refinement
        if (/\bNEFT\b/i.test(desc)) txType = txType === 'DR' ? 'NEFT-DR' : 'NEFT';
        else if (/\bRTGS\b/i.test(desc)) txType = txType === 'DR' ? 'RTGS-DR' : 'RTGS';
        else if (/\bIMPS\b/i.test(desc)) txType = txType === 'DR' ? 'IMPS-DR' : 'IMPS';
        else if (/\bUPI\b/i.test(desc)) txType = txType === 'DR' ? 'UPI-DR' : 'UPI';
        else if (/INB\/IFT|INTERNAL\s+TRANSFER/i.test(desc)) txType = 'TRSF';
        else if (/ATM/i.test(desc)) txType = 'ATM';
        else if (/interest/i.test(desc)) txType = 'INT';
        else if (/service\s+charge|monthly\s+charge|maintenance/i.test(desc)) txType = 'CHG';

        const refMatch = desc.match(/\b([A-Z]{3,6}[0-9]{8,20})\b/);
        const refNo = refMatch ? refMatch[1].slice(0, 30) : null;

        if (desc.length > 2) {
          txns.push({ lineNo: txns.length + 1, txDate, valueDate, description: desc, refNo, txType, debit, credit, balance });
        }
        i = j;
        continue;
      }
    }

    // ── Generic parser fallback ─────────────────────────────────────────────
    const DATE_RE = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
    const AMT_RE  = /([\d,]+\.\d{2})/g;

    const dateMatch = DATE_RE.exec(lines[i]);
    if (dateMatch) {
      const txDate = parseDate(dateMatch[1]);
      if (txDate) {
        const amts = [];
        let m;
        AMT_RE.lastIndex = 0;
        while ((m = AMT_RE.exec(lines[i]))) amts.push(parseAmt(m[1]));

        const afterDate = lines[i].slice(dateMatch.index + dateMatch[0].length);
        const firstAmtPos = afterDate.search(/[\d,]+\.\d{2}/);
        const desc = (firstAmtPos > 0 ? afterDate.slice(0, firstAmtPos) : afterDate).replace(/[|\t]+/g, ' ').trim().slice(0, 120);

        let debit = null, credit = null, balance = null;
        const crKW = /\bCR\b|credit|received|refund|salary|interest|cashback/i;
        const drKW = /\bDR\b|debit|neft|rtgs|payment|transfer|emi|charges|fee/i;

        // Check for inline CR/DR marker (e.g., "26763.00CR128846.39")
        const inlineMatch = AXIS_AMT_RE.exec(lines[i]);
        if (inlineMatch) {
          const amt = parseAmt(inlineMatch[1]);
          balance = parseAmt(inlineMatch[3]);
          if (inlineMatch[2] === 'DR') debit = amt; else credit = amt;
        } else if (amts.length >= 3) {
          debit = amts[0]; credit = amts[1]; balance = amts[2];
        } else if (amts.length === 2) {
          if (drKW.test(desc)) { debit = amts[0]; balance = amts[1]; }
          else if (crKW.test(desc)) { credit = amts[0]; balance = amts[1]; }
          else { balance = amts[1]; debit = amts[0]; }
        } else if (amts.length === 1) { balance = amts[0]; }

        let txType = debit ? 'DR' : credit ? 'CR' : null;
        if (/\bNEFT\b/i.test(lines[i])) txType = txType === 'DR' ? 'NEFT-DR' : 'NEFT';
        else if (/\bRTGS\b/i.test(lines[i])) txType = txType === 'DR' ? 'RTGS-DR' : 'RTGS';
        else if (/\bIMPS\b/i.test(lines[i])) txType = txType === 'DR' ? 'IMPS-DR' : 'IMPS';
        else if (/\bUPI\b/i.test(lines[i])) txType = txType === 'DR' ? 'UPI-DR' : 'UPI';

        if (desc.length > 2) {
          txns.push({ lineNo: txns.length + 1, txDate, description: desc, refNo: null, txType, debit, credit, balance });
        }
      }
    }
    i++;
  }
  // Filter out junk rows: must have at least one amount (debit, credit, or balance)
  // and description should not be a pure date/header artifact
  const JUNK_DESC = /^(to|from|date|period|balance|statement|s\.no|particulars|amount|cheque)\b/i;
  return txns.filter(t =>
    (t.debit != null || t.credit != null || t.balance != null) &&
    t.description && t.description.length > 3 &&
    !JUNK_DESC.test(t.description.trim())
  ).map((t, i) => ({ ...t, lineNo: i + 1 }));
}

// ── Extract header info from statement text ───────────────────────────────────
function extractBstHeader(text, fileName) {
  // Use header-only detection (not full text, to avoid NEFT counterparty bank names)
  const bankName = normBankName(text) || normBankName(fileName || '') || 'Unknown Bank';

  // Account number: handle "Account No : 911020000421488" format
  const acMatch = text.match(/(?:account\s*no|a\/c\s*no|account\s*number)[:\s]*([0-9X*]{8,22})/i);
  const accountNo = acMatch ? acMatch[1].replace(/\s/g, '') : null;

  // IFSC — handle "IFSC Code : UTIB0000553" format
  const ifscMatch = text.match(/IFSC\s*(?:Code)?\s*[:\s]+([A-Z]{4}0[A-Z0-9]{6})/i);
  const ifsc = ifscMatch ? ifscMatch[1] : null;

  // Account holder name (first non-blank line of the statement, before bank-specific info)
  const holderMatch = text.match(/^([A-Z][A-Z &()./,'-]{4,80})\s*\n/m);
  const accountHolder = holderMatch ? holderMatch[1].trim() : null;

  // Statement period from "From : DD/MM/YYYY To : DD/MM/YYYY" or similar
  const periodMatch = text.match(/from\s*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})[\s\S]{0,30}to\s*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  const fromDate = periodMatch ? parseDate(periodMatch[1]) : null;
  const toDate   = periodMatch ? parseDate(periodMatch[2]) : null;

  // Balances — handle "INR 1,02,083.39" format
  const opMatch = text.match(/opening\s*balance[:\s]*(?:INR\s*)?([\d,]+\.\d{2})/i);
  const clMatch = text.match(/closing\s*balance[:\s]*(?:INR\s*)?([\d,]+\.\d{2})/i);
  const openingBalance = parseAmt(opMatch?.[1]);
  const closingBalance = parseAmt(clMatch?.[1]);

  return {
    bankName, accountNo, ifsc, fromDate, toDate,
    openingBalance, closingBalance,
    grandTotal: closingBalance,
    docDate: toDate || fromDate,
  };
}

// ── Excel/CSV bank statement parser ─────────────────────────────────────────
function parseExcelBankStatement(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  const fullText = rows.map(r => r.map(String).join(' | ')).join('\n');
  const header = extractBstHeader(fullText, path.basename(filePath));

  // Find header row
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i].map(c => String(c).toLowerCase().trim());
    if (row.some(c => /date/.test(c)) && row.some(c => /balance/.test(c))) {
      hdrIdx = i; break;
    }
  }

  if (hdrIdx < 0) {
    // Fallback: parse plain text
    const txns = parseTransactionText(fullText);
    return { header, lines: txns, source: 'excel-text-fallback' };
  }

  const hdr = rows[hdrIdx].map(c => String(c).toLowerCase().trim());
  const col = (kws) => hdr.findIndex(h => kws.some(k => h.includes(k)));
  const colDate = col(['date']);
  const colDesc = col(['narration','description','particulars','detail']);
  const colRef  = col(['chq','ref','utr','txn id','cheque']);
  const colDr   = col(['withdrawal','debit','dr','amount dr']);
  const colCr   = col(['deposit','credit','cr','amount cr']);
  const colBal  = col(['balance']);

  const txns = [];
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const txDate = parseDate(row[colDate]);
    if (!txDate) continue;
    const desc   = colDesc >= 0 ? String(row[colDesc] || '').trim().slice(0,120) : '';
    const refNo  = colRef >= 0 ? String(row[colRef] || '').trim() || null : null;
    const debit  = colDr >= 0 ? parseAmt(row[colDr]) : null;
    const credit = colCr >= 0 ? parseAmt(row[colCr]) : null;
    const balance = colBal >= 0 ? parseAmt(row[colBal]) : null;
    if (!desc) continue;
    const txType = debit ? 'DR' : credit ? 'CR' : null;
    txns.push({ lineNo: txns.length+1, txDate, description: desc, refNo, txType, debit, credit, balance });
  }
  return { header, lines: txns, source: 'excel-direct' };
}

// ── PDF digital bank statement parser ────────────────────────────────────────
async function parsePdfBankStatement(filePath) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(fs.readFileSync(filePath));
  const text = data.text || '';
  const header = extractBstHeader(text, path.basename(filePath));
  const lines  = parseTransactionText(text);
  return { header, lines, rawText: text, source: 'pdf-direct', pageCount: data.numpages };
}

// ── Main entry: choose best parsing strategy ──────────────────────────────────
/**
 * @param {string} filePath
 * @returns {{ header, lines, rawText, source, needsOcr }}
 *   needsOcr=true when file is a scanned PDF/image (no text layer)
 */
async function parseBankStatement(filePath, bankNameHint) {
  const ext = path.extname(filePath).toLowerCase();

  // Excel or CSV — parse directly, no OCR needed
  if (/\.(xlsx|xls|csv|tsv)$/i.test(ext)) {
    console.log('[bankParser] Excel/CSV: parsing directly');
    const result = parseExcelBankStatement(filePath);
    if (bankNameHint) result.header.bankName = bankNameHint;
    return { ...result, needsOcr: false };
  }

  if (/\.pdf$/i.test(ext)) {
    console.log('[bankParser] PDF: trying text layer extraction');
    const result = await parsePdfBankStatement(filePath);
    // Check quality of extraction
    if (result.lines.length >= 2) {
      console.log(`[bankParser] PDF text layer: ${result.lines.length} transactions found`);
      if (bankNameHint) result.header.bankName = bankNameHint;
      return { ...result, needsOcr: false };
    }
    // Text layer empty/garbled — need OCR
    console.log('[bankParser] PDF has no usable text layer — will need OCR');
    return { header: result.header, lines: [], rawText: result.rawText, source: 'pdf-scan', needsOcr: true };
  }

  // Image file — will need OCR
  return { header: extractBstHeader('', path.basename(filePath)), lines: [], rawText: '', source: 'image-scan', needsOcr: true };
}

module.exports = { parseBankStatement, parseTransactionText, extractBstHeader, normBankName, parseDate, parseAmt };
