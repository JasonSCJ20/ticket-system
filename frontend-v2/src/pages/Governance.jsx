import { useApi } from '../hooks/useApi.js';
import { fetchAuditLogs, fetchWorkforceTelemetry, fetchPerformance, fetchNotificationLedger, fetchAutomationStatus } from '../api/governance.js';
import { Card, KpiRow, Kpi, Badge, ErrorState } from '../components/ui.jsx';

const RISK_TONE = { none: 'ok', low: 'medium', high: 'critical' };
const NOTIF_TONE = { delivered: 'ok', read: 'ok', pending: 'medium', failed: 'critical', not_configured: 'low' };

export default function Governance() {
  const workforce = useApi(fetchWorkforceTelemetry, []);
  const performance = useApi(fetchPerformance, []);
  const ledger = useApi(fetchNotificationLedger, []);
  const automation = useApi(fetchAutomationStatus, []);
  const audit = useApi(fetchAuditLogs, []);

  const anyError = workforce.error || performance.error || ledger.error || automation.error || audit.error;
  const anyLoading = workforce.loading || performance.loading || ledger.loading || automation.loading || audit.loading;

  const reloadAll = () => {
    workforce.reload();
    performance.reload();
    ledger.reload();
    automation.reload();
    audit.reload();
  };

  if (anyError) return <ErrorState error={anyError} onRetry={reloadAll} />;
  if (anyLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading governance data…</p>;

  const w = workforce.data;
  const a = automation.data;

  return (
    <div>
      <Card title="Workforce">
        <KpiRow>
          <Kpi label="Total users" value={w.summary.totalUsers} />
          <Kpi label="Online now" value={w.summary.onlineUsers} />
          <Kpi label="Stale accounts" value={w.summary.staleAccountCount} deltaColor={w.summary.staleAccountCount > 0 ? 'var(--warning)' : undefined} />
          <Kpi label="High risk accounts" value={w.summary.highRiskAccountCount} deltaColor={w.summary.highRiskAccountCount > 0 ? 'var(--danger)' : undefined} />
        </KpiRow>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Presence</th>
              <th style={thStyle}>Last seen</th>
              <th style={thStyle}>Risk</th>
            </tr>
          </thead>
          <tbody>
            {w.users.slice(0, 25).map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={tdStyle}>{u.name} {u.surname}</td>
                <td style={tdStyle}>{u.role}</td>
                <td style={tdStyle}><Badge tone={u.presence === 'online' ? 'ok' : 'low'}>{u.presence}</Badge></td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : 'never'}</td>
                <td style={tdStyle}><Badge tone={RISK_TONE[u.staleRiskLevel] || 'low'}>{u.staleRiskLevel}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card title="API performance">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Route</th>
                <th style={thStyle}>p95</th>
                <th style={thStyle}>Error rate</th>
              </tr>
            </thead>
            <tbody>
              {performance.data.routes.slice(0, 15).map((r) => (
                <tr key={`${r.method}-${r.route}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{r.method} {r.route}</td>
                  <td style={tdStyle}>{r.p95Ms}ms</td>
                  <td style={tdStyle}><Badge tone={r.errorRate > 0 ? 'high' : 'ok'}>{(r.errorRate * 100).toFixed(1)}%</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Automation status">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <Badge tone={a.networkEnabled ? 'ok' : 'low'}>network {a.networkEnabled ? 'on' : 'off'}</Badge>
            <Badge tone={a.databaseEnabled ? 'ok' : 'low'}>database {a.databaseEnabled ? 'on' : 'off'}</Badge>
            <Badge tone={a.autoCreateTickets ? 'ok' : 'low'}>auto-ticket {a.autoCreateTickets ? 'on' : 'off'}</Badge>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            <div>Device passive scan: every {a.schedules?.devicePassive ?? '—'} min</div>
            <div>Device IDS check: every {a.schedules?.deviceIds ?? '—'} min</div>
            <div>Database review: every {a.schedules?.databaseReview ?? '—'} min</div>
          </div>
        </Card>
      </div>

      <Card title="Notification ledger">
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Channel</th>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data.slice(0, 40).map((n) => (
                <tr key={n.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{n.username}</td>
                  <td style={tdStyle}>{n.channel}</td>
                  <td style={tdStyle}>{n.subject}</td>
                  <td style={tdStyle}><Badge tone={NOTIF_TONE[n.status] || 'medium'}>{n.status}</Badge></td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{new Date(n.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Audit log">
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Actor</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Entity</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.slice(0, 60).map((entry) => (
                <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{entry.actor} <span style={{ color: 'var(--text-muted)' }}>({entry.actorRole})</span></td>
                  <td style={tdStyle}>{entry.action}</td>
                  <td style={tdStyle}>{entry.entityType} #{entry.entityId}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{new Date(entry.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const thStyle = { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const tdStyle = { padding: '7px 8px' };
