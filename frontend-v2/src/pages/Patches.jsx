import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { fetchPatches, createPatch, updatePatchStatus } from '../api/security.js';
import { Card, KpiRow, Kpi, Badge, ErrorState } from '../components/ui.jsx';

const STATUS_OPTIONS = ['todo', 'in_progress', 'completed'];
const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'];
const ASSET_TYPE_OPTIONS = ['application', 'network_device', 'database_asset'];

const inputStyle = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
};

export default function Patches() {
  const { data, loading, error, reload } = useApi(fetchPatches, []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ assetType: 'application', assetId: '', title: '', severity: 'medium', ownerEmail: '', dueDate: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.assetId) return;
    setBusy(true);
    setFormError(null);
    try {
      await createPatch({
        assetType: form.assetType,
        assetId: Number(form.assetId),
        title: form.title.trim(),
        severity: form.severity,
        ownerEmail: form.ownerEmail.trim() || undefined,
        dueDate: form.dueDate || undefined,
      });
      setForm({ assetType: 'application', assetId: '', title: '', severity: 'medium', ownerEmail: '', dueDate: '' });
      setShowForm(false);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    const notes = status === 'completed' ? window.prompt('Completion notes (optional):', '') : null;
    setBusy(true);
    try {
      await updatePatchStatus(id, status, notes || undefined);
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading patch tasks…</p>;

  const { summary, items } = data;

  return (
    <div>
      <KpiRow>
        <Kpi label="Total tasks" value={summary.total} />
        <Kpi label="Overdue" value={summary.overdue} deltaColor={summary.overdue > 0 ? 'var(--danger)' : undefined} />
        <Kpi label="Completion rate" value={`${Math.round(summary.completionRate * 100)}%`} />
        <Kpi label="Completed" value={summary.byStatus?.completed || 0} />
      </KpiRow>

      <Card
        title={`Patch tasks (${items.length})`}
        right={
          <button onClick={() => setShowForm((v) => !v)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
            {showForm ? 'Cancel' : '+ New task'}
          </button>
        }
      >
        {showForm && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            {formError && <p style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 0 }}>{formError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} style={inputStyle}>
                {ASSET_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="Asset ID" value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })} style={inputStyle} />
              <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} style={inputStyle}>
                {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={inputStyle} />
              <input placeholder="Owner email (optional)" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
            </div>
            <button disabled={busy} onClick={handleCreate} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--bg)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              Create task
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No patch tasks yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Asset</th>
                <th style={thStyle}>Due</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}><Badge tone={p.severity}>{p.severity}</Badge></td>
                  <td style={tdStyle}>{p.title}</td>
                  <td style={tdStyle}>{p.assetName || `${p.assetType} #${p.assetId}`}</td>
                  <td style={{ ...tdStyle, color: p.dueDate && new Date(p.dueDate) < new Date() && p.status !== 'completed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {p.dueDate ? new Date(p.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td style={tdStyle}>
                    <select disabled={busy} value={p.status} onChange={(e) => handleStatusChange(p.id, e.target.value)} style={{ ...inputStyle, padding: '4px 6px', fontSize: 11.5 }}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const thStyle = { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const tdStyle = { padding: '8px 8px' };
