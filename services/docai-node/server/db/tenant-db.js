/**
 * tenant-db.js — dynamic tenant database resolution.
 *
 * When a user opens the DocAI wizard:
 *   1. The parent ERP/portal passes x-client-id header (or ?clientId= param)
 *   2. This module looks up webapp.ClientMaster in RC26MASTERDB
 *   3. Returns the tenant's actual DB name + connection details
 *   4. A pool is created on-demand and cached per DB name
 *
 * If no clientId is supplied, falls back to the default DB_NAME (RC26erp_dev).
 */
require('dotenv').config();
const sql = require('mssql');
const { executeMasterQuery } = require('./master-db');

// Pool cache: { [dbName]: sql.ConnectionPool }
const POOLS = {};

const BASE_CFG = {
  server:   process.env.DB_SERVER   || '120.138.9.33',
  port:     Number(process.env.DB_PORT || 58842),
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD || 'myaccounts_hbs123',
  options:  { encrypt: false, trustServerCertificate: true },
  pool:     { max: 10 },
  requestTimeout: 60000,
};

/** Cache for clientId → {dbName, clientName, ...} */
const CLIENT_CACHE = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Resolve a clientId to tenant DB info from webapp.ClientMaster.
 * Returns { dbName, clientName, clientId, schemaName, server, user, password }
 */
async function resolveTenant(clientId) {
  if (!clientId) return { dbName: process.env.DB_NAME || 'RC26erp_dev', clientName: 'default', clientId: null, resolved: false };

  // Check cache
  const cached = CLIENT_CACHE[clientId];
  if (cached && Date.now() - cached._ts < CACHE_TTL_MS) return cached;

  try {
    const rows = await executeMasterQuery(
      `SELECT TOP 1
         ClientId, ClientName, EmailId,
         SQLDBName    AS dbName,
         tenant_db_name AS tenantDb,
         SQLSchemaName  AS schemaName,
         OnPremSQLDB, CloudSQLDB,
         provisioning_status,
         SQLServerId, SQLUserName, SQLPassword
       FROM webapp.ClientMaster
       WHERE (ClientId=@id OR EmailId=@id) AND (Status='ACTIVE' OR Status='A')
       ORDER BY ClientId`,
      { id: clientId }
    );

    console.log(`[tenant-db] Query for ${clientId}: ${rows.length} rows found`);

    if (!rows.length) {
      console.warn(`[tenant-db] clientId not found: ${clientId} — using default DB`);
      return { dbName: process.env.DB_NAME || 'RC26erp_dev', clientName: clientId, clientId, resolved: false };
    }

    const row = rows[0];
    const dbName = row.tenantDb || row.dbName || process.env.DB_NAME || 'RC26erp_dev';
    const result = {
      clientId:  row.ClientId,
      clientName: row.ClientName,
      emailId:   row.EmailId,
      dbName,
      schemaName: row.schemaName || 'dbo',
      status:    row.provisioning_status,
      server:    BASE_CFG.server,
      user:      BASE_CFG.user,
      password:  BASE_CFG.password,
      resolved:  true,
      _ts:       Date.now(),
    };
    CLIENT_CACHE[clientId] = result;
    console.log(`[tenant-db] Resolved ${clientId} → ${dbName}`);
    return result;
  } catch (e) {
    console.error(`[tenant-db] Lookup FAILED for ${clientId}: ${e.message}`);
    return { dbName: process.env.DB_NAME || 'RC26erp_dev', clientName: clientId, clientId, resolved: false };
  }
}

/**
 * Get or create a MSSQL connection pool for a given database.
 * Uses a pending-promise pattern to avoid race conditions.
 */
const POOL_PENDING = {};
async function getPoolForDb(dbName) {
  if (POOLS[dbName]) return POOLS[dbName];
  if (POOL_PENDING[dbName]) return POOL_PENDING[dbName];

  const cfg = { ...BASE_CFG, database: dbName };
  POOL_PENDING[dbName] = new sql.ConnectionPool(cfg)
    .connect()
    .then(pool => {
      POOLS[dbName] = pool;
      delete POOL_PENDING[dbName];
      console.log(`[tenant-db] Pool created for DB: ${dbName}`);
      pool.on('error', (err) => {
        console.error(`[tenant-db] Pool error for ${dbName}:`, err.message);
        delete POOLS[dbName];
      });
      return pool;
    })
    .catch(err => {
      delete POOL_PENDING[dbName];
      throw err;
    });

  return POOL_PENDING[dbName];
}

/**
 * Get the tenant DB name from an Express request.
 * Priority: x-client-id header → ?clientId query → DOCAI_CLIENT_ID env → default
 */
function getTenantClientId(req) {
  return (
    req.headers['x-client-id'] ||
    req.query?.clientId ||
    req.query?.client_id ||
    process.env.DOCAI_CLIENT_ID ||
    null
  );
}

/**
 * Express middleware: attaches req.tenantDb and req.tenantPool to every request.
 * Non-blocking: falls back to default DB on any error.
 */
async function tenantMiddleware(req, res, next) {
  try {
    const clientId = getTenantClientId(req);
    const tenant = await resolveTenant(clientId);
    req.tenantDb   = tenant.dbName;
    req.tenantInfo = tenant;
    req.getPool    = () => getPoolForDb(tenant.dbName);
  } catch (e) {
    req.tenantDb   = process.env.DB_NAME || 'RC26erp_dev';
    req.tenantInfo = { dbName: req.tenantDb, resolved: false };
    req.getPool    = () => getPoolForDb(req.tenantDb);
  }
  next();
}

module.exports = { resolveTenant, getPoolForDb, getTenantClientId, tenantMiddleware, sql };
