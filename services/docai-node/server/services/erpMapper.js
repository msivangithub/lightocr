/**
 * RetailCLIQ transaction mapper.
 * Converts a DocAI batch (extracted header + lines + master mapping) into the EXACT shapes the
 * RetailCLIQ GRC screens (Purchase Invoice, GRN Against PO/PI, Purchase Invoice Return, GRN Return)
 * and the Stock_Import_Export staging table expect.
 *
 *  rows[]     → IMPORT_TARGET_FIELDS of the screens' import wizard (oemCode, itemName, qty, purchasePrice, mrp,
 *               discount, disType, discountPrice, division, dept, category, subcatg, style, design, size, color,
 *               brand, vertical1-3, inTax, inTaxType, outTax, outTaxType, batchNo, packedDate, expiryDate,
 *               supplierName, wspPrice)  + grid columns (code, artCode, hsn, uom, rate, price, wsp, disc, pn,
 *               cgst, sgst, amount, remarks)
 *  header     → Document Information / Supplier Information / Bill Information / Tax Breakup / Amount Details
 *  staging[]  → Stock_Import_Export rows for proc_StockImportwithSupplier
 *
 * Classification for NEW items (very common for apparel – every lot gets fresh OEM codes):
 *  1. matched Itemmaster/Itemproperties row → copy its classification
 *  2. supplier profile defaults (DocAI_SupplierProfile)      – learned from what the user saved last time
 *  3. HSN → division/dept/category table (configurable)      – 5407 sarees/fabric, 6203 mens, 6204 womens …
 *  4. description heuristics (size / colour tokens)
 */
const db = require('./db');
const docTypes = require('./documentTypes');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const n0 = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

