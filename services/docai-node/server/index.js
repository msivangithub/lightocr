require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./services/db');
const { tenantMiddleware } = require('./db/tenant-db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ── Tenant middleware: reads x-client-id / ?clientId and resolves tenant DB ──
app.use(tenantMiddleware);

// ── i18n / Globalization routes (RC26MASTERDB.WebApp) ──
const i18nModule = require('./routes/i18n');
const i18nRouter = i18nModule.default || i18nModule;
const { ensureI18nTables } = i18nModule;
app.use('/api/i18n', i18nRouter);

// ── Dashboard stats + email + Sarvam balance ──
app.use('/api/docai/dashboard', require('./routes/dashboard'));

// ── DocAI wizard routes ──
app.use('/api/docai/intake', require('./routes/intake'));
app.use('/api/docai', require('./routes/docai'));

// ── Tenant resolution API ──
app.get('/api/docai/tenant/resolve', async (req, res) => {
  try {
    res.json({
      ok: true,
      tenantDb:  req.tenantDb,
      clientId:  req.tenantInfo?.clientId || null,
      clientName: req.tenantInfo?.clientName || 'default',
      resolved:  req.tenantInfo?.resolved || false,
      timezone:  'Asia/Kolkata',
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Static UI (serve the built React app or the legacy HTML) ──
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = Number(process.env.PORT || 4010);

db.init()
  .then(() => ensureI18nTables().catch(e => console.warn('[startup] i18n table bootstrap warning:', e.message)))
  .finally(() => app.listen(PORT, () => {
    console.log(`RetailCLIQ DocAI wizard → http://localhost:${PORT}  (mock=${process.env.DOCAI_MOCK === '1'}, sarvam=${process.env.SARVAM_API_KEY ? 'key set' : 'NO KEY'})`);
  }));
