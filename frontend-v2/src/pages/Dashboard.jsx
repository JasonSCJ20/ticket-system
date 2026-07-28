import { useApi } from '../hooks/useApi.js';
import { fetchCommandCentre } from '../api/assistant.js';
import { fetchExecutiveMetrics } from '../api/tickets.js';
import { fetchExecutiveImpact } from '../api/security.js';
import { Card, KpiRow, Kpi, Badge, ErrorState } from '../components/ui.jsx';
import BarBreakdown from '../components/charts/BarBreakdown.jsx';
import Donut from '../components/charts/Donut.jsx';

export default function Dashboard() {
  const commandCentre = useApi(fetchCommandCentre, []);
  const ticketMetrics = useApi(fetchExecutiveMetrics, []);
  const impact = useApi(fetchExecutiveImpact, []);

  const loading = commandCentre.loading || ticketMetrics.loading || impact.loading;
  const error = commandCentre.error || ticketMetrics.error || impact.error;

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          commandCentre.reload();
          ticketMetrics.reload();
          impact.reload();
        }}
      />
    );
  }
  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading command centre…</p>;

  const cc = commandCentre.data;
  const tm = ticketMetrics.data;
  const imp = impact.data;
  const pressure = cc.fortressContext;

  return (
    <div>
      <KpiRow>
        <Kpi label="Open tickets" value={cc.summary.openTickets} delta={`${cc.summary.assignedOpenTickets} assigned to you`} />
        <Kpi
          label="Critical findings"
          value={pressure.criticalFindings}
          delta={pressure.criticalFindings > 0 ? 'Needs review' : 'None open'}
          deltaColor={pressure.criticalFindings > 0 ? 'var(--danger)' : 'var(--success)'}
        />
        <Kpi
          label="SLA breaches"
          value={tm.slaBreached}
          delta={`of ${tm.activeTickets} active`}
        />
        <Kpi
          label="Risk index"
          value={<>{imp.riskIndex}<span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/100</span></>}
          delta={<Badge tone={imp.postureBand}>{imp.postureBand}</Badge>}
        />
      </KpiRow>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
        <Card title="What's driving incident pressure">
          <BarBreakdown
            rows={[
              { label: 'Critical findings ×20', value: pressure.criticalFindings * 20, color: 'var(--danger)' },
              { label: 'High findings ×9', value: pressure.highFindings * 9, color: 'var(--warning)' },
              { label: 'Blocked actions ×7', value: pressure.blockedActions * 7, color: 'var(--accent)' },
              { label: 'Stale alerts (>24h) ×6', value: pressure.staleAlerts * 6, color: 'var(--text-muted)' },
            ]}
            max={100}
          />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Combined pressure score: {pressure.incidentPressureScore}/100
          </p>
        </Card>
        <Card title="Findings snapshot" style={{ textAlign: 'center' }}>
          <Donut
            size={110}
            centerLabel={cc.summary.activeFindings}
            segments={[
              { value: pressure.criticalFindings, color: 'var(--danger)' },
              { value: pressure.highFindings, color: 'var(--warning)' },
              { value: Math.max(cc.summary.activeFindings - pressure.criticalFindings - pressure.highFindings, 0), color: 'var(--accent)' },
            ]}
          />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, flexWrap: 'wrap' }}>
            <span>Critical {pressure.criticalFindings}</span>
            <span>High {pressure.highFindings}</span>
            <span>Active total {cc.summary.activeFindings}</span>
          </div>
        </Card>
      </div>

      <Card title={`Posture: ${imp.postureBand}`}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{imp.nonTechnicalSummary}</p>
      </Card>

      <Card title="Top priorities">
        {imp.topRisks.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No high-risk findings right now.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {imp.topRisks.map((risk) => (
                <tr key={risk.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 8px', width: 70 }}>
                    <Badge tone={risk.riskBand}>{risk.riskBand}</Badge>
                  </td>
                  <td style={{ padding: '8px 8px' }}>
                    <div>{risk.plainLanguage}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{risk.application} · {risk.recommendedAction}</div>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{risk.riskScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Assigned to you">
        {cc.assignedTickets.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing assigned right now.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {cc.assignedTickets.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 8px', width: 70 }}>
                    <Badge tone={t.priority}>{t.priority}</Badge>
                  </td>
                  <td style={{ padding: '8px 8px' }}>{t.title}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{t.lifecycleStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