/* ---------------- HSN classification (edit freely / move to DocAI_HsnMap table) */
const HSN_MAP = [
  { prefix: '5007', division: 'Textiles', dept: 'Womens', category: 'Silk Sarees', subcatg: 'Pure Silk' },
  { prefix: '5208', division: 'Textiles', dept: 'Fabrics', category: 'Cotton Fabric', subcatg: 'Shirting' },
  { prefix: '5407', division: 'Textiles', dept: 'Womens', category: 'Sarees', subcatg: 'Synthetic Sarees' },
  { prefix: '5408', division: 'Textiles', dept: 'Womens', category: 'Sarees', subcatg: 'Art Silk' },
  { prefix: '5512', division: 'Textiles', dept: 'Fabrics', category: 'Polyester Fabric', subcatg: 'Suiting' },
  { prefix: '5801', division: 'Textiles', dept: 'Fabrics', category: 'Velvet', subcatg: 'Velvet' },
  { prefix: '6101', division: 'Textiles', dept: 'Mens', category: 'Jackets', subcatg: 'Knitted' },
  { prefix: '6104', division: 'Textiles', dept: 'Womens', category: 'Suits & Sets', subcatg: 'Knitted' },
  { prefix: '6105', division: 'Textiles', dept: 'Mens', category: 'Shirts', subcatg: 'Knitted Shirts' },
  { prefix: '6106', division: 'Textiles', dept: 'Womens', category: 'Tops', subcatg: 'Knitted Tops' },
  { prefix: '6109', division: 'Textiles', dept: 'Unisex', category: 'T-Shirts', subcatg: 'T-Shirts' },
  { prefix: '6110', division: 'Textiles', dept: 'Unisex', category: 'Sweaters', subcatg: 'Pullovers' },
  { prefix: '6111', division: 'Textiles', dept: 'Kids', category: 'Infant Wear', subcatg: 'Knitted' },
  { prefix: '6115', division: 'Textiles', dept: 'Unisex', category: 'Hosiery', subcatg: 'Socks' },
  { prefix: '6201', division: 'Textiles', dept: 'Mens', category: 'Jackets', subcatg: 'Woven' },
  { prefix: '6203', division: 'Textiles', dept: 'Mens', category: 'Trousers & Suits', subcatg: 'Woven' },
  { prefix: '6204', division: 'Textiles', dept: 'Womens', category: 'Dresses & Suits', subcatg: 'Woven' },
  { prefix: '6205', division: 'Textiles', dept: 'Mens', category: 'Shirts', subcatg: 'Woven Shirts' },
  { prefix: '6206', division: 'Textiles', dept: 'Womens', category: 'Blouses & Tops', subcatg: 'Woven' },
  { prefix: '6207', division: 'Textiles', dept: 'Mens', category: 'Innerwear', subcatg: 'Woven' },
  { prefix: '6208', division: 'Textiles', dept: 'Womens', category: 'Innerwear & Nightwear', subcatg: 'Woven' },
  { prefix: '6209', division: 'Textiles', dept: 'Kids', category: 'Infant Wear', subcatg: 'Woven' },
  { prefix: '6211', division: 'Textiles', dept: 'Unisex', category: 'Ethnic Wear', subcatg: 'Kurta Sets' },
  { prefix: '6214', division: 'Textiles', dept: 'Womens', category: 'Dupattas & Scarves', subcatg: 'Dupatta' },
  { prefix: '6301', division: 'Home', dept: 'Home Textiles', category: 'Blankets', subcatg: 'Blankets' },
  { prefix: '6302', division: 'Home', dept: 'Home Textiles', category: 'Bed & Table Linen', subcatg: 'Bedsheets' },
  { prefix: '6304', division: 'Home', dept: 'Home Textiles', category: 'Furnishing', subcatg: 'Curtains' },
  { prefix: '64', division: 'Footwear', dept: 'Footwear', category: 'Footwear', subcatg: 'General' },
  { prefix: '8712', division: 'General', dept: 'Sports', category: 'Bicycles', subcatg: 'Bicycles' },
  { prefix: '3004', division: 'Pharma', dept: 'Medicines', category: 'Tablets', subcatg: 'General' },
  { prefix: '10', division: 'Grocery', dept: 'Staples', category: 'Grains', subcatg: 'Rice & Cereals' },
  { prefix: '15', division: 'Grocery', dept: 'Staples', category: 'Edible Oils', subcatg: 'Oils' },
];
function classifyByHsn(hsn) { const h = String(hsn || '').replace(/\D/g, ''); if (!h) return null; return HSN_MAP.filter((m) => h.startsWith(m.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0] || null; }

const SIZE_RE = /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|FREE\s*SIZE|FS|\d{2}(?:\s*(?:cm|in|"))?|\d{2,3}x\d{2,3})\b/i;
const COLOUR_RE = /\b(black|white|red|blue|navy|green|yellow|pink|purple|violet|orange|brown|grey|gray|beige|cream|maroon|wine|peach|mustard|olive|teal|turquoise|sky|rust|gold|silver|multi|lavender|magenta|coral|mint|ivory|khaki|rani|firozi|mehndi|gajri|chiku|lemon|onion|copper|bottle\s*green|sea\s*green|royal\s*blue|baby\s*pink|hot\s*pink|dark\s*\w+|light\s*\w+)\b/i;
function guessFromDescription(desc = '') { const size = (SIZE_RE.exec(desc) || [])[1] || null; const colour = (COLOUR_RE.exec(desc) || [])[1] || null; return { size, colour }; }

/* ---------------- supplier profiles (defaults learned per supplier) */
const PROFILES = new Map(); // supplierCode → { division, dept, category, subcatg, gstType, disType, payMode, purchaseAc, uom }
function getProfile(code) { return PROFILES.get(code) || null; }
function saveProfile(code, data) { PROFILES.set(code, { ...(PROFILES.get(code) || {}), ...data, updatedAt: new Date().toISOString() }); return PROFILES.get(code); }

/* ---------------- mapping */
async function toErp(batch, { targetScreen = 'PI' } = {}) {
  const type = docTypes.get(batch.docType) || docTypes.get('PI');
  const h = batch.header; const lines = batch.lines;
  const supplierCode = h.party && typeof h.party === 'string' && !/\s/.test(h.party) ? h.party : null;
  const supplierName = h.partyName || (supplierCode ? null : h.party) || '';
  const profile = supplierCode ? getProfile(supplierCode) : null;
  const items = await db.allMasters('item', batch.tenantDb); const byCode = new Map(items.map((i) => [String(i.code), i])); const byBarcode = new Map(items.filter((i) => i.barcode).map((i) => [String(i.barcode), i]));
  const interState = h.igst != null && h.igst > 0 || (h.partyGstin && h.buyerGstin && h.partyGstin.slice(0, 2) !== h.buyerGstin.slice(0, 2));
  const gstType = profile?.gstType || 'excl';
  const warnings = [];

  const rows = lines.map((l, i) => {
    const master = (l.itemCode && byCode.get(String(l.itemCode))) || (l.barcode && byBarcode.get(String(l.barcode))) || null;
    const hsnCls = classifyByHsn(l.hsn || master?.hsn);
    const guess = guessFromDescription(l.description);
    const qty = n0(l.qty) || n0(l.pcs);
    const rate = n0(l.rate) || (qty ? r2(n0(l.amount) / qty) : 0);
    const taxPct = l.taxPct != null ? n0(l.taxPct) : master?.taxPct != null ? n0(master.taxPct) : null;
    const discAmt = l.discountAmt != null ? n0(l.discountAmt) : l.discountPct != null ? r2(qty * rate * n0(l.discountPct) / 100) : 0;
    const disType = l.discountPct != null && l.discountAmt == null ? 'P' : 'A';
    const discount = disType === 'P' ? n0(l.discountPct) : discAmt;
    const oemCode = l.barcode || l.styleNo || master?.barcode || null;
    const synthesized = !oemCode;
    const oem = oemCode || `${(h.docNo || 'DOC').replace(/[^A-Z0-9]/gi, '').slice(-8)}-${String(i + 1).padStart(3, '0')}`;
    if (synthesized) warnings.push(`Line ${i + 1}: OEM code auto-generated (${oem})`);
    if (!taxPct && taxPct !== 0) warnings.push(`Line ${i + 1}: GST % not found – using supplier/HSN default`);
    const inTax = taxPct ?? (h.subTotal && h.taxTotal ? r2(h.taxTotal / h.subTotal * 100) : 5);
    const half = r2(inTax / 2);
    const amount = l.amount != null ? n0(l.amount) : r2(qty * rate - discAmt);
    return {
      // ---- IMPORT_TARGET_FIELDS (screens' import wizard / Stock_Import_Export)
      oemCode: oem, oemCodeSynthesized: synthesized,
      itemName: master?.name || l.description || '', qty, purchasePrice: rate,
      mrp: n0(l.mrp) || n0(master?.mrp) || 0, discount, disType, discountPrice: discAmt,
      division: master?.division || profile?.division || hsnCls?.division || 'Textiles',
      dept: master?.dept || profile?.dept || hsnCls?.dept || 'General',
      category: master?.category || profile?.category || hsnCls?.category || 'General',
      subcatg: master?.subcatg || profile?.subcatg || hsnCls?.subcatg || 'General',
      style: l.styleNo || master?.style || '-', design: master?.design || l.styleNo || '-',
      size: l.size || guess.size || master?.size || '-', color: l.colour || guess.colour || master?.color || '-',
      brand: master?.brand || profile?.brand || supplierName || '-',
      vertical1: '', vertical2: '', vertical3: '',
      inTax, inTaxType: gstType === 'incl' ? 'I' : 'E', outTax: master?.outputTax ?? inTax, outTaxType: 'E',
      batchNo: l.batchCode || l.batch || '', packedDate: l.mfgDate || '', expiryDate: l.expiry || '',
      supplierName, wspPrice: n0(l.wsp) || n0(master?.wsp) || 0,
      // ---- grid columns of the GRC screens
      code: master?.code || '', artCode: master?.artCode || '', barcode: l.barcode || master?.barcode || '', hsn: l.hsn || master?.hsn || '',
      uom: l.uom || master?.uom || profile?.uom || 'PCS', rate, price: n0(l.mrp) || n0(master?.mrp) || rate, wsp: n0(master?.wsp) || 0,
      disc: discAmt, pn: 'P', cgst: interState ? 0 : half, sgst: interState ? 0 : half, igst: interState ? inTax : 0, amount, gstType,
      remarks: l.description && master ? l.description : '', srcLine: i + 1, matched: !!master, confidence: batch.extraction?.confidence?.lines ?? null,
    };
  });

  const gross = r2(rows.reduce((s, r) => s + r.qty * r.rate, 0));
  const discount = r2(n0(h.discountTotal) || rows.reduce((s, r) => s + r.disc, 0));
  const cgst = n0(h.cgst), sgst = n0(h.sgst), igst = n0(h.igst);
  const gst = n0(h.taxTotal) || r2(cgst + sgst + igst) || r2(rows.reduce((s, r) => s + r.amount * r.inTax / 100, 0));
  const net = n0(h.grandTotal) || r2(gross - discount + gst + n0(h.charges) + n0(h.roundOff));
  const header = {
    screen: targetScreen, docType: type.code, mode: h.refNo && /PO/i.test(h.refNo) ? 'po' : 'general',
    // Document Information
    invoiceNo: h.docNo || '', invoiceDate: h.docDate || '', invoiceRef: h.refNo || '', againstGrnNo: '', grnDate: '', againstPiNo: h.refNo || '', lrRef: h.lrNo || '', lrDate: h.lrDate || '',
    payMode: profile?.payMode || (/cash/i.test(h.paymentTerms || '') ? 'Cash' : 'Credit'), supplier: supplierName, supplierCode: supplierCode || '', purchaseAc: profile?.purchaseAc || 'Purchases', remarks: h.remarks || `DocAI ${batch.id.slice(0, 8)} · ${batch.source?.fileName || ''}`.trim(),
    // Supplier Information
    gstin: h.partyGstin || '', stCode: h.partyGstin ? h.partyGstin.slice(0, 2) : '', placeOfSupply: h.placeOfSupply || '', transporter: h.transporter || '', ewayBillNo: h.ewayBillNo || '', irn: h.irn || '', dueDate: h.dueDate || '',
    // Bill Information
    discPct: gross ? r2(discount / gross * 100) : 0, freight: n0(h.charges), freightGst: 0, roundOff: n0(h.roundOff), tcs: n0(h.tcs),
    // Tax Breakup
    cgstAmt: cgst, sgstAmt: sgst, igstAmt: igst, utgstAmt: 0, interState: !!interState,
    // Amount Details
    grossAmount: gross, discount, gstAmount: gst, netAmount: net,
    lineCount: rows.length, totalQty: r2(rows.reduce((s, r) => s + r.qty, 0)), totalAmount: r2(rows.reduce((s, r) => s + r.amount, 0)), totalDisc: discount,
    docDateHBS: db.toHBS(h.docDate), invoiceDateHBS: db.toHBS(h.docDate),
  };
  // integrity check the screen will also run
  const calcNet = r2(gross - discount + gst + header.freight + header.tcs + header.roundOff);
  if (Math.abs(calcNet - net) > 1) warnings.push(`Net amount ${net} ≠ gross − disc + gst + freight + round off (${calcNet})`);
  const staging = rows.map((r) => ({ SupplierName: r.supplierName, InvoiceNo: header.invoiceNo, InvoiceDate: header.invoiceDate, InvoiceDateHBS: header.invoiceDateHBS, OEMCode: r.oemCode, ItemDescription: r.itemName, Qty: r.qty, PurchasePrice: r.purchasePrice, MRP: r.mrp, Discount: r.discount, DisType: r.disType, DiscountPrice: r.discountPrice, Division: r.division, Department: r.dept, Category: r.category, SubCategory: r.subcatg, Style: r.style, Design: r.design, Size: r.size, Color: r.color, Brand: r.brand, Verticle1: r.vertical1, Verticle2: r.vertical2, Verticle3: r.vertical3, InTax: r.inTax, InTaxType: r.inTaxType, OutTax: r.outTax, OutTaxType: r.outTaxType, BatchNo: r.batchNo, PackedDate: r.packedDate, ExpiryDate: r.expiryDate, WSPPrice: r.wspPrice, HSNCode: r.hsn, UOM: r.uom, BatchId: batch.id }));
  return { ok: true, batchId: batch.id, docType: type.code, header, rows, staging, warnings, validation: batch.validation?.summary || null, source: { fileName: batch.source?.fileName, pages: batch.pages?.length || 1 } };
}

module.exports = { toErp, classifyByHsn, guessFromDescription, HSN_MAP, getProfile, saveProfile };
