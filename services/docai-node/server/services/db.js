/**
 * MSSQL access for RetailCLIQ masters + DocAI batch/audit tables.
 * When DB_DISABLED=1 (or connection fails) the module falls back to an in-memory
 * master set so the wizard UI stays fully usable for development/demos.
 *
 * TENANT-AWARE: Uses dynamic DB pool via getPoolForDb() from tenant-db.js.
 * Default DB: process.env.DB_NAME (RC26erp_dev) — overridden per-request via x-client-id.
 *
 * Dates: RetailCLIQ stores dates as HBS integers → use dbo.englishHBS(@date) when posting
 * and dbo.ConvertHBSDate when reading. Helpers below mirror that formula in JS.
 */
const DISABLED = process.env.DB_DISABLED === '1' || process.env.DOCAI_MOCK === '1';
let sql = null, pool = null, ready = false;
const { getPoolForDb } = require('../db/tenant-db');

/** Get the active pool for a given request (tenant-aware) or the default pool. */
async function getActivePool(dbOverride) {
  const dbName = dbOverride || process.env.DB_NAME || 'RC26erp_dev';
  try {
    return await getPoolForDb(dbName);
  } catch {
    return pool; // fallback to default pool
  }
}

/* ---- HBS date helpers (same formula as dbo.englishHBS) ---- */
function toHBS(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return (y - 1950) * 416 + m * 32 + d;
}
function fromHBS(h) {
  if (h == null) return null;
  const y = Math.floor(h / 416) + 1950; const rem = h % 416; const m = Math.floor(rem / 32); const d = rem % 32;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ---- In-memory masters (fallback / mock) ---- */
const MEM = {
  supplier: [
    { code: 'SUP001', name: 'Sri Lakshmi Traders', gstin: '36AABCS1234F1Z5', city: 'Hyderabad' },
    { code: 'SUP002', name: 'Bharat Pharma Distributors', gstin: '36AAACB5678K1Z2', city: 'Secunderabad' },
    { code: 'SUP003', name: 'Fresh Farm Produce Co', gstin: '37AAFFP9012L1Z9', city: 'Ongole' },
  ],
  customer: [
    { code: 'CUS001', name: 'Metro Mart Retail', gstin: '36AAACM3456P1Z1', city: 'Hyderabad' },
    { code: 'CUS002', name: 'City Medicals', gstin: '36ABCDE1234F1Z8', city: 'Kukatpally' },
  ],
  item: [ // shape mirrors view Itemproperties (classification + pricing)
    { code: '1127000143', artCode: 'A0000143', name: 'Printed Shirt', barcode: '127000143', oemCode: '1000', uom: 'PCS', hsn: '62031990', taxPct: 5, outputTax: 5, rate: 150, mrp: 799, wsp: 0, division: 'Textiles', dept: 'Mens', category: 'Shirts', subcatg: 'Casual', brand: 'MyAccounts', style: 'MA-PS', design: 'Printed', size: 'L', color: 'Blue' },
    { code: '1127000144', artCode: 'A0000144', name: 'Solid Shirt', barcode: '127000144', oemCode: '1001', uom: 'PCS', hsn: '62031990', taxPct: 5, outputTax: 5, rate: 150, mrp: 799, wsp: 0, division: 'Textiles', dept: 'Mens', category: 'Shirts', subcatg: 'Formal', brand: 'MyAccounts', style: 'MA-SS', design: 'Solid', size: 'M', color: 'White' },
    { code: '1127000206', artCode: 'A0000206', name: 'Printed Saree', barcode: '127000206', oemCode: '2000', uom: 'PCS', hsn: '54075490', taxPct: 5, outputTax: 5, rate: 520, mrp: 999, wsp: 0, division: 'Textiles', dept: 'Womens', category: 'Sarees', subcatg: 'Synthetic Sarees', brand: 'Agarwal', style: 'C-CR-534', design: 'Printed', size: '-', color: 'Multi' },
    { code: 'ITM0001', name: 'Basmati Rice 5kg', barcode: '8901234000011', uom: 'PCS', hsn: '1006', taxPct: 5, rate: 420, mrp: 480, division: 'Grocery', dept: 'Staples', category: 'Grains', subcatg: 'Rice' },
    { code: 'ITM0002', name: 'Sunflower Oil 1L', barcode: '8901234000028', uom: 'PCS', hsn: '1512', taxPct: 5, rate: 145, mrp: 165, division: 'Grocery', dept: 'Staples', category: 'Edible Oils', subcatg: 'Oils' },
    { code: 'ITM0003', name: 'Paracetamol 500mg 10s', barcode: '8901234000035', uom: 'STRIP', hsn: '3004', taxPct: 12, rate: 18, mrp: 25, division: 'Pharma', dept: 'Medicines', category: 'Tablets', subcatg: 'Analgesic' },
    { code: 'ITM0004', name: 'Toor Dal 1kg', barcode: '8901234000042', uom: 'PCS', hsn: '0713', taxPct: 0, rate: 160, mrp: 180, division: 'Grocery', dept: 'Staples', category: 'Pulses', subcatg: 'Dal' },
    { code: 'ITM0005', name: 'Tomato (Loose)', barcode: '2000000000050', uom: 'KG', hsn: '0702', taxPct: 0, rate: 32, mrp: 40, division: 'Grocery', dept: 'Fresh', category: 'Vegetables', subcatg: 'Loose' },
  ],
  uom: [{ code: 'PCS', name: 'Pieces' }, { code: 'KG', name: 'Kilogram' }, { code: 'STRIP', name: 'Strip' }, { code: 'BOX', name: 'Box' }, { code: 'LTR', name: 'Litre' }, { code: 'NOS', name: 'Numbers' }],
  tax: [{ code: 'GST0', name: 'GST 0%', pct: 0 }, { code: 'GST5', name: 'GST 5%', pct: 5 }, { code: 'GST12', name: 'GST 12%', pct: 12 }, { code: 'GST18', name: 'GST 18%', pct: 18 }, { code: 'GST28', name: 'GST 28%', pct: 28 }],
  warehouse: [{ code: 'WH01', name: 'Main Warehouse' }, { code: 'WH02', name: 'Cold Storage' }, { code: 'ST01', name: 'Store Floor' }],
  branch: [{ code: 'HYD', name: 'Hyderabad HO' }, { code: 'ONG', name: 'Ongole Branch' }],
  account: [{ code: 'AC1001', name: 'Cash in Hand' }, { code: 'AC1002', name: 'HDFC Bank 4521' }, { code: 'AC2001', name: 'Purchases' }, { code: 'AC2002', name: 'Sales' }, { code: 'AC3001', name: 'Rent Expense' }, { code: 'AC3002', name: 'Electricity' }, { code: 'AC4001', name: 'GST Input' }, { code: 'AC4002', name: 'GST Output' }],
  costCentre: [{ code: 'CC01', name: 'Retail' }, { code: 'CC02', name: 'Pharma' }],
  batch: [], barcode: [],
};
MEM.barcode = MEM.item.map((i) => ({ code: i.barcode, name: i.name, itemCode: i.code }));

/* ---- Master queries (RetailCLIQ RC26erp_dev schema) ---- */
const MASTER_SQL = {
  supplier: "SELECT TOP 500 Vend_uid AS code, Vend_name AS name, Desc1 AS gstin, Desc2 AS city FROM VendorMaster WHERE Vend_name LIKE @q OR Vend_uid LIKE @q OR Desc1 LIKE @q",
  customer: "SELECT TOP 500 CustID AS code, CustomerName AS name, GSTNo AS gstin, '' AS city FROM CustomerMaster WHERE CustomerName LIKE @q OR CustID LIKE @q OR GSTNo LIKE @q",
  item: `SELECT TOP 500 Itemcode AS code, OEM_code AS artCode, ItemDesc AS name, OEM_code AS barcode, OEM_code AS oemCode, 
                 'PCS' AS uom, HSNCode AS hsn, 5 AS taxPct, 5 AS outputTax, 0 AS rate, 0 AS mrp, 0 AS wsp,
                 'Textiles' AS division, 'General' AS dept, 'General' AS category, 'General' AS subcatg, 
                 '' AS brand, '' AS style, '' AS design, '' AS size, '' AS color
          FROM ItemMaster WHERE ItemDesc LIKE @q OR Itemcode LIKE @q OR OEM_code LIKE @q`,
  barcode: "SELECT TOP 500 OEM_code AS code, ItemDesc AS name, Itemcode AS itemCode FROM ItemMaster WHERE OEM_code LIKE @q OR Itemcode LIKE @q",
  uom: "SELECT TOP 200 UOmId AS code, UomName AS name FROM UOMMaster WHERE UomName LIKE @q OR UOmId LIKE @q",
  tax: "SELECT TOP 50 UOmId AS code, UomName AS name, 5 AS pct FROM UOMMaster WHERE 1=0 UNION SELECT 'GST0' AS code, 'GST 0%' AS name, 0 AS pct UNION SELECT 'GST5', 'GST 5%', 5 UNION SELECT 'GST12', 'GST 12%', 12 UNION SELECT 'GST18', 'GST 18%', 18 UNION SELECT 'GST28', 'GST 28%', 28",
  warehouse: "SELECT TOP 200 unit AS code, name AS name FROM Warehouse WHERE name LIKE @q OR unit LIKE @q",
  branch: "SELECT TOP 100 Branchid AS code, BranchName AS name FROM BranchMaster WHERE BranchName LIKE @q OR Branchid LIKE @q",
  account: "SELECT TOP 200 Vend_uid AS code, Vend_name AS name FROM VendorMaster WHERE Vend_name LIKE @q UNION SELECT CustID, CustomerName FROM CustomerMaster WHERE CustomerName LIKE @q",
  costCentre: "SELECT TOP 50 unit AS code, name AS name FROM Warehouse WHERE 1=0",
  batch: "SELECT TOP 50 '' AS code, '' AS name, '' AS itemCode, '' AS expiry FROM ItemMaster WHERE 1=0",
};

async function init() {
  if (DISABLED) { console.log('[db] disabled – using in-memory masters'); return false; }
  try {
    sql = require('mssql');
    // Initialize the default pool
    pool = await getPoolForDb(process.env.DB_NAME || 'RC26erp_dev');
    ready = true; console.log(`[db] connected to ${process.env.DB_SERVER}/${process.env.DB_NAME}`);
    return true;
  } catch (e) { console.warn('[db] connection failed, using in-memory masters:', e.message); ready = false; return false; }
}

async function searchMaster(master, q = '', limit = 50, tenantDb) {
  const needle = String(q || '').toLowerCase();
  if (!ready || !MASTER_SQL[master]) {
    const rows = MEM[master] || [];
    return rows.filter((r) => !needle || Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(needle))).slice(0, limit);
  }
  try {
    const activePool = await getActivePool(tenantDb);
    sql = require('mssql');
    const r = await activePool.request().input('q', sql.NVarChar, `%${q}%`).query(MASTER_SQL[master]);
    return r.recordset.slice(0, limit);
  } catch (e) {
    // Fallback to in-memory on tenant DB failure
    console.warn(`[db] searchMaster (${tenantDb || 'default'}): ${e.message}`);
    const rows = MEM[master] || [];
    return rows.filter((r) => !needle || Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(needle))).slice(0, limit);
  }
}
async function allMasters(master, tenantDb) { return searchMaster(master, '', 5000, tenantDb); }
async function createMaster(master, data, tenantDb) {
  const row = { code: data.code || `${master.slice(0, 3).toUpperCase()}${Date.now().toString().slice(-6)}`, ...data, _created: true };
  if (!ready) { (MEM[master] = MEM[master] || []).push(row); return row; }
  // Real inserts should call the RetailCLIQ master procs; wire them here, e.g.:
  // await pool.request().input('name', sql.NVarChar, data.name).execute('proc_InsertSupplierQuick');
  (MEM[master] = MEM[master] || []).push(row); // keep in-memory copy so this session can map immediately
  return row;
}

