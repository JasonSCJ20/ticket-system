import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { fetchApplications, createApplication } from '../api/security.js';
import { Card, Badge, ErrorState } from '../components/ui.jsx';
import AssetDetail from './AssetDetail.jsx';

const HEALTH_TONE = { healthy: 'ok', degraded: 'high', critical: 'critical', unknown: 'low' };

const inputStyle = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 12,
};

export default function Assets() {
  const { data: assets, loading, error, reload } = useApi(fetchApplications, []);
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', baseUrl: '', environment: 'production', ownerEmail: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const selected = assets?.find((a) => a.id === selectedId) || null;

  const handleCreate = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await createApplication({
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        environment: form.environment,
        ownerEmail: form.ownerEmail.trim() || undefined,
      });
      setForm({ name: '', baseUrl: '', environment: 'production', ownerEmail: '' });
      setShowForm(false);
      reload();
      setSelectedId(created.id);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading assets…</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1.4fr 1fr' : '1fr', gap: 12 }}>
      <Card
        title={`Registered assets (${assets.length})`}
        right={
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >
            {showForm ? 'Cancel' : '+ New asset'}
          </button>
        }
      >
        {showForm && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            {formError && <p style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 0 }}>{formError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
              <input placeholder="Base URL (https://...)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} style={inputStyle} />
              <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} style={inputStyle}>
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="development">development</option>
              </select>
              <input placeholder="Owner email (optional)" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} style={inputStyle} />
            </div>
            <button
              disabled={busy}
              onClick={handleCreate}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--bg)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
            >
              Register asset
            </button>
          </div>
        )}

        {assets.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No assets registered yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Environment</th>
                <th style={thStyle}>Health</th>
                <th style={thStyle}>Enforcement</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Verification</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedId === a.id ? 'var(--accent-soft)' : 'transparent' }}
                >
                  <td style={tdStyle}>{a.name}</td>
                  <td style={tdStyle}>{a.environment}</td>
                  <td style={tdStyle}>
                    <Badge tone={HEALTH_TONE[a.healthStatus] || 'low'}>{a.healthStatus}</Badge>
                  </td>
                  <td style={tdStyle}>{a.enforcementModel}</td>
                  <td style={tdStyle}>{a.enforcementMode}</td>
                  <td style={tdStyle}>{a.verificationStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <AssetDetail
          asset={selected}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

const thStyle = { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const tdStyle = { padding: '8px 8px' };
