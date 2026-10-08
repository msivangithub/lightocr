import React, { useState, useEffect, useCallback } from 'react';
import { API } from './api';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

const money = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const IST_OPTS = { timeZone: 'Asia/Kolkata' };
const fmtIST = (d) => { try { return new Date(d).toLocaleString('en-IN', IST_OPTS); } catch { return String(d); } };

const DOC_LABELS = {
  PI: 'Purchase Invoice', PO: 'Purchase Order', SI: 'Sales Invoice',
  GRN: 'GRN / Goods Receipt', DC: 'Delivery Challan', PV: 'Payment Voucher',
  RV: 'Receipt Voucher', JV: 'Journal Voucher', EXP: 'Expense', CN: 'Credit Note',
  DN: 'Debit Note', ST: 'Stock Transfer', SA: 'Stock Adjustment', OTHER: 'Other',
};

const STATUS_COLORS = {
  posted: 'var(--ok)', draft: 'var(--muted)', 'pending-approval': 'var(--warn)',
  failed: 'var(--err)',
};

function StatCard({ icon, label, value, sub, color, badge }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '16px 20px',
      boxShadow: '0 1px 3px rgba(0,0,0,.07)', border: '1px solid #e2e7ef',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: color || 'var(--ink)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
      {badge && <span className="badge b-info" style={{ alignSelf: 'flex-start', marginTop: 4 }}>{badge}</span>}
    </div>
  );
}

