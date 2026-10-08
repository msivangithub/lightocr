/**
 * Configurable Document Type Framework (spec §15).
 * New document types are added here (or via POST /api/docai/doc-types) – never as a new wizard.
 *
 * Each type defines: code, name, header fields, line fields, required fields, master mappings,
 * relationships (what it can be converted from / linked to), inventory/accounting/tax impact,
 * approval, posting rules (the transactions that will be created), and AI extraction instructions.
 */

const COMMON_HEADER = [
  { key: 'docNo', label: 'Document No', type: 'string', required: true },
  { key: 'docDate', label: 'Document Date', type: 'date', required: true },
  { key: 'refNo', label: 'Reference No', type: 'string' },
  { key: 'refDate', label: 'Reference Date', type: 'date' },
  { key: 'branch', label: 'Branch', type: 'master', master: 'branch' },
  { key: 'warehouse', label: 'Warehouse', type: 'master', master: 'warehouse' },
  { key: 'currency', label: 'Currency', type: 'string', default: 'INR' },
  { key: 'remarks', label: 'Remarks', type: 'string' },
];
const TOTALS = [
  { key: 'subTotal', label: 'Taxable Value', type: 'money' },
  { key: 'discountTotal', label: 'Discount', type: 'money' },
  { key: 'cgst', label: 'CGST', type: 'money' },
  { key: 'sgst', label: 'SGST', type: 'money' },
  { key: 'igst', label: 'IGST', type: 'money' },
  { key: 'taxTotal', label: 'Tax Total', type: 'money' },
  { key: 'tcs', label: 'TCS', type: 'money' },
  { key: 'charges', label: 'Other Charges', type: 'money' },
  { key: 'roundOff', label: 'Round Off', type: 'money' },
  { key: 'grandTotal', label: 'Grand Total', type: 'money', required: true },
  { key: 'totalQty', label: 'Total Qty', type: 'number' },
  { key: 'amountInWords', label: 'Amount in Words', type: 'string' },
];
const ITEM_LINES = [
  { key: 'lineNo', label: '#', type: 'int' },
  { key: 'itemCode', label: 'Item Code', type: 'master', master: 'item' },
  { key: 'barcode', label: 'Barcode', type: 'master', master: 'barcode' },
  { key: 'description', label: 'Description', type: 'string', required: true },
  { key: 'hsn', label: 'HSN/SAC', type: 'string' },
  { key: 'styleNo', label: 'Style / Design', type: 'string' },
  { key: 'colour', label: 'Colour', type: 'string' },
  { key: 'size', label: 'Size', type: 'string' },
  { key: 'mrp', label: 'MRP', type: 'money' },
  { key: 'batch', label: 'Batch', type: 'master', master: 'batch' },
  { key: 'expiry', label: 'Expiry', type: 'date' },
  { key: 'serial', label: 'Serial No', type: 'string' },
  { key: 'pcs', label: 'Pcs', type: 'number' },
  { key: 'qty', label: 'Qty', type: 'number', required: true },
  { key: 'uom', label: 'UOM', type: 'master', master: 'uom' },
  { key: 'rate', label: 'Rate', type: 'money', required: true },
  { key: 'discountPct', label: 'Disc %', type: 'number' },
  { key: 'discountAmt', label: 'Disc Amt', type: 'money' },
  { key: 'taxPct', label: 'GST %', type: 'master', master: 'tax' },
  { key: 'taxAmt', label: 'Tax Amt', type: 'money' },
  { key: 'taxable', label: 'Taxable', type: 'money' },
  { key: 'amount', label: 'Line Amount', type: 'money', required: true },
];
const VOUCHER_LINES = [
  { key: 'lineNo', label: '#', type: 'int' },
  { key: 'account', label: 'Account / Ledger', type: 'master', master: 'account', required: true },
  { key: 'description', label: 'Narration', type: 'string' },
  { key: 'costCentre', label: 'Cost Centre', type: 'master', master: 'costCentre' },
  { key: 'debit', label: 'Debit', type: 'money' },
  { key: 'credit', label: 'Credit', type: 'money' },
];

