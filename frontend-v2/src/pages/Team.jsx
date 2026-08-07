import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { fetchUsers, createUser } from '../api/users.js';
import { Card, ErrorState, FeedbackBanner, StatusRow, Chip } from '../components/ui.jsx';

const DEPARTMENT_OPTIONS = ['Networks', 'Dev', 'Hardware'];
const AUDIENCE_LABELS = { STAFF: 'Operational staff', TJN: 'CommandCentre manager', GJN: 'Operational manager', BJN: 'Executive', DGSN: 'Stakeholder' };

const inputStyle = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
};

// Only ever render fields explicitly picked here — never spread the raw API
// row, since the list response can carry sensitive account fields we must
// not surface in the UI even if the backend includes them.
function safeUser(u) {
  return {
    id: u.id,
    name: u.name,
    surname: u.surname,
    department: u.department,
    jobTitle: u.jobTitle,
    role: u.role,
    audienceCode: u.audienceCode,
    email: u.email,
    telegramNumber: u.telegramNumber,
    isOnline: u.isOnline,
    lastSeenAt: u.lastSeenAt,
  };
}

export default function Team() {
  const { data, loading, error, reload } = useApi(fetchUsers, []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', surname: '', department: 'Networks', jobTitle: '', telegramNumber: '', email: '', scjId: '', role: 'analyst' });
  const [busy, setBusy] = useState(false);
  const { feedback, notifyError, clear } = useActionFeedback();

  const handleCreate = async () => {
    if (!form.name.trim() || !form.surname.trim() || !form.email.trim() || !form.telegramNumber.trim() || !form.scjId.trim()) return;
    setBusy(true);
    clear();
    try {
      await createUser({
        name: form.name.trim(),
        surname: form.surname.trim(),
        department: form.department,
        jobTitle: form.jobTitle.trim() || undefined,
        telegramNumber: form.telegramNumber.trim(),
        email: form.email.trim(),
        scjId: form.scjId.trim(),
        role: form.role.trim() || undefined,
      });
      setForm({ name: '', surname: '', department: 'Networks', jobTitle: '', telegramNumber: '', email: '', scjId: '', role: 'analyst' });
      setShowForm(false);
      reload();
    } catch (err) {
      notifyError(err, 'Failed to add that team member.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading team…</p>;

  const users = data.map(safeUser);

  return (
    <Card
      title={`Team (${users.length})`}
      right={
        <button onClick={() => setShowForm((v) => !v)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
          {showForm ? 'Cancel' : '+ New team member'}
        </button>
      }
    >
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      {showForm && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input placeholder="First name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            <input placeholder="Surname" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} style={inputStyle} />
            <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} style={inputStyle}>
              {DEPARTMENT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input placeholder="Job title (optional)" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} style={inputStyle} />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} />
            <input placeholder="Telegram number" value={form.telegramNumber} onChange={(e) => setForm({ ...form, telegramNumber: e.target.value })} style={inputStyle} />
            <input placeholder="SCJ ID (00000000-00000)" value={form.scjId} onChange={(e) => setForm({ ...form, scjId: e.target.value })} style={inputStyle} />
            <input placeholder="Role (default: analyst)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle} />
          </div>
          <button disabled={busy} onClick={handleCreate} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--bg)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
            Add team member
          </button>
        </div>
      )}

      {users.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No team members yet.</p>
      ) : (
        <div>
          {users.map((u, i) => {
            const audience = AUDIENCE_LABELS[u.audienceCode] || u.audienceCode || '—';
            const subtitle = `${u.department} · ${audience}${u.isOnline ? '' : ' · offline'}`;
            return (
              <StatusRow
                key={u.id}
                tone={u.isOnline ? 'ok' : 'muted'}
                title={
                  <span>
                    {u.name} {u.surname}
                    {u.role === 'admin' && (
                      <span style={{ marginLeft: 8 }}>
                        <Chip>Admin</Chip>
                      </span>
                    )}
                  </span>
                }
                subtitle={subtitle}
                right={<span style={{ color: 'var(--text-muted)' }}>{u.email}</span>}
                divider={i > 0}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}
