/**
 * Deterministic mock of the Sarvam layer (DOCAI_MOCK=1) so the full wizard runs offline.
 * It fakes: OCR text, document-type detection and structured extraction.
 */
const path = require('path');

function sampleFor(fileName = '', hint = '') {
  const f = (fileName + ' ' + hint).toLowerCase();
  if (/payment|pv\b/.test(f)) return PAYMENT;
  if (/receipt|rv\b/.test(f)) return RECEIPT;
  if (/sales invoice|\bsi\b|metro mart/.test(f)) return SALES;
  if (/purchase invoice|tax invoice/.test(f)) return PURCHASE;
  if (/purchase order|\bpo\b/.test(f)) return PO;
  if (/grn|goods receipt/.test(f)) return GRN;
  if (/transfer|st\b/.test(f)) return TRANSFER;
  return PURCHASE;
}

const PURCHASE = {
  type: 'PI', confidence: 0.96,
  text: `TAX INVOICE\nSri Lakshmi Traders\nGSTIN: 36AABCS1234F1Z5  Plot 12, Balanagar, Hyderabad\nInvoice No: SLT/2026/0912   Date: 28-09-2026\nPO Ref: PO-2026-00341\nBill To: RetailCLIQ Stores, Kukatpally\n\n| # | Description | HSN | Qty | UOM | Rate | GST% | Amount |\n| 1 | Basmati Rice 5kg | 1006 | 40 | PCS | 410.00 | 5 | 16400.00 |\n| 2 | Sunflower Oil 1L | 1512 | 60 | PCS | 140.00 | 5 | 8400.00 |\n| 3 | Toor Dal 1kg | 0713 | 25 | PCS | 155.00 | 0 | 3875.00 |\n| 4 | Jaggery Cubes 500g | 1701 | 30 | PCS | 48.00 | 5 | 1440.00 |\n\nSub Total 30115.00\nDiscount 315.00\nCGST 655.00  SGST 655.00\nRound Off 0.00\nGrand Total 31110.00\nE.&O.E.  For Sri Lakshmi Traders`,
  header: { party: 'Sri Lakshmi Traders', partyGstin: '36AABCS1234F1Z5', partyAddress: 'Plot 12, Balanagar, Hyderabad', docNo: 'SLT/2026/0912', docDate: '2026-09-28', refNo: 'PO-2026-00341', refDate: null, branch: null, warehouse: null, currency: 'INR', remarks: null, subTotal: 30115, discountTotal: 315, taxTotal: 1310, charges: 0, roundOff: 0, grandTotal: 31110 },
  lines: [
    { lineNo: 1, itemCode: null, barcode: null, description: 'Basmati Rice 5kg', hsn: '1006', batch: null, expiry: null, qty: 40, uom: 'PCS', rate: 410, discountPct: 0, taxPct: 5, taxAmt: 820, amount: 16400 },
    { lineNo: 2, itemCode: null, barcode: null, description: 'Sunflower Oil 1L', hsn: '1512', batch: null, expiry: null, qty: 60, uom: 'PCS', rate: 140, discountPct: 0, taxPct: 5, taxAmt: 420, amount: 8400 },
    { lineNo: 3, itemCode: null, barcode: null, description: 'Toor Dal 1kg', hsn: '0713', batch: null, expiry: null, qty: 25, uom: 'PCS', rate: 155, discountPct: 0, taxPct: 0, taxAmt: 0, amount: 3875 },
    { lineNo: 4, itemCode: null, barcode: null, description: 'Jaggery Cubes 500g', hsn: '1701', batch: null, expiry: null, qty: 30, uom: 'PCS', rate: 48, discountPct: 0, taxPct: 5, taxAmt: 72, amount: 1440 },
  ],
};
const PO = { ...PURCHASE, type: 'PO', confidence: 0.91, header: { ...PURCHASE.header, docNo: 'PO-2026-00341', docDate: '2026-09-20', refNo: null } };
const GRN = { ...PURCHASE, type: 'GRN', confidence: 0.88, header: { ...PURCHASE.header, docNo: 'GRN-0455', docDate: '2026-09-27', refNo: 'PO-2026-00341' } };
const SALES = {
  type: 'SI', confidence: 0.94,
  text: 'TAX INVOICE  Metro Mart Retail ... (mock)',
  header: { party: 'Metro Mart Retail', partyGstin: '36AAACM3456P1Z1', partyAddress: 'Ameerpet, Hyderabad', docNo: 'SI/26-27/0088', docDate: '2026-09-30', refNo: 'SO-1192', currency: 'INR', subTotal: 9480, discountTotal: 0, taxTotal: 474, charges: 0, roundOff: 0, grandTotal: 9954 },
  lines: [
    { lineNo: 1, description: 'Basmati Rice 5kg', barcode: '8901234000011', hsn: '1006', qty: 12, uom: 'PCS', rate: 480, taxPct: 5, taxAmt: 288, amount: 5760 },
    { lineNo: 2, description: 'Sunflower Oil 1L', barcode: '8901234000028', hsn: '1512', qty: 24, uom: 'PCS', rate: 155, taxPct: 5, taxAmt: 186, amount: 3720 },
  ],
};
const PAYMENT = {
  type: 'PV', confidence: 0.9, text: 'PAYMENT VOUCHER ... (mock)',
  header: { party: 'Sri Lakshmi Traders', docNo: 'PV-2026-0071', docDate: '2026-09-30', refNo: 'SLT/2026/0912', paymentMode: 'NEFT', bankAccount: 'HDFC Bank 4521', instrumentNo: 'UTR9876543210', instrumentDate: '2026-09-30', grandTotal: 31110 },
  lines: [{ lineNo: 1, account: 'Sri Lakshmi Traders', description: 'Against Inv SLT/2026/0912', debit: 31110, credit: 0 }, { lineNo: 2, account: 'HDFC Bank 4521', description: 'NEFT UTR9876543210', debit: 0, credit: 31110 }],
};
const RECEIPT = {
  type: 'RV', confidence: 0.9, text: 'RECEIPT VOUCHER ... (mock)',
  header: { party: 'Metro Mart Retail', docNo: 'RV-2026-0033', docDate: '2026-10-01', refNo: 'SI/26-27/0088', paymentMode: 'UPI', bankAccount: 'HDFC Bank 4521', instrumentNo: 'UPI55519', instrumentDate: '2026-10-01', grandTotal: 9954 },
  lines: [{ lineNo: 1, account: 'HDFC Bank 4521', description: 'UPI receipt', debit: 9954, credit: 0 }, { lineNo: 2, account: 'Metro Mart Retail', description: 'Against SI/26-27/0088', debit: 0, credit: 9954 }],
};
const TRANSFER = {
  type: 'ST', confidence: 0.87, text: 'STOCK TRANSFER NOTE ... (mock)',
  header: { fromWarehouse: 'Main Warehouse', toWarehouse: 'Store Floor', docNo: 'ST-0019', docDate: '2026-10-01', subTotal: 1600, grandTotal: 1600 },
  lines: [{ lineNo: 1, description: 'Tomato (Loose)', barcode: '2000000000050', qty: 50, uom: 'KG', rate: 32, amount: 1600 }],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  async digitiseToText(filePath) { await sleep(600); const s = sampleFor(path.basename(filePath)); return { jobId: 'mock-digitise', pages: [{ page: 1, content: s.text }], text: s.text, usage: { pages_total: 1, pages_processed: 1, pages_succeeded: 1, pages_failed: 0 } }; },
  async detect(text, fileName) { await sleep(400); const s = sampleFor(fileName, text); return { documentType: s.type, confidence: s.confidence, reasons: ['Mock detection based on file name / text keywords'], alternatives: [{ documentType: 'PI', confidence: 0.03 }, { documentType: 'GRN', confidence: 0.01 }].filter((a) => a.documentType !== s.type) }; },
  async structure(text, docType, fileName) { await sleep(700); const s = sampleFor(fileName, text); return { documentType: docType || s.type, header: { ...s.header }, lines: s.lines.map((l) => ({ ...l })), confidence: { header: 0.95, lines: 0.92 } }; },
  sampleFor,
};