const party = (role) => ({ key: 'party', label: role === 'supplier' ? 'Supplier' : 'Customer', type: 'master', master: role, required: true });
const partyExtras = [
  { key: 'partyGstin', label: 'GSTIN', type: 'string' },
  { key: 'partyAddress', label: 'Address', type: 'string' },
  { key: 'partyState', label: 'State / Code', type: 'string' },
  { key: 'buyerName', label: 'Billed To', type: 'string' },
  { key: 'buyerGstin', label: 'Buyer GSTIN', type: 'string' },
  { key: 'placeOfSupply', label: 'Place of Supply', type: 'string' },
  { key: 'irn', label: 'IRN', type: 'string' },
  { key: 'ewayBillNo', label: 'E-Way Bill', type: 'string' },
  { key: 'transporter', label: 'Transporter', type: 'string' },
  { key: 'lrNo', label: 'LR / GR No', type: 'string' },
  { key: 'lrDate', label: 'LR Date', type: 'date' },
  { key: 'dueDate', label: 'Due Date', type: 'date' },
  { key: 'paymentTerms', label: 'Payment Terms', type: 'string' },
  { key: 'cases', label: 'Cases / Bales', type: 'number' },
  { key: 'bankAccount', label: 'Bank A/c', type: 'string' },
  { key: 'ifsc', label: 'IFSC', type: 'string' },
];

const AI_BASE = `You are reading an Indian GST business document (often textile/apparel/retail wholesale, sometimes handwritten or photographed) for an ERP. The reader's company is the BUYER; the seller/supplier is the party whose GSTIN appears in the header ("Seller", "From", top letterhead). "Billed To / Buyer / Consignee" is our company. Extract exactly what is printed. Dates as YYYY-MM-DD (Indian dates are DD-MM-YYYY). Numbers without currency symbols or thousands separators (1,02,000.00 → 102000). Keep line items in printed order; one row per printed line even if description repeats; capture style/design no, colour, size, pcs, metres, MRP, HSN, GST % when present. Totals: taxable value, discount, CGST, SGST, IGST, TCS, round off, grand total/net amount. Also capture IRN, e-way bill, transporter, LR/GR no, due date, bank account & IFSC. Use null when a value is not present. Never invent values.`;

// ── Bank statement line fields ────────────────────────────────────────────────
const BANK_STMT_LINES = [
  { key: 'lineNo', label: '#', type: 'int' },
  { key: 'txDate', label: 'Txn Date', type: 'date', required: true },
  { key: 'valueDate', label: 'Value Date', type: 'date' },
  { key: 'description', label: 'Description / Narration', type: 'string', required: true },
  { key: 'refNo', label: 'Ref / Chq No', type: 'string' },
  { key: 'txType', label: 'Txn Type', type: 'string' },  // CR / DR / NEFT / RTGS / UPI / CHQ etc.
  { key: 'debit', label: 'Debit (Dr)', type: 'money' },
  { key: 'credit', label: 'Credit (Cr)', type: 'money' },
  { key: 'balance', label: 'Balance', type: 'money' },
];

// ── TDS/Tax lines ─────────────────────────────────────────────────────────────
const TDS_LINES = [
  { key: 'lineNo', label: '#', type: 'int' },
  { key: 'deducteeName', label: 'Deductee Name', type: 'string', required: true },
  { key: 'deducteePan', label: 'Deductee PAN', type: 'string' },
  { key: 'section', label: 'TDS Section', type: 'string' },
  { key: 'taxableAmount', label: 'Taxable Amount', type: 'money', required: true },
  { key: 'tdsPct', label: 'TDS %', type: 'number' },
  { key: 'tdsAmount', label: 'TDS Amount', type: 'money' },
  { key: 'surcharge', label: 'Surcharge', type: 'money' },
  { key: 'educationCess', label: 'Education Cess', type: 'money' },
  { key: 'netAmount', label: 'Net Payment', type: 'money' },
];

// ── PT / EDI trade format lines (purchases/sales) ─────────────────────────────
const PT_ITEM_LINES = [
  ...ITEM_LINES,
  { key: 'erpCode', label: 'ERP / Tally Code', type: 'string' },
  { key: 'partnerSKU', label: 'Partner SKU', type: 'string' },
  { key: 'eanCode', label: 'EAN / GTIN', type: 'string' },
  { key: 'packSize', label: 'Pack Size', type: 'string' },
];

