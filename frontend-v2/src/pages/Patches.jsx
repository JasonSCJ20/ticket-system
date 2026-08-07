import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { fetchPatches, createPatch, updatePatchStatus } from '../api/security.js';
import { Card, ErrorState, FeedbackBanner, StatCard, StatCardRow, StatusDot, Chip } from '../components/ui.jsx';

const STATUS_OPTIONS = ['todo', 'in_progress', 'completed'];
const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'];
const ASSET_TYPE_OPTIONS = ['application', 'network_device', 'database_asset'];
const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'muted' };

const inputStyle = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
};

// Plain-language due-date phrasing for the list row subtitle, matching how
// the rest of the redesigned tabs (Tickets' SLA label, Findings' timeAgo)
// avoid raw dates in favor of "how urgent is this right now."
function dueLabel(dueDate, status) {
  if (!dueDate) return 'no due date';
  const diffDays = Math.round((new Date(dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (status !== 'completed' && diffDays < 0) return `overdue by ${Math.abs(diffDays)}d`;
  if (diffDays === 0) return 'due today';
  if (diffDays > 0) return `due in ${diffDays}d`;
  return `was due ${Math.abs(diffDays)}d ago`;
}

export default function Patches() {
  const { data, loading, error, reload } = useApi(fetchPatches, []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ assetType: 'application', assetId: '', title: '', severity: 'medium', ownerEmail: '', dueDate: '' });
  const [busy, setBusy] = useState(false);
  const { feedback, notifySuccess, notifyError, clear } = useActionFeedback();

  const handleCreate = async () => {
    if (!form.title.trim() || !form.assetId) return;
    setBusy(true);
    clear();
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
      notifyError(err, 'Failed to create that patch task.');
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    const notes = status === 'completed' ? window.prompt('Completion notes (optional):', '') : null;
    setBusy(true);
    clear();
    try {
      await updatePatchStatus(id, status, notes || undefined);
      notifySuccess(`Status set to ${status}.`);
      reload();
    } catch (err) {
      notifyError(err, 'Failed to update that task\'s status.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading patch tasks…</p>;

  const { summary, items } = data;
  // The /security/patches summary doesn't currently break out autoDetected
  // counts server-side, so compute it from the loaded items — but prefer a
  // server-provided count transparently if one is ever added.
  const foundAutomatically = summary?.autoDetectedCount ?? items.filter((p) => p.autoDetected === true).length;

  return (
    <div>
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      <StatCardRow>
        <StatCard label="Open tasks" value={summary.total} />
        <StatCard label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? 'danger' : undefined} />
        <StatCard label="Found automatically" value={foundAutomatically} />
        <StatCard label="Completion rate" value={`${Math.round(summary.completionRate * 100)}%`} />
      </StatCardRow>

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
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.map((p, i) => {
              const overdue = p.dueDate && new Date(p.dueDate) < new Date() && p.status !== 'completed';
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 4px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <StatusDot tone={SEVERITY_TONE[p.severity] || 'muted'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <p style={{ fontSize: 14, margin: 0 }}>{p.title}</p>
                      <Chip tone={p.autoDetected ? 'accent' : 'muted'}>{p.autoDetected ? 'Found by scan' : 'Added manually'}</Chip>
                    </div>
                    <p style={{ fontSize: 12, color: overdue ? 'var(--danger)' : 'var(--text-muted)', margin: '4px 0 0' }}>
                      {p.assetName || `${p.assetType} #${p.assetId}`} · {dueLabel(p.dueDate, p.status)}
                    </p>
                  </div>
                  <select disabled={busy} value={p.status} onChange={(e) => handleStatusChange(p.id, e.target.value)} style={{ ...inputStyle, padding: '4px 6px', fontSize: 11.5 }}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