/** Duplicate check against posted documents. */
async function findDuplicate(docTypeCode, header) {
  if (!ready) return STORE.posted.find((p) => p.docType === docTypeCode && p.header.docNo === header.docNo && p.header.party === header.party) || null;
  try {
    const r = await pool.request().input('t', sql.NVarChar, docTypeCode).input('n', sql.NVarChar, header.docNo || '').input('p', sql.NVarChar, header.party || '')
      .query('SELECT TOP 1 BatchId, CreatedDocNo FROM DocAI_Batch WHERE DocType=@t AND SourceDocNo=@n AND PartyCode=@p AND Status=\'posted\'');
    return r.recordset[0] || null;
  } catch { return null; }
}

/* ---- Batch / audit store (DB table DocAI_Batch + in-memory mirror) ---- */
const STORE = { batches: new Map(), posted: [], corrections: [] };

async function saveBatch(batch) {
  STORE.batches.set(batch.id, batch);
  if (!ready) return batch;
  try {
    // Use NVarChar(50) for BatchId since table uses NVARCHAR(50) not UNIQUEIDENTIFIER
    const payload = JSON.stringify(batch);
    await pool.request()
      .input('id', sql.NVarChar(50), batch.id)
      .input('t', sql.NVarChar(20), (batch.docType || '').slice(0, 20))
      .input('st', sql.NVarChar(30), (batch.status || 'draft').slice(0, 30))
      .input('src', sql.NVarChar(20), (batch.source?.kind || '').slice(0, 20))
      .input('file', sql.NVarChar(400), (batch.source?.fileName || '').slice(0, 400))
      .input('n', sql.NVarChar(100), (batch.header?.docNo || '').slice(0, 100))
      .input('p', sql.NVarChar(50), (batch.header?.party || '').slice(0, 50))
      .input('json', sql.NVarChar(sql.MAX), payload)
      .input('u', sql.NVarChar(50), (batch.user || 'system').slice(0, 50))
      .input('tdb', sql.NVarChar(100), (batch.tenantDb || process.env.DB_NAME || 'RC26erp_dev').slice(0, 100))
      .input('cid', sql.NVarChar(50), (batch.clientId || '').slice(0, 50))
      .query(`MERGE DocAI_Batch AS T USING (SELECT @id AS BatchId) AS S ON T.BatchId=S.BatchId
              WHEN MATCHED THEN UPDATE SET DocType=@t, Status=@st, SourceDocNo=@n, PartyCode=@p, Payload=@json, UpdatedAt=GETDATE(), UpdatedBy=@u, TenantDb=@tdb, ClientId=@cid
              WHEN NOT MATCHED THEN INSERT (BatchId, DocType, Status, SourceKind, SourceFile, SourceDocNo, PartyCode, Payload, CreatedBy, UpdatedBy, TenantDb, ClientId)
              VALUES (@id,@t,@st,@src,@file,@n,@p,@json,@u,@u,@tdb,@cid);`);
  } catch (e) { console.warn('[db] saveBatch failed (kept in memory):', e.message); }
  return batch;
}

