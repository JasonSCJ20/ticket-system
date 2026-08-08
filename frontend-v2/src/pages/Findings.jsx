import { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { fetchFindings, fetchApplications } from '../api/security.js';
import { Card, ErrorState, StatCard, StatCardRow, StatusDot, Chip, FeedbackBanner } from '../components/ui.jsx';
import FindingDetail from './FindingDetail.jsx';

const STATUS_TABS = [
  { key: null, label: 'All open' },
  { key: 'new', label: 'New' },
  { key: 'investigating', label: 'Investigating' },
  { key: 'remediated', label: 'Remediated' },
  { key: 'dismissed', label: 'Dismissed' },
];

// Ordered worst-to-best so a plain array index gives a real priority rank —
// used to sort client-side by severity within whatever the server already
// sorted by risk score, and to build the CSV/copy export in the same order
// the list is actually displayed in.
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'muted' };
const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

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

// One row of the exported/copied text — kept identical between the copy
// and CSV paths so what you paste and what you download always agree.
function findingSummaryLine(f) {
  const asset = f.application?.name || 'Unknown asset';
  return `[${SEVERITY_LABEL[f.severity] || f.severity}] ${f.title} — ${asset} — ${STATUS_LABEL[f.status] || f.status} — risk ${f.riskScore ?? 'n/a'} — last seen ${f.lastSeenAt ? new Date(f.lastSeenAt).toLocaleString() : 'unknown'}`;
}

function toCsv(findings) {
  const header = ['Severity', 'Title', 'Asset', 'Status', 'Risk score', 'Source tool', 'First seen', 'Last seen'];
  const rows = findings.map((f) => [
    SEVERITY_LABEL[f.severity] || f.severity,
    f.title,
    f.application?.name || 'Unknown asset',
    STATUS_LABEL[f.status] || f.status,
    f.riskScore ?? '',
    f.sourceTool || '',
    f.firstSeenAt || '',
    f.lastSeenAt || '',
  ]);
  const escape = (value) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const chipBtnStyle = (active) => ({
  padding: '5px 10px',
  borderRadius: 6,
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  background: active ? 'var(--accent-soft)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
});

const toolbarBtnStyle = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const selectStyle = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 11.5,
};

export default function Findings() {
  const [status, setStatus] = useState(null);
  const [severity, setSeverity] = useState(null); // null = all, or 'critical,high' etc.
  const [assetId, setAssetId] = useState('all');
  const { data: findings, loading, error, reload } = useApi(
    () => fetchFindings({ ...(status ? { status } : {}), ...(severity ? { severity } : {}) }),
    [status, severity],
  );
  const { data: applications } = useApi(fetchApplications, []);
  const [selected, setSelected] = useState(null);
  const { feedback, notifySuccess, notifyError, clear } = useActionFeedback();

  // The server already sorts by riskScore DESC (highest priority first) —
  // this just re-groups by severity band on top of that so the ordering is
  // unambiguous even when two findings share a similar risk score.
  const visible = useMemo(() => {
    if (!findings) return [];
    const byAsset = assetId === 'all' ? findings : findings.filter((f) => String(f.applicationAssetId ?? f.application?.id) === String(assetId));
    return [...byAsset].sort((a, b) => {
      const sevDiff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
      if (sevDiff !== 0) return sevDiff;
      return (b.riskScore ?? 0) - (a.riskScore ?? 0);
    });
  }, [findings, assetId]);

  if (error) return <ErrorState error={error} onRetry={reload} />;

  const newCount = findings?.filter((f) => f.status === 'new').length ?? 0;
  const investigatingCount = findings?.filter((f) => f.status === 'investigating').length ?? 0;
  const fixedThisWeek = findings?.filter((f) => f.status === 'remediated' && isWithinLastWeek(f.updatedAt)).length ?? 0;

  const handleCopy = async () => {
    if (!visible.length) return;
    const text = visible.map(findingSummaryLine).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(`Copied ${visible.length} finding${visible.length === 1 ? '' : 's'} to your clipboard.`);
    } catch {
      notifyError({ message: 'Could not copy to clipboard — your browser may have blocked it.' });
    }
  };

  const handleDownload = () => {
    if (!visible.length) return;
    const assetLabel = assetId === 'all' ? 'all-assets' : (applications?.find((a) => String(a.id) === String(assetId))?.name || 'asset').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`commandcentre-findings-${assetLabel}-${stamp}.csv`, toCsv(visible), 'text/csv;charset=utf-8');
    notifySuccess(`Downloaded ${visible.length} finding${visible.length === 1 ? '' : 's'} as a CSV file.`);
  };

  return (
    <div>
      <StatCardRow>
        <StatCard label="New" value={newCount} />
        <StatCard label="Being investigated" value={investigatingCount} tone="warning" />
        <StatCard label="Fixed this week" value={fixedThisWeek} tone="ok" />
      </StatCardRow>

      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1.4fr 1fr' : '1fr', gap: 12 }}>
        <Card
          title="Findings — highest priority first"
          right={
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={toolbarBtnStyle} onClick={handleCopy} disabled={!visible.length}>
                Copy
              </button>
              <button style={toolbarBtnStyle} onClick={handleDownload} disabled={!visible.length}>
                Download CSV
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={selectStyle}>
              <option value="all">All assets</option>
              {(applications || []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setSeverity(null)} style={chipBtnStyle(!severity)}>All severities</button>
              <button onClick={() => setSeverity('critical,high')} style={chipBtnStyle(severity === 'critical,high')}>Critical + High</button>
              <button onClick={() => setSeverity('medium')} style={chipBtnStyle(severity === 'medium')}>Medium</button>
              <button onClick={() => setSeverity('low')} style={chipBtnStyle(severity === 'low')}>Low</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.label}
                onClick={() => setStatus(tab.key)}
                style={chipBtnStyle(status === tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading findings…</p>
          ) : visible.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No findings in this view.</p>
          ) : (
            <div>
              {visible.map((f) => (
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
                      <span style={{ fontSize: 11, fontWeight: 700, color: SEVERITY_TONE[f.severity] === 'danger' ? 'var(--danger)' : SEVERITY_TONE[f.severity] === 'warning' ? 'var(--warning)' : 'var(--text-muted)' }}>
                        {SEVERITY_LABEL[f.severity] || f.severity}
                      </span>
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
