/**
 * dashboard.js — DocAI stats + Sarvam balance + email config API
 * Routes:
 *   GET  /api/docai/dashboard/stats     — batch counts, type breakdown, daily chart
 *   GET  /api/docai/dashboard/sarvam-balance  — Sarvam credits remaining
 *   GET  /api/docai/dashboard/email-config    — get email notification settings
 *   POST /api/docai/dashboard/email-config    — update email notification settings
 *   POST /api/docai/dashboard/send-digest     — manually trigger daily digest email
 */
const express = require('express');
const fetch   = require('node-fetch');
const nodemailer = require('nodemailer');
const db = require('../services/db');
const router = express.Router();

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error('[dashboard]', e.message);
  res.status(e.status || 500).json({ error: e.message });
});

// ─── IST timestamp helper ─────────────────────────────────────────────────
function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ─── Email config (in-memory, can be persisted to DB later) ──────────────
let EMAIL_CONFIG = {
  recipients: (process.env.DIGEST_EMAIL || 'msivan@myaccounts.in').split(',').map(e => e.trim()).filter(Boolean),
  enabled:    process.env.DIGEST_EMAIL_ENABLED !== 'false',
  time:       '09:00',  // IST time for daily digest
  subject:    'RetailCLIQ DocAI — Daily Scan Report ({date})',
};

// ─── SMTP transporter ────────────────────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST  || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: process.env.SMTP_PASS || process.env.EMAIL_PASSWORD,
    },
  });
}