async function getBatch(id) {
  // Try in-memory first (fast path)
  if (STORE.batches.has(id)) return STORE.batches.get(id);
  // Fall back to MSSQL (handles server restarts)
  if (!ready) return null;
  try {
    const r = await pool.request().input('id', sql.NVarChar(50), id).query('SELECT TOP 1 Payload FROM DocAI_Batch WHERE BatchId=@id');
    if (r.recordset[0]?.Payload) {
      const batch = JSON.parse(r.recordset[0].Payload);
      STORE.batches.set(id, batch); // warm cache
      return batch;
    }
  } catch (e) { console.warn('[db] getBatch from SQL failed:', e.message); }
  return null;
}

async function listBatches() {
  if (ready) {
    try {
      const r = await pool.request().query(`SELECT TOP 200 BatchId AS id, DocType AS docType, Status AS status, SourceFile AS fileName, SourceDocNo AS docNo, PartyCode AS party, CreatedAt AS createdAt FROM DocAI_Batch ORDER BY CreatedAt DESC`);
      return r.recordset.map(b => ({ id: b.id, docType: b.docType, status: b.status, step: null, fileName: b.fileName, docNo: b.docNo, party: b.party, grandTotal: null, createdAt: b.createdAt ? b.createdAt.toISOString() : null, result: null }));
    } catch (e) { console.warn('[db] listBatches from SQL failed:', e.message); }
  }
  return [...STORE.batches.values()].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).map((b) => ({ id: b.id, docType: b.docType, status: b.status, step: b.step, fileName: b.source?.fileName, docNo: b.header?.docNo, party: b.header?.partyName, grandTotal: b.header?.grandTotal, createdAt: b.createdAt, result: b.result }));
}

