import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { fetchMonthlyReport, fetchExecutiveReport, fetchTechnicalReport, downloadExecutivePdf, downloadTechnicalCsv } from '../api/reports.js';
import { Card, KpiRow, Kpi, StatCard, StatCardRow, Badge, ErrorState, FeedbackBanner } from '../components/ui.jsx';
import BarBreakdown from '../components/charts/BarBreakdown.jsx';

const POSTURE_TONE = { 'high-risk': 'critical', watch: 'high', controlled: 'ok' };

function toRows(obj, colors = {}) {
  return Object.entries(obj || {}).map(([label, value]) => ({ label, value, color: colors[label] }));
}

const downloadButtonStyle = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'transparent',
  color: 'var(--accent)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function Reports() {
  const monthly = useApi(fetchMonthlyReport, []);
  const executive = useApi(fetchExecutiveReport, []);
  const technical = useApi(fetchTechnicalReport, []);
  const { feedback, notifyError, clear } = useActionFeedback();
  const [downloading, setDownloading] = useState(null); // 'pdf' | 'csv' | null

  const anyError = monthly.error || executive.error || technical.error;
  const anyLoading = monthly.loading || executive.loading || technical.loading;

  if (anyError) return <ErrorState error={anyError} onRetry={() => { monthly.reload(); executive.reload(); technical.reload(); }} />;
  if (anyLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading reports…</p>;

  const exec = executive.data;
  const tech = technical.data;

  const handleDownload = async (kind) => {
    setDownloading(kind);
    clear();
    try {
      if (kind === 'pdf') await downloadExecutivePdf();
      else await downloadTechnicalCsv();
    } catch (err) {
      notifyError(err, 'Failed to download that report.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <FeedbackBanner feedback={feedback} onDismiss={clear} />

      <Card title="Executive summary" right={<Badge tone={POSTURE_TONE[exec.posture] || 'medium'}>{exec.posture}</Badge>}>
        <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px', lineHeight: 1.4 }}>{exec.headline}</p>
        <StatCardRow>
          <StatCard label="Risk index" value={exec.riskIndex} />
          <StatCard label="Active tickets" value={exec.metrics.activeTickets} />
          <StatCard label="Critical open" value={exec.metrics.criticalOpen} tone={exec.metrics.criticalOpen > 0 ? 'danger' : undefined} />
          <StatCard label="Resolved this month" value={exec.metrics.resolvedThisMonth} />
        </StatCardRow>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card title="Open tickets by priority">
          <BarBreakdown rows={toRows(tech.openByPriority, { critical: 'var(--danger)', high: 'var(--warning)' })} />
        </Card>
        <Card title="Findings by severity">
          <BarBreakdown rows={toRows(tech.findingsBySeverity, { critical: 'var(--danger)', high: 'var(--warning)' })} />
        </Card>
      </div>

      <Card title="Lifecycle spread">
        <BarBreakdown rows={toRows(tech.lifecycleSpread)} />
      </Card>

      <Card title="This month">
        <KpiRow>
          <Kpi label="Total tickets" value={monthly.data.total} />
          <Kpi label="Created" value={monthly.data.created} />
          <Kpi label="Closed" value={monthly.data.closed} />
          <Kpi label="Overdue actions" value={tech.overdueActions} deltaColor={tech.overdueActions > 0 ? 'var(--danger)' : undefined} />
        </KpiRow>
      </Card>

      <Card title="Download reports">
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Export the current report data as a document to share with a customer or auditor.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            disabled={downloading !== null}
            onClick={() => handleDownload('pdf')}
            style={{ ...downloadButtonStyle, opacity: downloading === 'pdf' ? 0.6 : 1 }}
          >
            {downloading === 'pdf' ? 'Preparing PDF…' : 'Executive summary (PDF)'}
          </button>
          <button
            disabled={downloading !== null}
            onClick={() => handleDownload('csv')}
            style={{ ...downloadButtonStyle, opacity: downloading === 'csv' ? 0.6 : 1 }}
          >
            {downloading === 'csv' ? 'Preparing CSV…' : 'Technical breakdown (CSV)'}
          </button>
        </div>
      </Card>
    </div>
  );
}
