import React, { useState, useEffect, useCallback } from 'react';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const API_BASE = `${BACKEND}/api/docai`;

const IST_OPTS = { timeZone: 'Asia/Kolkata' };
const fmtIST = (d) => { try { return new Date(d).toLocaleString('en-IN', { ...IST_OPTS, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(d || ''); } };
const money = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DOC_TYPES = ['', 'PI', 'PO', 'SI', 'SO', 'GRN', 'DC', 'EST', 'DN', 'CN', 'PV', 'RV', 'JV', 'EXP', 'GL', 'CTV', 'PDC', 'BST', 'BRS', 'TDS', 'PT_PUR', 'PT_SAL', 'ST', 'SA', 'OTHER'];
const STATUS_OPTS = ['', 'draft', 'posted', 'pending-approval', 'failed'];
const STATUS_BADGE = { posted: 'b-ok', draft: 'b-muted', 'pending-approval': 'b-warn', failed: 'b-err' };

export default function BatchReport({ onBack, onOpenBatch }) {
  const [allBatches, setAllBatches] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/batches`);
      const data = await r.json();
      setAllBatches(data || []);
    } catch (e) {
      console.error('BatchReport load error:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Apply filters
  useEffect(() => {
    let rows = [...allBatches];
    const q = search.toLowerCase().trim();
    if (q) {
      rows = rows.filter(b =>
        b.id?.toLowerCase().includes(q) ||
        b.docNo?.toLowerCase().includes(q) ||
        b.party?.toLowerCase().includes(q) ||
        b.docType?.toLowerCase().includes(q) ||
        b.fileName?.toLowerCase().includes(q)
      );
    }
    if (filterType) rows = rows.filter(b => b.docType === filterType);
    if (filterStatus) rows = rows.filter(b => b.status === filterStatus);
    if (filterFrom) rows = rows.filter(b => b.createdAt?.slice(0, 10) >= filterFrom);
    if (filterTo) rows = rows.filter(b => b.createdAt?.slice(0, 10) <= filterTo);
    setFiltered(rows);
    setPage(1);
  }, [allBatches, search, filterType, filterStatus, filterFrom, filterTo]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const clearFilters = () => { setSearch(''); setFilterType(''); setFilterStatus(''); setFilterFrom(''); setFilterTo(''); };

  const exportCsv = () => {
    const headers = ['Batch ID', 'Doc Type', 'Doc No', 'Party', 'Status', 'Grand Total', 'File', 'Created (IST)'];
    const rows = filtered.map(b => [
      b.id?.slice(0, 16), b.docType || '', b.docNo || '', b.party || '',
      b.status || '', b.grandTotal || '', b.fileName || '', fmtIST(b.createdAt),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `batch-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // Summary stats from filtered
  const stats = {
    total: filtered.length,
    posted: filtered.filter(b => b.status === 'posted').length,
    pending: filtered.filter(b => b.status === 'pending-approval').length,
    draft: filtered.filter(b => b.status === 'draft').length,
    totalValue: filtered.reduce((s, b) => s + (Number(b.grandTotal) || 0), 0),
  };

  return (
    <div style={{ background: '#f4f6fa', minHeight: '100vh' }} data-testid="batch-report">
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e7ef', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 10 }}>
        <button className="btn sm" onClick={onBack} data-testid="btn-batch-back">← Back to Dashboard</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>📋 Batch Report</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} of {allBatches.length} batches · All time</div>
        </div>
        <button className="btn sm" onClick={exportCsv} data-testid="btn-export-csv">⬇ Export CSV</button>
        <button className="btn sm" onClick={load}>↻ Refresh</button>
      </div>

      <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
        {/* Summary Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
          {[
            ['📄', 'Total Batches', stats.total, 'var(--brand)'],
            ['✅', 'Posted', stats.posted, 'var(--ok)'],
            ['⏳', 'Pending Approval', stats.pending, 'var(--warn)'],
            ['📝', 'Draft', stats.draft, 'var(--muted)'],
            ['₹', 'Total Value', `₹${(stats.totalValue / 100000).toFixed(1)}L`, 'var(--ink)'],
          ].map(([icon, label, val, color]) => (
            <div key={label} style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', border: '1px solid #e2e7ef' }}>
              <div style={{ fontSize: 20 }}>{icon}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', border: '1px solid #e2e7ef', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            <div className="field">
              <label>🔍 Search</label>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Batch ID, Doc No, Party, File…"
                data-testid="batch-search"
              />
            </div>
            <div className="field">
              <label>Document Type</label>
              <select value={filterType} onChange={e => setFilterType(e.target.value)} data-testid="filter-doctype">
                {DOC_TYPES.map(t => <option key={t} value={t}>{t || '— All Types —'}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} data-testid="filter-status">
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s || '— All —'}</option>)}
              </select>
            </div>
            <div className="field">
              <label>From Date</label>
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} data-testid="filter-from" />
            </div>
            <div className="field">
              <label>To Date</label>
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} data-testid="filter-to" />
            </div>
            <div style={{ paddingBottom: 4 }}>
              <button className="btn sm" onClick={clearFilters} title="Clear all filters">✕ Clear</button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e7ef', overflow: 'hidden' }}>
          {loading ? (
            <div className="busy" style={{ padding: 24 }}><div className="spin" /><div>Loading batches…</div></div>
          ) : pageRows.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 40 }}>📭</div>
              <p>No batches match your filters</p>
              <button className="btn sm" onClick={clearFilters}>Clear filters</button>
            </div>
          ) : (
            <div className="tbl-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Type</th>
                    <th>Doc No</th>
                    <th>Party / Supplier</th>
                    <th className="num">Grand Total</th>
                    <th>Status</th>
                    <th>Source File</th>
                    <th>Created (IST)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(b => (
                    <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => onOpenBatch(b.id)}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.id?.slice(0, 8)}…</td>
                      <td>
                        <span className={`badge ${b.docType === 'BST' ? 'b-info' : b.docType?.startsWith('PT') ? 'b-new' : 'b-muted'}`}>
                          {b.docType || '—'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{b.docNo || '—'}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.party || '—'}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{b.grandTotal ? `₹${money(b.grandTotal)}` : '—'}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[b.status] || 'b-muted'}`}>{b.status || 'draft'}</span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.fileName || '—'}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtIST(b.createdAt)}</td>
                      <td>
                        <button className="btn sm ghost" onClick={e => { e.stopPropagation(); onOpenBatch(b.id); }}>Open →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn sm" onClick={() => setPage(1)} disabled={page === 1}>⟨⟨</button>
              <button className="btn sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹ Prev</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                return (
                  <button key={p} className={`btn sm ${p === page ? 'primary' : ''}`} onClick={() => setPage(p)}>{p}</button>
                );
              })}
              <button className="btn sm" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>Next ›</button>
              <button className="btn sm" onClick={() => setPage(totalPages)} disabled={page === totalPages}>⟩⟩</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
