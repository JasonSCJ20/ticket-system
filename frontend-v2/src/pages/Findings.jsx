import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { fetchFindings } from '../api/security.js';
import { Card, ErrorState, StatCard, StatCardRow, StatusDot, Chip } from '../components/ui.jsx';
import FindingDetail from './FindingDetail.jsx';

const STATUS_TABS = [
  { key: null, label: 'All open' },
  { key: 'new', label: 'New' },
  { key: 'investigating', label: 'Investigating' },
  { key: 'remediated', label: 'Remediated' },
  { key: 'dismissed', label: 'Dismissed' },
];

const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'muted' };

const STATUS_LABEL = { new: 'New', investigating: 'Investigating', remediated: 'Remediated', dismissed: 'Dismissed' };
const STATUS_COLOR = {
  new: 'var(--warning)',
  investigating: 'var(--warning)',
  remediated: 'var(--success)',
  dismissed: 'var(--danger)',
};

function timeAgo(dateString) {
  if (!dateString) return 'unknown';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const hours = diffMs / 36e5;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function isWithinLastWeek(dateString) {
  if (!dateString) return false;
  const diffMs = Date.now() - new Date(dateString).getTime();
  return diffMs >= 0 && diffMs <= 7 * 24 * 36e5;
}

export default function Findings() {
  const [status, setStatus] = useState(null);
  const { data: findings, loading, error, reload } = useApi(() => fetchFindings(status ? { status } : {}), [status]);
  const [selected, setSelected] = useState(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;

  const newCount = findings?.filter((f) => f.status === 'new').length ?? 0;
  const investigatingCount = findings?.filter((f) => f.status === 'investigating').length ?? 0;
  const fixedThisWeek = findings?.filter((f) => f.status === 'remediated' && isWithinLastWeek(f.updatedAt)).length ?? 0;

  return (
    <div>
      <StatCardRow>
        <StatCard label="New" value={newCount} />
        <StatCard label="Being investigated" value={investigatingCount} tone="warning" />
        <StatCard label="Fixed this week" value={fixedThisWeek} tone="ok" />
      </StatCardRow>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1.4fr 1fr' : '1fr', gap: 12 }}>
        <Card title="Findings">
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.label}
                onClick={() => setStatus(tab.key)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: `1px solid ${status === tab.key ? 'var(--accent)' : 'var(--border)'}`,
                  background: status === tab.key ? 'var(--accent-soft)' : 'transparent',
                  color: status === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading findings…</p>
          ) : findings.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No findings in this view.</p>
          ) : (
            <div>
              {findings.map((f) => (
                <div
                  key={f.id}
                  onClick={() => setSelected(f)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 4px',
                    borderTop: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: selected?.id === f.id ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <StatusDot tone={SEVERITY_TONE[f.severity] || 'muted'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, margin: 0 }}>{f.title}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      {f.application?.name && <Chip>{f.application.name}</Chip>}
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(f.lastSeenAt)}</span>
                    </div>
                  </div>
                  <div style={{ whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, color: STATUS_COLOR[f.status] || 'var(--text-muted)' }}>
                    {STATUS_LABEL[f.status] || f.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {selected && (
          <FindingDetail
            finding={selected}
            onClose={() => setSelected(null)}
            onChanged={() => {
              reload();
              setSelected(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