function itemDoc(code, name, role, extra = {}) {
  return {
    code, name,
    category: extra.category || 'trading',
    headerFields: [party(role), ...partyExtras, ...COMMON_HEADER, ...TOTALS, ...(extra.header || [])],
    lineFields: ITEM_LINES,
    requiredFields: ['party', 'docNo', 'docDate', 'grandTotal'],
    masterMappings: [role, 'item', 'barcode', 'uom', 'tax', 'warehouse', 'branch', 'batch'],
    relationships: extra.relationships || [],
    inventoryImpact: extra.inventory || 'none',
    accountingImpact: extra.accounting || 'none',
    taxImpact: extra.tax || 'none',
    approval: extra.approval || { required: false },
    posting: extra.posting || [],
    duplicateCheck: { fields: ['party', 'docNo'] },
    aiInstructions: `${AI_BASE} Document type: ${name}. Identify the ${role} (name, GSTIN, address), document number & date, any reference PO/DC/invoice numbers, every line item with code, description, HSN, batch, expiry, qty, UOM, rate, discount, tax% and amount, and the totals (sub total, discount, tax, charges, round off, grand total).`,
    ...extra.override,
  };
}
function voucherDoc(code, name, extra = {}) {
  return {
    code, name, category: 'accounting',
    headerFields: [
      { key: 'party', label: 'Party', type: 'master', master: extra.partyMaster || 'account' },
      ...COMMON_HEADER,
      { key: 'paymentMode', label: 'Mode', type: 'string' },
      { key: 'bankAccount', label: 'Bank / Cash A/c', type: 'master', master: 'account' },
      { key: 'instrumentNo', label: 'Cheque / UTR No', type: 'string' },
      { key: 'instrumentDate', label: 'Instrument Date', type: 'date' },
      { key: 'grandTotal', label: 'Amount', type: 'money', required: true },
    ],
    lineFields: VOUCHER_LINES,
    requiredFields: ['docNo', 'docDate', 'grandTotal'],
    masterMappings: ['account', 'costCentre', 'branch', ...(extra.partyMaster ? [extra.partyMaster] : [])],
    relationships: extra.relationships || [],
    inventoryImpact: 'none', accountingImpact: 'ledger', taxImpact: extra.tax || 'none',
    approval: extra.approval || { required: false },
    posting: extra.posting || [],
    duplicateCheck: { fields: ['docNo', 'docDate', 'grandTotal'] },
    aiInstructions: `${AI_BASE} Document type: ${name}. Identify the paying/receiving party, voucher number & date, payment mode, bank or cash account, cheque/UTR number, amount, and each ledger line with account name, narration, debit and credit.`,
  };
}

