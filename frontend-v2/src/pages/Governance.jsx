import { useApi } from '../hooks/useApi.js';
import { fetchAuditLogs, fetchWorkforceTelemetry, fetchPerformance, fetchNotificationLedger, fetchAutomationStatus } from '../api/governance.js';
import { Card, Badge, ErrorState, StatCard, StatCardRow, StatusRow } from '../components/ui.jsx';

const RISK_TONE = { none: 'ok', low: 'medium', high: 'critical' };
const NOTIF_TONE = { delivered: 'ok', read: 'ok', pending: 'medium', failed: 'critical', not_configured: 'low' };
const PRESENCE_TONE = { online: 'ok', offline: 'muted' };

// Cron schedules here are always simple "every N minutes" expressions
// (e.g. "*/10 * * * *"), so translate that one shape into plain language.
// Anything else (a schedule an admin has customized past that pattern)
// falls back to showing the raw cron string rather than guessing.
function describeSchedule(cron) {
  if (!cron) return '—';
  const match = /^\*\/(\d+) \* \* \* \*$/.exec(cron.trim());
  return match ? `every ${match[1]} min` : cron;
}

function locationFor(user) {
  const ip = user.lastSeenIp || user.lastLoginIp || null;
  if (!ip) return 'No IP on record';
  return user.lastSeenGeo ? `${ip} · ${user.lastSeenGeo}` : ip;
}

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
      <StatCardRow>
        <StatCard label="Team members" value={w.summary.totalUsers} />
        <StatCard label="Online now" value={w.summary.onlineUsers} />
        <StatCard label="Stale accounts" value={w.summary.staleAccountCount} tone={w.summary.staleAccountCount > 0 ? 'warning' : undefined} />
        <StatCard label="High risk accounts" value={w.summary.highRiskAccountCount} tone={w.summary.highRiskAccountCount > 0 ? 'danger' : undefined} />
      </StatCardRow>

      <Card title="Team sessions">
        <div>
          {w.users.slice(0, 25).map((u, i) => (
            <StatusRow
              key={u.id}
              tone={PRESENCE_TONE[u.presence] || 'muted'}
              title={`${u.name} ${u.surname}`}
              subtitle={[u.role, ...(u.operationalTeams || [])].filter(Boolean).join(' · ')}
              divider={i > 0}
              right={
                <div style={{ textAlign: 'right' }}>
                  <div>{locationFor(u)}</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                    {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : 'never seen'} · <Badge tone={RISK_TONE[u.staleRiskLevel] || 'low'}>{u.staleRiskLevel}</Badge>
                  </div>
                </div>
              }
            />
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card title="API performance">
          <div>
            {performance.data.routes.slice(0, 15).map((r, i) => (
              <StatusRow
                key={`${r.method}-${r.route}`}
                tone={r.errorRate > 0 ? 'danger' : 'ok'}
                title={`${r.method} ${r.route}`}
                divider={i > 0}
                right={
                  <span>
                    {r.p95Ms}ms · {(r.errorRate * 100).toFixed(1)}% errors
                  </span>
                }
              />
            ))}
          </div>
        </Card>

        <Card title="Automation status">
          <div>
            <StatusRow
              tone={a.networkEnabled ? 'ok' : 'muted'}
              title="Network device scanning"
              subtitle={`Passive scan ${describeSchedule(a.schedules?.devicePassive)} · IDS check ${describeSchedule(a.schedules?.deviceIds)}`}
              right={a.networkEnabled ? 'On' : 'Off'}
              divider={false}
            />
            <StatusRow
              tone={a.databaseEnabled ? 'ok' : 'muted'}
              title="Database review"
              subtitle={`Runs ${describeSchedule(a.schedules?.databaseReview)}`}
              right={a.databaseEnabled ? 'On' : 'Off'}
            />
            <StatusRow
              tone={a.autoCreateTickets ? 'ok' : 'muted'}
              title="Auto-create tickets"
              subtitle="Opens a ticket automatically when automation finds an issue"
              right={a.autoCreateTickets ? 'On' : 'Off'}
            />
          </div>
        </Card>
      </div>

      <Card title="Notification ledger">
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {ledger.data.slice(0, 40).map((n, i) => (
            <StatusRow
              key={n.id}
              tone={NOTIF_TONE[n.status] === 'ok' ? 'ok' : NOTIF_TONE[n.status] === 'critical' ? 'danger' : 'muted'}
              title={`${n.username} — ${n.subject}`}
              subtitle={n.channel}
              divider={i > 0}
              right={
                <div style={{ textAlign: 'right' }}>
                  <Badge tone={NOTIF_TONE[n.status] || 'medium'}>{n.status}</Badge>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              }
            />
          ))}
        </div>
      </Card>

      <Card title="Audit log">
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {audit.data.slice(0, 60).map((entry, i) => (
            <StatusRow
              key={entry.id}
              title={`${entry.actor} ${entry.action} on ${entry.entityType} #${entry.entityId}`}
              subtitle={entry.actorRole}
              divider={i > 0}
              right={<span style={{ color: 'var(--text-muted)' }}>{new Date(entry.createdAt).toLocaleString()}</span>}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
