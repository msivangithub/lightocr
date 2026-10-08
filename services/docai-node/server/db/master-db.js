/**
 * master-db.js — connection to RC26MASTERDB (the RetailCLIQ tenant registry).
 * Uses a singleton pattern to avoid connection race conditions.
 */
require('dotenv').config();
const sql = require('mssql');

const MASTER_CFG = {
  server:   process.env.MASTER_MSSQL_SERVER  || '120.138.9.33',
  port:     Number(process.env.MASTER_MSSQL_PORT || 58842),
  database: process.env.MASTER_MSSQL_DATABASE || 'RC26MASTERDB',
  user:     process.env.MASTER_MSSQL_USER     || 'sa',
  password: process.env.MASTER_MSSQL_PASSWORD || 'myaccounts_hbs123',
  options: { encrypt: false, trustServerCertificate: true },
  pool:    { max: 5, min: 1, idleTimeoutMillis: 30000 },
  requestTimeout: 60000,
  connectionTimeout: 15000,
};

// Singleton: only one pending connect promise at a time
let _pool = null;
let _connecting = null;

async function getMasterPool() {
  if (_pool) return _pool;
  if (_connecting) return _connecting;

  _connecting = new sql.ConnectionPool(MASTER_CFG)
    .connect()
    .then(pool => {
      _pool = pool;
      _connecting = null;
      console.log('[master-db] Connected to RC26MASTERDB');
      pool.on('error', (err) => {
        console.error('[master-db] Pool error, resetting:', err.message);
        _pool = null;
        _connecting = null;
      });
      return pool;
    })
    .catch(err => {
      _connecting = null;
      throw err;
    });

  return _connecting;
}

/**
 * Execute a parameterised SQL query against RC26MASTERDB.
 * @param {string} query  - SQL string with @param style
 * @param {object} params - key:value named params
 * @returns {Array}       - recordset rows
 */
async function executeMasterQuery(query, params = {}) {
  const pool = await getMasterPool();
  const req = pool.request();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) req.input(k, sql.NVarChar, null);
    else if (typeof v === 'number' && Number.isInteger(v)) req.input(k, sql.Int, v);
    else if (typeof v === 'number') req.input(k, sql.Float, v);
    else req.input(k, sql.NVarChar(500), String(v));
  }
  const result = await req.query(query);
  return result.recordset || [];
}

// Pre-warm on module load (non-blocking)
getMasterPool().catch(e => console.warn('[master-db] Initial connect warning:', e.message));

module.exports = { getMasterPool, executeMasterQuery, sql };