const TYPES = [
  itemDoc('PO', 'Purchase Order', 'supplier', { category: 'purchase', relationships: [{ creates: 'GRN' }, { creates: 'PI' }], posting: ['Purchase Order (open)'] }),
  itemDoc('SO', 'Sales Order', 'customer', { category: 'sales', relationships: [{ creates: 'DC' }, { creates: 'SI' }], posting: ['Sales Order (open)'] }),
  itemDoc('PI', 'Purchase Invoice', 'supplier', { category: 'purchase', relationships: [{ against: 'PO' }, { against: 'GRN' }], inventory: 'in', accounting: 'supplier-ledger', tax: 'input', posting: ['Supplier Ledger (credit)', 'Inventory Receipt', 'Stock Ledger (+qty, +value)', 'Input Tax (GST) register', 'Accounting voucher (Purchase)'], approval: { required: true, threshold: 100000 } }),
  itemDoc('SI', 'Sales Invoice', 'customer', { category: 'sales', relationships: [{ against: 'SO' }, { against: 'DC' }], inventory: 'out', accounting: 'customer-ledger', tax: 'output', posting: ['Customer Ledger (debit)', 'Stock Out', 'Stock Ledger (−qty)', 'Output Tax (GST) register', 'Accounting voucher (Sales)'] }),
  itemDoc('GRN', 'GRN / Goods Receipt Note', 'supplier', { category: 'purchase', relationships: [{ against: 'PO' }, { creates: 'PI' }], inventory: 'in', posting: ['Inventory Receipt', 'Stock Ledger (+qty)'], override: { requiredFields: ['party', 'docNo', 'docDate'] } }),
  itemDoc('DC', 'Delivery Challan / Delivery Note', 'customer', { category: 'sales', relationships: [{ against: 'SO' }, { creates: 'SI' }, { creates: 'GRN', when: 'inbound' }], inventory: 'out', posting: ['Delivery (stock out) or GRN per configured rule'], override: { requiredFields: ['party', 'docNo', 'docDate'] } }),
  itemDoc('EST', 'Estimate / Quotation', 'customer', { category: 'sales', relationships: [{ creates: 'SO' }], posting: ['Quotation (open)'] }),
  itemDoc('DN', 'Debit Note', 'supplier', { category: 'purchase', relationships: [{ against: 'PI' }], inventory: 'out', accounting: 'supplier-ledger', tax: 'input-reversal', posting: ['Supplier Ledger (debit)', 'Stock Ledger (−qty)', 'Tax reversal', 'Accounting voucher'] }),
  itemDoc('CN', 'Credit Note', 'customer', { category: 'sales', relationships: [{ against: 'SI' }], inventory: 'in', accounting: 'customer-ledger', tax: 'output-reversal', posting: ['Customer Ledger (credit)', 'Stock Ledger (+qty)', 'Tax reversal', 'Accounting voucher'] }),
  voucherDoc('PV', 'Payment Voucher', { partyMaster: 'supplier', relationships: [{ against: 'PI' }], posting: ['Payment entry', 'Supplier Ledger (debit)', 'Bank/Cash Ledger (credit)'] }),
  voucherDoc('RV', 'Receipt Voucher', { partyMaster: 'customer', relationships: [{ against: 'SI' }], posting: ['Receipt entry', 'Customer Ledger (credit)', 'Bank/Cash Ledger (debit)'] }),
  voucherDoc('JV', 'Journal Voucher', { posting: ['Journal entry (Dr = Cr)'] }),
  voucherDoc('EXP', 'Expense Voucher', { tax: 'input', posting: ['Expense Ledger (debit)', 'Bank/Cash Ledger (credit)', 'Input Tax register'] }),
  // ── Extended Financial / GL Vouchers ─────────────────────────────────────────────
  {
    ...voucherDoc('GL', 'General Ledger Posting', { posting: ['Direct GL debit/credit entries'] }),
    aiInstructions: `${AI_BASE} Document type: General Ledger Posting (GL). Identify voucher number, date, narration, and each ledger line with account name, debit amount, credit amount. Debits must equal Credits.`,
  },
  {
    ...voucherDoc('CTV', 'Contra Voucher', { posting: ['Cash/Bank contra: one account Dr, another Cr'] }),
    headerFields: [
      { key: 'fromAccount', label: 'From Account (Cr)', type: 'master', master: 'account', required: true },
      { key: 'toAccount', label: 'To Account (Dr)', type: 'master', master: 'account', required: true },
      { key: 'transferMode', label: 'Transfer Mode', type: 'string' }, // NEFT / RTGS / IMPS / Internal
      { key: 'instrumentNo', label: 'Cheque / UTR No', type: 'string' },
      { key: 'instrumentDate', label: 'Instrument Date', type: 'date' },
      { key: 'grandTotal', label: 'Transfer Amount', type: 'money', required: true },
      ...COMMON_HEADER,
    ],
    requiredFields: ['fromAccount', 'toAccount', 'docDate', 'grandTotal'],
    aiInstructions: `${AI_BASE} Document type: Contra Voucher. Identify source (credit) account and destination (debit) account, transfer mode (NEFT/RTGS/IMPS/Cheque/Internal), cheque or UTR number, amount and date.`,
  },
  {
    ...voucherDoc('PDC', 'Post-Dated Cheque', { partyMaster: 'supplier', posting: ['PDC register — no GL impact until clearing date'] }),
    headerFields: [
      party('supplier'),
      { key: 'chequeNo', label: 'Cheque No', type: 'string', required: true },
      { key: 'chequeDate', label: 'Cheque Date (on cheque)', type: 'date', required: true },
      { key: 'dueDate', label: 'Due / Deposit Date', type: 'date' },
      { key: 'bankName', label: 'Drawee Bank', type: 'string' },
      { key: 'bankBranch', label: 'Bank Branch', type: 'string' },
      { key: 'bankAccount', label: 'Bank A/c', type: 'string' },
      { key: 'grandTotal', label: 'Cheque Amount', type: 'money', required: true },
      ...COMMON_HEADER,
    ],
    requiredFields: ['party', 'chequeNo', 'chequeDate', 'grandTotal'],
    aiInstructions: `${AI_BASE} Document type: Post-Dated Cheque. Identify party (payee/drawer), cheque number, cheque date (on the cheque face), due/deposit date, bank name, branch, account number and amount.`,
  },
  // ── Bank Statement ─────────────────────────────────────────────────────────────
  {
    code: 'BST', name: 'Bank Statement', category: 'banking',
    headerFields: [
      { key: 'bankName', label: 'Bank Name', type: 'string', required: true },
      { key: 'bankBranch', label: 'Branch', type: 'string' },
      { key: 'accountNo', label: 'Account No', type: 'string', required: true },
      { key: 'accountHolder', label: 'Account Holder', type: 'string' },
      { key: 'ifsc', label: 'IFSC Code', type: 'string' },
      { key: 'accountType', label: 'Account Type', type: 'string' }, // Savings / Current / OD / CC
      { key: 'currency', label: 'Currency', type: 'string', default: 'INR' },
      { key: 'docNo', label: 'Statement Ref No', type: 'string' },
      { key: 'docDate', label: 'Statement Date', type: 'date', required: true },
      { key: 'fromDate', label: 'Period From', type: 'date', required: true },
      { key: 'toDate', label: 'Period To', type: 'date', required: true },
      { key: 'openingBalance', label: 'Opening Balance', type: 'money', required: true },
      { key: 'closingBalance', label: 'Closing Balance', type: 'money', required: true },
      { key: 'totalDebits', label: 'Total Debits', type: 'money' },
      { key: 'totalCredits', label: 'Total Credits', type: 'money' },
      { key: 'grandTotal', label: 'Closing Balance (Grand Total)', type: 'money', required: true },
      { key: 'remarks', label: 'Remarks', type: 'string' },
    ],
    lineFields: BANK_STMT_LINES,
    requiredFields: ['bankName', 'accountNo', 'docDate', 'fromDate', 'toDate', 'openingBalance', 'closingBalance'],
    masterMappings: ['account', 'branch'],
    relationships: [],
    inventoryImpact: 'none', accountingImpact: 'bank-reconciliation', taxImpact: 'none',
    approval: { required: false },
    posting: ['Bank Reconciliation — match with GL bank ledger', 'Identify unmatched entries for journal posting'],
    duplicateCheck: { fields: ['accountNo', 'fromDate', 'toDate'] },
    aiInstructions: `${AI_BASE} Document type: Bank Statement. This is a bank account statement (NOT an invoice). Identify: bank name (e.g. HDFC Bank, SBI, ICICI), branch, account number, IFSC code, account holder name, statement period (from/to dates), opening balance, closing balance. For each transaction row extract: date, value date (if different), description/narration, cheque/ref number, transaction type (CR/DR/NEFT/RTGS/UPI/CHQ/INT), debit amount, credit amount, running balance. Bank names to recognise: HDFC Bank, ICICI Bank, State Bank of India / SBI, Axis Bank, Kotak Mahindra Bank, Punjab National Bank / PNB, Bank of Baroda / BOB, Union Bank, Canara Bank, IndusInd Bank, Yes Bank, IDFC First Bank, Federal Bank, South Indian Bank, Indian Overseas Bank, Indian Bank, UCO Bank, Bank of India, Central Bank, City Union Bank, Karur Vysya Bank, Tamilnad Mercantile Bank, Nainital Bank, Dhanlaxmi Bank, CSB Bank, RBL Bank, ESAF Bank.`,
  },
  // ── Bank Reconciliation Statement ─────────────────────────────────────────────
  {
    code: 'BRS', name: 'Bank Reconciliation Statement', category: 'banking',
    headerFields: [
      { key: 'bankName', label: 'Bank Name', type: 'string', required: true },
      { key: 'accountNo', label: 'Account No', type: 'string' },
      { key: 'docNo', label: 'BRS Ref No', type: 'string' },
      { key: 'docDate', label: 'BRS Date', type: 'date', required: true },
      { key: 'asOnDate', label: 'As on Date', type: 'date', required: true },
      { key: 'bookBalance', label: 'Balance as per Books', type: 'money', required: true },
      { key: 'bankBalance', label: 'Balance as per Bank', type: 'money', required: true },
      { key: 'difference', label: 'Difference', type: 'money' },
      { key: 'grandTotal', label: 'Bank Balance (Grand Total)', type: 'money', required: true },
      ...COMMON_HEADER.filter(f => !['docNo', 'docDate'].includes(f.key)),
    ],
    lineFields: [
      { key: 'lineNo', label: '#', type: 'int' },
      { key: 'description', label: 'Item Description', type: 'string', required: true },
      { key: 'refNo', label: 'Chq / Ref No', type: 'string' },
      { key: 'txDate', label: 'Date', type: 'date' },
      { key: 'debit', label: 'Add (Dr)', type: 'money' },
      { key: 'credit', label: 'Less (Cr)', type: 'money' },
    ],
    requiredFields: ['bankName', 'docDate', 'asOnDate', 'bookBalance', 'bankBalance'],
    masterMappings: ['account', 'branch'],
    relationships: [],
    inventoryImpact: 'none', accountingImpact: 'bank-reconciliation', taxImpact: 'none',
    approval: { required: false },
    posting: ['BRS signed-off — unmatched items flagged for journal'],
    duplicateCheck: { fields: ['bankName', 'asOnDate'] },
    aiInstructions: `${AI_BASE} Document type: Bank Reconciliation Statement (BRS). Identify bank name, account number, as-on date, balance as per books, balance as per bank, difference. For each reconciling item: description (e.g. "Cheque issued not presented", "Direct credit not in books"), cheque/ref no, date, and whether it adds to or subtracts from book balance.`,
  },
  // ── TDS Certificate / Challan ─────────────────────────────────────────────────
  {
    code: 'TDS', name: 'TDS Certificate / Challan', category: 'tax',
    headerFields: [
      { key: 'deductorName', label: 'Deductor Name', type: 'string', required: true },
      { key: 'deductorTan', label: 'Deductor TAN', type: 'string', required: true },
      { key: 'deductorPan', label: 'Deductor PAN', type: 'string' },
      { key: 'deductorGstin', label: 'Deductor GSTIN', type: 'string' },
      { key: 'formType', label: 'Form Type', type: 'string' }, // 16 / 16A / 26AS / 27D
      { key: 'docNo', label: 'Certificate / Challan No', type: 'string', required: true },
      { key: 'docDate', label: 'Certificate Date', type: 'date', required: true },
      { key: 'assessmentYear', label: 'Assessment Year', type: 'string' },
      { key: 'financialYear', label: 'Financial Year', type: 'string' },
      { key: 'tdsSection', label: 'TDS Section', type: 'string' }, // 194C / 194H / 194Q etc.
      { key: 'tdsRate', label: 'TDS Rate %', type: 'number' },
      { key: 'grossAmount', label: 'Gross Amount Paid', type: 'money' },
      { key: 'tdsAmount', label: 'TDS Deducted', type: 'money', required: true },
      { key: 'surcharge', label: 'Surcharge', type: 'money' },
      { key: 'educationCess', label: 'Education Cess', type: 'money' },
      { key: 'grandTotal', label: 'Total Tax Deducted', type: 'money', required: true },
      { key: 'bsrCode', label: 'BSR Code', type: 'string' },
      { key: 'challanNo', label: 'Challan No', type: 'string' },
      { key: 'depositDate', label: 'Deposit Date', type: 'date' },
      ...COMMON_HEADER.filter(f => !['docNo', 'docDate'].includes(f.key)),
    ],
    lineFields: TDS_LINES,
    requiredFields: ['deductorName', 'deductorTan', 'docNo', 'docDate', 'tdsAmount'],
    masterMappings: ['account', 'branch'],
    relationships: [],
    inventoryImpact: 'none', accountingImpact: 'tax-ledger', taxImpact: 'tds',
    approval: { required: false },
    posting: ['TDS Payable Ledger', 'Income Tax Expense Ledger', 'Form 26AS reconciliation'],
    duplicateCheck: { fields: ['docNo', 'deductorTan'] },
    aiInstructions: `${AI_BASE} Document type: TDS Certificate or Challan. Identify deductor name, TAN, PAN, form type (16/16A/26AS/27D), certificate number, date, assessment year, financial year, TDS section (194C/194H/194Q/194J etc.), gross amount paid, TDS rate%, TDS deducted, surcharge, education cess, total tax deducted, BSR code, challan serial number, deposit date. For each deductee (if listed): name, PAN, taxable amount, TDS amount.`,
  },
  // ── PT Format / EDI Purchases (from external software, trading partners) ──────
  {
    code: 'PT_PUR', name: 'Purchase — PT/EDI Format', category: 'purchase',
    headerFields: [
      party('supplier'),
      ...partyExtras,
      { key: 'erpSource', label: 'Source ERP / Software', type: 'string' }, // Tally / SAP / QuickBooks / Custom PT
      { key: 'fileFormat', label: 'File Format', type: 'string' }, // XML / JSON / CSV / Excel / EDIFACT
      { key: 'erpDocNo', label: 'ERP Document No', type: 'string' },
      ...COMMON_HEADER,
      ...TOTALS,
    ],
    lineFields: PT_ITEM_LINES,
    requiredFields: ['party', 'docNo', 'docDate', 'grandTotal'],
    masterMappings: ['supplier', 'item', 'barcode', 'uom', 'tax', 'warehouse', 'branch'],
    relationships: [{ creates: 'PI' }, { creates: 'GRN' }],
    inventoryImpact: 'in', accountingImpact: 'supplier-ledger', taxImpact: 'input',
    approval: { required: false },
    posting: ['Convert to Purchase Invoice in RetailCLIQ', 'Stock import via proc_StockImportwithSupplier'],
    duplicateCheck: { fields: ['party', 'docNo'] },
    aiInstructions: `${AI_BASE} Document type: Purchase document received via PT/EDI/electronic format from an external ERP or trading partner (could be Tally XML, SAP IDOC, QuickBooks IIF, CSV/Excel from distributor portal). Identify supplier name, GSTIN, invoice/order number, date, and every line item with ERP code, partner SKU, EAN/GTIN, description, HSN, batch, qty, UOM, rate, discount, GST%, amount. Also extract totals, payment terms, and any electronic reference IDs.`,
  },
  {
    code: 'PT_SAL', name: 'Sales — PT/EDI Format', category: 'sales',
    headerFields: [
      party('customer'),
      ...partyExtras,
      { key: 'erpSource', label: 'Source ERP / Software', type: 'string' },
      { key: 'fileFormat', label: 'File Format', type: 'string' },
      { key: 'erpDocNo', label: 'ERP Document No', type: 'string' },
      ...COMMON_HEADER,
      ...TOTALS,
    ],
    lineFields: PT_ITEM_LINES,
    requiredFields: ['party', 'docNo', 'docDate', 'grandTotal'],
    masterMappings: ['customer', 'item', 'barcode', 'uom', 'tax', 'warehouse', 'branch'],
    relationships: [{ creates: 'SI' }],
    inventoryImpact: 'out', accountingImpact: 'customer-ledger', taxImpact: 'output',
    approval: { required: false },
    posting: ['Convert to Sales Invoice in RetailCLIQ', 'Stock out via sales ledger'],
    duplicateCheck: { fields: ['party', 'docNo'] },
    aiInstructions: `${AI_BASE} Document type: Sales document received via PT/EDI/electronic format (could be retail chain portal order, marketplace export, Tally XML, SAP IDOC). Identify customer name, GSTIN, invoice/order number, date, and every line with ERP code, EAN/GTIN, description, HSN, qty, UOM, rate, discount, GST%, amount. Also extract totals and any portal/order reference IDs.`,
  },
  {
    ...itemDoc('ST', 'Stock Transfer', 'supplier', { category: 'inventory', inventory: 'transfer', posting: ['Source Warehouse Stock Out', 'Destination Warehouse Stock In', 'Transit ledger'] }),
    headerFields: [
      { key: 'fromWarehouse', label: 'From Warehouse', type: 'master', master: 'warehouse', required: true },
      { key: 'toWarehouse', label: 'To Warehouse', type: 'master', master: 'warehouse', required: true },
      ...COMMON_HEADER.filter((f) => f.key !== 'warehouse'), ...TOTALS,
    ],
    requiredFields: ['fromWarehouse', 'toWarehouse', 'docNo', 'docDate'],
    masterMappings: ['item', 'barcode', 'uom', 'warehouse', 'branch', 'batch'],
    duplicateCheck: { fields: ['docNo', 'fromWarehouse'] },
    aiInstructions: `${AI_BASE} Document type: Stock Transfer. Identify source and destination warehouse/branch, transfer number & date, and every item line with code, description, batch, qty, UOM, rate and amount.`,
  },
  {
    ...itemDoc('SA', 'Stock Adjustment', 'supplier', { category: 'inventory', inventory: 'adjust', posting: ['Stock Ledger (±qty)', 'Stock adjustment account'] }),
    headerFields: [{ key: 'reason', label: 'Reason', type: 'string', required: true }, ...COMMON_HEADER, ...TOTALS],
    requiredFields: ['docNo', 'docDate', 'warehouse'],
    masterMappings: ['item', 'barcode', 'uom', 'warehouse', 'branch', 'batch'],
    duplicateCheck: { fields: ['docNo', 'warehouse'] },
    aiInstructions: `${AI_BASE} Document type: Stock Adjustment. Identify warehouse, reason, adjustment number & date and each item with code, description, batch, adjustment qty (negative for shortage), UOM, rate and amount.`,
  },
  {
    code: 'OTHER', name: 'Other / Custom Document', category: 'custom',
    headerFields: [...COMMON_HEADER, ...TOTALS], lineFields: ITEM_LINES, requiredFields: ['docNo'],
    masterMappings: ['item', 'uom'], relationships: [], inventoryImpact: 'none', accountingImpact: 'none', taxImpact: 'none',
    approval: { required: true }, posting: ['Staged for manual processing'], duplicateCheck: { fields: ['docNo'] },
    aiInstructions: `${AI_BASE} Extract whatever header fields and table rows are present.`,
  },
];