// ─── Build stats from DocAI_Batch (MSSQL) + in-memory STORE ─────────────
async function buildStats(tenantDb) {
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  const weekAgo  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // Base stats from in-memory STORE (always available)
  const batches = [...db.STORE.batches.values()];
  const posted  = db.STORE.posted;

  const inMemStats = {
    total:        batches.length,
    today:        batches.filter(b => b.createdAt?.slice(0, 10) === todayIST).length,
    thisWeek:     batches.filter(b => b.createdAt?.slice(0, 10) >= weekAgo).length,
    thisMonth:    batches.filter(b => b.createdAt?.slice(0, 10) >= monthAgo).length,
    posted:       posted.length,
    byStatus:     {},
    byType:       {},
    recentDays:   [],
  };

  batches.forEach(b => {
    inMemStats.byStatus[b.status] = (inMemStats.byStatus[b.status] || 0) + 1;
    if (b.docType) inMemStats.byType[b.docType] = (inMemStats.byType[b.docType] || 0) + 1;
  });

  // Try MSSQL for persistent stats
  if (db.isReady()) {
    try {
      const { getPoolForDb } = require('../db/tenant-db');
      const sql = require('mssql');
      const pool = await getPoolForDb(process.env.DB_NAME || 'RC26erp_dev');

      // Overall counts
      const counts = await pool.request().query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN CAST(CONVERT(datetime, CreatedAt) AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS today,
          SUM(CASE WHEN CreatedAt >= DATEADD(DAY,-7,GETDATE()) THEN 1 ELSE 0 END) AS thisWeek,
          SUM(CASE WHEN CreatedAt >= DATEADD(DAY,-30,GETDATE()) THEN 1 ELSE 0 END) AS thisMonth,
          SUM(CASE WHEN Status='posted' THEN 1 ELSE 0 END) AS posted,
          SUM(CASE WHEN Status='draft' THEN 1 ELSE 0 END) AS drafts,
          SUM(CASE WHEN Status='pending-approval' THEN 1 ELSE 0 END) AS pendingApproval
        FROM DocAI_Batch`);

      // By document type
      const byType = await pool.request().query(`
        SELECT DocType, COUNT(*) AS cnt
        FROM DocAI_Batch
        WHERE DocType IS NOT NULL AND DocType <> ''
        GROUP BY DocType ORDER BY cnt DESC`);

      // Last 7 days chart
      const daily = await pool.request().query(`
        SELECT CAST(CreatedAt AS DATE) AS d, COUNT(*) AS cnt
        FROM DocAI_Batch
        WHERE CreatedAt >= DATEADD(DAY,-6,GETDATE())
        GROUP BY CAST(CreatedAt AS DATE)
        ORDER BY d`);

      const row = counts.recordset[0] || {};
      const typeBreakdown = {};
      (byType.recordset || []).forEach(r => { typeBreakdown[r.DocType] = r.cnt; });
      const dailyChart = (daily.recordset || []).map(r => ({
        date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
        count: r.cnt,
      }));

      return {
        source: 'mssql',
        total:         row.total  || 0,
        today:         row.today  || 0,
        thisWeek:      row.thisWeek || 0,
        thisMonth:     row.thisMonth || 0,
        posted:        row.posted || 0,
        drafts:        row.drafts || 0,
        pendingApproval: row.pendingApproval || 0,
        byType:        typeBreakdown,
        recentDays:    dailyChart,
        generatedAt:   nowIST(),
      };
    } catch (e) {
      console.warn('[dashboard] MSSQL stats fallback to in-memory:', e.message);
    }
  }

  return { source: 'memory', ...inMemStats, generatedAt: nowIST() };
}

// ─── Sarvam balance check ─────────────────────────────────────────────────
async function getSarvamBalance() {
  const KEY = process.env.SARVAM_API_KEY || '';
  const BASE = (process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai').replace(/\/$/, '');
  if (!KEY) return { error: 'SARVAM_API_KEY not set', credits: null };

  try {
    // Try /v1/account/credits endpoint
    const r = await fetch(`${BASE}/v1/account/credits`, {
      headers: { 'api-subscription-key': KEY },
      timeout: 15000,
    });
    if (r.ok) {
      const data = await r.json();
      return { credits: data.credits_remaining ?? data.credits ?? data.balance ?? null, raw: data, source: 'api' };
    }
    // Try alternate endpoint
    const r2 = await fetch(`${BASE}/v1/me`, {
      headers: { 'api-subscription-key': KEY },
      timeout: 15000,
    });
    if (r2.ok) {
      const d2 = await r2.json();
      return { credits: d2.credits_remaining ?? d2.credits ?? null, raw: d2, source: 'me' };
    }
    return { credits: null, note: `Sarvam balance API returned ${r.status} — check Sarvam dashboard`, keyStatus: 'active' };
  } catch (e) {
    return { credits: null, error: e.message, keyStatus: 'unknown' };
  }
}

// ─── Build daily digest HTML email ───────────────────────────────────────
async function buildDigestEmail(stats, balance) {
  const dateStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const typeRows = Object.entries(stats.byType || {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${type}</td><td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right"><b>${count}</b></td></tr>`)
    .join('');

  const balanceHtml = balance.credits != null
    ? `<p style="margin:4px 0">💳 <b>Sarvam Credits Remaining:</b> ${balance.credits}</p>`
    : `<p style="margin:4px 0">💳 Sarvam credit balance: <i>check dashboard for details</i></p>`;

  return {
    subject: EMAIL_CONFIG.subject.replace('{date}', dateStr),
    html: `
      <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#f4f6fa;padding:20px">
        <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h2 style="margin:0 0 4px;color:#0f5fd6">RetailCLIQ · AI Document Wizard</h2>
          <p style="margin:0 0 20px;color:#6b7280">Daily Scan Report — ${dateStr}</p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
            ${[
              ['📄', 'Today', stats.today, '#e0f2fe', '#0369a1'],
              ['📅', 'This Week', stats.thisWeek, '#e0e7ff', '#4338ca'],
              ['📆', 'This Month', stats.thisMonth, '#dcfce7', '#15803d'],
              ['✅', 'Posted', stats.posted, '#fef9c3', '#b45309'],
            ].map(([icon, label, val, bg, color]) =>
              `<div style="background:${bg};border-radius:8px;padding:12px">
                 <p style="margin:0;font-size:22px">${icon}</p>
                 <p style="margin:2px 0;font-size:24px;font-weight:700;color:${color}">${val}</p>
                 <p style="margin:0;font-size:12px;color:#6b7280">${label}</p>
               </div>`
            ).join('')}
          </div>

          ${typeRows ? `<h3 style="margin:0 0 8px;font-size:14px">Documents by Type</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f3f4f6"><th style="padding:4px 8px;text-align:left">Type</th><th style="padding:4px 8px;text-align:right">Count</th></tr></thead>
            <tbody>${typeRows}</tbody>
          </table><br>` : ''}

          <div style="background:#f0fdf4;border-radius:8px;padding:12px;margin-top:8px">
            ${balanceHtml}
            <p style="margin:4px 0;font-size:12px;color:#6b7280">Generated at ${nowIST()} IST</p>
          </div>

          <p style="margin-top:16px;font-size:12px;color:#9ca3af">
            To change email recipients, visit the DocAI Dashboard → Email Settings.<br>
            RetailCLIQ DocAI Wizard · Powered by Sarvam AI
          </p>
        </div>
      </div>`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────

/** GET /dashboard/stats */
router.get('/stats', wrap(async (req, res) => {
  const stats = await buildStats(req.tenantDb);
  res.json(stats);
}));

/** GET /dashboard/sarvam-balance */
router.get('/sarvam-balance', wrap(async (req, res) => {
  const balance = await getSarvamBalance();
  res.json(balance);
}));

/** GET /dashboard/email-config */
router.get('/email-config', (req, res) => {
  res.json({ ...EMAIL_CONFIG, smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com', smtpUser: process.env.SMTP_USER || '' });
});

/** POST /dashboard/email-config */
router.post('/email-config', (req, res) => {
  const { recipients, enabled, subject } = req.body;
  if (recipients) EMAIL_CONFIG.recipients = Array.isArray(recipients) ? recipients : recipients.split(',').map(e => e.trim()).filter(Boolean);
  if (enabled !== undefined) EMAIL_CONFIG.enabled = !!enabled;
  if (subject) EMAIL_CONFIG.subject = subject;
  res.json({ success: true, config: EMAIL_CONFIG });
});

/** POST /dashboard/send-digest — manual trigger or cron trigger */
router.post('/send-digest', wrap(async (req, res) => {
  // Ack immediately for cron; run email in background
  res.json({ accepted: true, message: 'Digest email queued' });

  setImmediate(async () => {
    try {
      const [stats, balance] = await Promise.all([buildStats(), getSarvamBalance()]);

      // Skip if no documents scanned today (unless force)
      if (stats.today === 0 && !req.body?.force) {
        console.log('[digest] No documents scanned today — skipping email');
        return;
      }

      const { subject, html } = await buildDigestEmail(stats, balance);
      const transporter = getTransporter();
      const to = EMAIL_CONFIG.recipients.join(', ');

      await transporter.sendMail({
        from: `"RetailCLIQ DocAI" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
        to,
        subject,
        html,
      });

      console.log(`[digest] Daily report sent to ${to} — today: ${stats.today} docs`);
    } catch (e) {
      console.error('[digest] Email failed:', e.message);
    }
  });
}));

module.exports = router;
