import { useApi } from '../hooks/useApi.js';
import { fetchMonthlyReport, fetchExecutiveReport, fetchTechnicalReport } from '../api/reports.js';
import { Card, KpiRow, Kpi, Badge, ErrorState } from '../components/ui.jsx';
import BarBreakdown from '../components/charts/BarBreakdown.jsx';

const POSTURE_TONE = { 'high-risk': 'critical', watch: 'high', controlled: 'ok' };

function toRows(obj, colors = {}) {
  return Object.entries(obj || {}).map(([label, value]) => ({ label, value, color: colors[label] }));
}

export default function Reports() {
  const monthly = useApi(fetchMonthlyReport, []);
  const executive = useApi(fetchExecutiveReport, []);
  const technical = useApi(fetchTechnicalReport, []);

  const anyError = monthly.error || executive.error || technical.error;
  const anyLoading = monthly.loading || executive.loading || technical.loading;

  if (anyError) return <ErrorState error={anyError} onRetry={() => { monthly.reload(); executive.reload(); technical.reload(); }} />;
  if (anyLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading reports…</p>;

  const exec = executive.data;
  const tech = technical.data;

  return (
    <div>
      <Card title="Executive summary" right={<Badge tone={POSTURE_TONE[exec.posture] || 'medium'}>{exec.posture}</Badge>}>
        <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 12px' }}>{exec.headline}</p>
        <KpiRow>
          <Kpi label="Risk index" value={exec.riskIndex} />
          <Kpi label="Active tickets" value={exec.metrics.activeTickets} />
          <Kpi label="Critical open" value={exec.metrics.criticalOpen} deltaColor={exec.metrics.criticalOpen > 0 ? 'var(--danger)' : undefined} />
          <Kpi label="Resolved this month" value={exec.metrics.resolvedThisMonth} />
        </KpiRow>
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
    </div>
  );
}