export default function Dashboard({ onBack, tenant, onStartWizard, onViewAllBatches, onOpenBatch, isFirstScreen }) {
  const [stats, setStats] = useState(null);
  const [balance, setBalance] = useState(null);
  const [emailCfg, setEmailCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [toast, setToast] = useState(null);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [recentBatches, setRecentBatches] = useState([]);

  const showToast = useCallback((msg, err) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), err ? 5000 : 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b, e, rb] = await Promise.all([
        fetch(`${BACKEND}/api/docai/dashboard/stats`).then(r => r.json()),
        fetch(`${BACKEND}/api/docai/dashboard/sarvam-balance`).then(r => r.json()),
        fetch(`${BACKEND}/api/docai/dashboard/email-config`).then(r => r.json()),
        fetch(`${BACKEND}/api/docai/batches`).then(r => r.json()).catch(() => []),
      ]);
      setStats(s); setBalance(b); setEmailCfg(e);
      setEditEmail((e.recipients || []).join(', '));
      setEditEnabled(e.enabled !== false);
      setRecentBatches((rb || []).slice(0, 10)); // Show only 10 most recent
    } catch (ex) {
      showToast('Failed to load dashboard: ' + ex.message, true);
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const saveEmail = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${BACKEND}/api/docai/dashboard/email-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: editEmail, enabled: editEnabled }),
      });
      const d = await r.json();
      setEmailCfg(d.config);
      showToast('Email settings saved ✓');
    } catch (ex) { showToast('Save failed: ' + ex.message, true); }
    setSaving(false);
  };

  const sendDigest = async () => {
    setSendingDigest(true);
    try {
      const r = await fetch(`${BACKEND}/api/docai/dashboard/send-digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const d = await r.json();
      showToast('Digest email queued — check inbox in ~30 sec');
    } catch (ex) { showToast('Send failed: ' + ex.message, true); }
    setSendingDigest(false);
  };

  // Build chart data (last 7 days)
  const chartDays = [];
  if (stats?.recentDays?.length) {
    const byDate = {};
    stats.recentDays.forEach(r => { byDate[r.date] = r.count; });
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', IST_OPTS);
      const label = new Date(Date.now() - i * 86400000).toLocaleDateString('en-IN', { ...IST_OPTS, weekday: 'short', day: '2-digit', month: 'short' });
      chartDays.push({ date: d, label, count: byDate[d] || 0 });
    }
  }
  const maxCount = chartDays.length ? Math.max(...chartDays.map(d => d.count), 1) : 1;

  const typeEntries = Object.entries(stats?.byType || {}).sort((a, b) => b[1] - a[1]);
  const IST_DATE_OPTS = { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

  return (
    <div style={{ padding: '0 0 40px' }} data-testid="dashboard">
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e7ef', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="logo" style={{ fontSize: 18 }}>Retail<b style={{ color: 'var(--brand)' }}>CLIQ</b></div>
          <span style={{ color: '#c4ccd8' }}>·</span>
          <span style={{ fontWeight: 600, fontSize: 15 }}>AI Document Wizard</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {tenant?.resolved ? `Tenant: ${tenant.clientName} · DB: ${tenant.tenantDb}` : 'Dashboard'}
            {stats?.generatedAt && <span style={{ marginLeft: 8 }}>· Updated: {stats.generatedAt} IST</span>}
          </div>
        </div>
        {/* Primary Action: Start Processing */}
        {onStartWizard && (
          <button className="btn primary" onClick={onStartWizard} data-testid="btn-start-wizard" style={{ fontSize: 14, padding: '9px 18px' }}>
            ➕ New Document
          </button>
        )}
        {onViewAllBatches && (
          <button className="btn sm" onClick={onViewAllBatches} data-testid="btn-view-all-batches">
            📋 All Batches
          </button>
        )}
        {onBack && (
          <button className="btn sm" onClick={onBack} data-testid="btn-dashboard-back">
            ← Back to Wizard
          </button>
        )}
        <button className="btn sm" onClick={load} title="Refresh">↻</button>
      </div>

      <div style={{ padding: '20px', maxWidth: 1400, margin: '0 auto' }}>
        {/* Hero CTA when first screen */}
        {isFirstScreen && (
          <div style={{ background: 'linear-gradient(135deg, #0f5fd6 0%, #0b4bb0 100%)', borderRadius: 14, padding: '24px 28px', marginBottom: 20, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, color: '#fff' }}>RetailCLIQ · AI Document Wizard</h1>
              <p style={{ margin: '6px 0 0', opacity: 0.85, fontSize: 14 }}>
                Upload invoices, bank statements, Tally XML, EDI files — Sarvam AI reads them all.<br />
                10-step pipeline: OCR → Detect → Extract → Review → Map → Validate → Reconcile → Post
              </p>
            </div>
            {onStartWizard && (
              <button onClick={onStartWizard} data-testid="btn-hero-start" style={{
                background: '#fff', color: 'var(--brand)', border: 'none', borderRadius: 10,
                padding: '12px 24px', fontWeight: 700, fontSize: 15, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                🚀 Start Processing Document →
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="busy" style={{ maxWidth: 400 }}><div className="spin" /><div>Loading dashboard stats…</div></div>
        ) : (
          <>
            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12, marginBottom: 24 }}>
              <StatCard icon="📄" label="Total Documents" value={stats?.total ?? 0} sub="All time" color="var(--brand)" />
              <StatCard icon="📅" label="Today" value={stats?.today ?? 0} sub={new Date().toLocaleDateString('en-IN', IST_OPTS)} color={stats?.today > 0 ? 'var(--ok)' : 'var(--muted)'} />
              <StatCard icon="📈" label="This Week" value={stats?.thisWeek ?? 0} sub="Last 7 days" color="var(--brand-2)" />
              <StatCard icon="📊" label="This Month" value={stats?.thisMonth ?? 0} sub="Last 30 days" />
              <StatCard icon="✅" label="Posted" value={stats?.posted ?? 0} sub="In ERP" color="var(--ok)" />
              <StatCard icon="⏳" label="Pending Approval" value={stats?.pendingApproval ?? 0} color="var(--warn)" />
            </div>

            {/* Sarvam Balance Card */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e7ef', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🤖</span> Sarvam AI · Credit Balance
                  </h2>
                  <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
                    Model: sarvam-105b · Fallback: Gemini 2.5-flash · Mode: digitise+llm
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {balance?.credits != null ? (
                    <div>
                      <div style={{ fontSize: 32, fontWeight: 800, color: balance.credits < 100 ? 'var(--err)' : 'var(--ok)' }}>
                        {balance.credits?.toLocaleString('en-IN') ?? '—'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>credits remaining</div>
                      {balance.credits < 100 && (
                        <span className="badge b-err" style={{ marginTop: 4 }}>⚠️ Low Credits — Reload</span>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 300 }}>
                        {balance?.note || balance?.error || 'Credit balance not available via API. Check Sarvam dashboard directly.'}
                      </div>
                      <a href="https://dashboard.sarvam.ai" target="_blank" rel="noopener noreferrer" className="btn sm primary" style={{ marginTop: 8, display: 'inline-block' }}>
                        🔗 Open Sarvam Dashboard
                      </a>
                    </div>
                  )}
                </div>
              </div>
              {balance?.credits != null && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href="https://dashboard.sarvam.ai/billing" target="_blank" rel="noopener noreferrer" className="btn sm primary">
                    💳 Reload Sarvam Credits
                  </a>
                  <a href="https://dashboard.sarvam.ai" target="_blank" rel="noopener noreferrer" className="btn sm">
                    📊 View Usage
                  </a>
                </div>
              )}
            </div>

            {/* Charts Row */}
            <div style={{ display: 'grid', gridTemplateColumns: chartDays.length ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 20 }}>
              {/* 7-Day Bar Chart */}
              {chartDays.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e7ef' }}>
                  <h3 style={{ margin: '0 0 16px' }}>📅 Documents Scanned — Last 7 Days</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
                    {chartDays.map((d, i) => (
                      <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ fontSize: 11, color: 'var(--ink)', fontWeight: d.count > 0 ? 700 : 400 }}>{d.count || ''}</div>
                        <div style={{
                          width: '100%', minHeight: 4,
                          height: `${(d.count / maxCount) * 90}px`,
                          background: d.count > 0 ? 'var(--brand)' : '#e2e7ef',
                          borderRadius: '4px 4px 0 0',
                          transition: 'height 0.3s',
                        }} title={`${d.date}: ${d.count} docs`} />
                        <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>{d.label.slice(0, 6)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Document Type Breakdown */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e7ef' }}>
                <h3 style={{ margin: '0 0 12px' }}>📑 Document Types Processed</h3>
                {typeEntries.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {typeEntries.map(([type, count]) => {
                      const pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
                      return (
                        <div key={type}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, fontSize: 13 }}>
                            <span>{DOC_LABELS[type] || type}</span>
                            <span style={{ fontWeight: 700 }}>{count} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: 6, background: '#e2e7ef', borderRadius: 3 }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--brand)', borderRadius: 3, transition: 'width 0.4s' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>No documents processed yet.</p>}
              </div>
            </div>

            {/* Email Settings */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e7ef' }}>
              <h2 style={{ margin: '0 0 4px' }}>📧 Daily Digest Email Settings</h2>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 13 }}>
                A daily report with today's scan count and Sarvam credit usage is sent at 9:30 AM IST every day when documents were scanned.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'start', marginBottom: 16 }}>
                <div className="field">
                  <label>Recipients (comma-separated)</label>
                  <input
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    placeholder="email1@domain.com, email2@domain.com"
                    data-testid="email-recipients"
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    SMTP: {emailCfg?.smtpHost} · From: {emailCfg?.smtpUser}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 24 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editEnabled} onChange={e => setEditEnabled(e.target.checked)} />
                    Enabled
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={saveEmail} disabled={saving} data-testid="btn-save-email">
                  {saving ? 'Saving…' : '💾 Save Settings'}
                </button>
                <button className="btn" onClick={sendDigest} disabled={sendingDigest} data-testid="btn-send-digest">
                  {sendingDigest ? 'Sending…' : '📤 Send Test Digest Now'}
                </button>
                <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
                  Schedule: Daily at 9:30 AM IST · Subject: {emailCfg?.subject?.replace('{date}', 'DATE')}
                </div>
              </div>
            </div>

            {/* Recent Batches — last 10 with View All */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e7ef', marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>🕒 Recent Batches <span className="badge b-muted" style={{ fontSize: 12, fontWeight: 600 }}>Last 10</span></h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  {onStartWizard && (
                    <button className="btn sm primary" onClick={onStartWizard} data-testid="btn-new-doc-from-recent">+ New Document</button>
                  )}
                  {onViewAllBatches && (
                    <button className="btn sm" onClick={onViewAllBatches} data-testid="btn-view-all-from-recent">
                      View all batches →
                    </button>
                  )}
                </div>
              </div>
              {recentBatches.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)' }}>
                  <div style={{ fontSize: 36 }}>📭</div>
                  <p>No documents processed yet. Start by uploading a document.</p>
                  {onStartWizard && <button className="btn primary" onClick={onStartWizard}>🚀 Process First Document</button>}
                </div>
              ) : (
                <div className="tbl-wrap">
                  <table className="hist">
                    <thead>
                      <tr><th>Batch</th><th>Type</th><th>Doc No</th><th>Party</th><th className="num">Total</th><th>Status</th><th>Created (IST)</th><th></th></tr>
                    </thead>
                    <tbody>
                      {recentBatches.map(b => (
                        <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => onOpenBatch && onOpenBatch(b.id)}>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.id?.slice(0, 8)}…</td>
                          <td><span className="badge b-muted">{b.docType || '—'}</span></td>
                          <td style={{ fontWeight: 600 }}>{b.docNo || '—'}</td>
                          <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.party || '—'}</td>
                          <td className="num">{b.grandTotal ? `₹${Number(b.grandTotal).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</td>
                          <td><span className={`badge ${b.status === 'posted' ? 'b-ok' : b.status === 'pending-approval' ? 'b-warn' : 'b-muted'}`}>{b.status || 'draft'}</span></td>
                          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                          <td><button className="btn sm ghost" onClick={e => { e.stopPropagation(); onOpenBatch && onOpenBatch(b.id); }}>Open →</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>
      )}
    </div>
  );
}