const registry = new Map(TYPES.map((t) => [t.code, t]));

function list() { return [...registry.values()]; }
function get(code) { return registry.get(code); }
function upsert(def) {
  if (!def?.code || !def?.name) throw new Error('code and name are required');
  const base = registry.get(def.code) || get('OTHER');
  registry.set(def.code, { ...base, ...def });
  return registry.get(def.code);
}

/** JSON schema handed to Sarvam Doc-AI "extract" and used to coerce LLM output. */
function schemaFor(code) {
  const t = get(code) || get('OTHER');
  const prop = (f) => ({ type: f.type === 'number' || f.type === 'money' || f.type === 'int' ? 'number' : 'string', description: f.label });
  const headerProps = Object.fromEntries(t.headerFields.map((f) => [f.key, prop(f)]));
  const lineProps = Object.fromEntries(t.lineFields.map((f) => [f.key, prop(f)]));
  return {
    type: 'object',
    description: t.aiInstructions,
    properties: {
      documentType: { type: 'string', description: `Document type code. Expected ${t.code}` },
      header: { type: 'object', properties: headerProps },
      lines: { type: 'array', items: { type: 'object', properties: lineProps } },
    },
    required: ['header', 'lines'],
  };
}

module.exports = { list, get, upsert, schemaFor, COMMON_HEADER, TOTALS, ITEM_LINES, VOUCHER_LINES, BANK_STMT_LINES, TDS_LINES, PT_ITEM_LINES };