/**
 * Posting hook. In production call the RetailCLIQ posting procedures inside ONE transaction,
 * e.g. proc_PostPurchaseInvoice, proc_StockImportwithSupplier, etc. The call below is the contract.
 */
async function postDocument(batch, plan) {
  const docNo = `${batch.docType}-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const record = { batchId: batch.id, docType: batch.docType, header: batch.header, lines: batch.lines, createdDocNo: docNo, postedAt: new Date().toISOString() };
  if (ready) {
    try {
      await pool.request()
        .input('b', sql.NVarChar(50), batch.id)
        .input('t', sql.NVarChar(20), (batch.docType || '').slice(0, 20))
        .input('h', sql.NVarChar(sql.MAX), JSON.stringify({ ...batch.header, docDateHBS: toHBS(batch.header.docDate) }))
        .input('l', sql.NVarChar(sql.MAX), JSON.stringify(batch.lines))
        .input('u', sql.NVarChar(50), (batch.user || 'system').slice(0, 50))
        .query('INSERT INTO DocAI_Staging (BatchId, DocType, HeaderJson, LinesJson, CreatedBy) VALUES (@b,@t,@h,@l,@u)');
      // Update batch status in DocAI_Batch
      await pool.request()
        .input('id', sql.NVarChar(50), batch.id)
        .input('dn', sql.NVarChar(50), docNo)
        .query("UPDATE DocAI_Batch SET Status='posted', CreatedDocNo=@dn, UpdatedAt=GETDATE() WHERE BatchId=@id");
    } catch (e) { console.warn('[db] postDocument staging failed (continuing in-memory):', e.message); }
  }
  STORE.posted.push(record);
  return record;
}

module.exports = { init, isReady: () => ready, searchMaster, allMasters, createMaster, findDuplicate, saveBatch, getBatch, listBatches, postDocument, toHBS, fromHBS, MEM, STORE };
