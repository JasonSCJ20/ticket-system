import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { fetchFindings } from '../api/security.js';
import { Card, Badge, ErrorState } from '../components/ui.jsx';
import FindingDetail from './FindingDetail.jsx';

const STATUS_TABS = [
  { key: null, label: 'All open', tone: 'medium' },
  { key: 'new', label: 'New', tone: 'high' },
  { key: 'investigating', label: 'Investigating', tone: 'medium' },
  { key: 'remediated', label: 'Remediated', tone: 'ok' },
  { key: 'dismissed', label: 'Dismissed', tone: 'low' },
];

export default function Findings() {
  const [status, setStatus] = useState(null);
  const { data: findings, loading, error, reload } = useApi(() => fetchFindings(status ? { status } : {}), [status]);
  const [selected, setSelected] = useState(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Risk</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setSelected(f)}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === f.id ? 'var(--accent-soft)' : 'transparent' }}
                >
                  <td style={tdStyle}>
                    <Badge tone={f.severity}>{f.severity}</Badge>
                  </td>
                  <td style={tdStyle}>{f.title}</td>
                  <td style={tdStyle}>{f.category}</td>
                  <td style={tdStyle}>
                    <Badge tone={f.riskBand}>{f.riskScore}</Badge>
                  </td>
                  <td style={tdStyle}>{f.status}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{new Date(f.lastSeenAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  );
}

const thStyle = { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const tdStyle = { padding: '8px 8px' };
