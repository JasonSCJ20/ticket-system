import { useApi } from '../hooks/useApi.js';
import { fetchFortressPosture, fetchApplications, fetchNetworkDevices, fetchDatabaseAssets, fetchFindings } from '../api/security.js';
import { Card, ErrorState, StatCard, StatCardRow } from '../components/ui.jsx';

const CONTROL_LABELS = {
  identity: 'Sign-in and access control',
  patching: 'Patching',
  dataProtection: 'Data protection',
  recovery: 'Backups and recovery',
  detection: 'Detection tools',
  telemetry: 'Telemetry',
};

const CONTROL_COLOR = { controlled: 'var(--success)', watch: 'var(--warning)', critical: 'var(--danger)' };
const CONTROL_LABEL_TEXT = { controlled: 'Healthy', watch: 'Degraded', critical: 'Critical' };

function assetProtectionStatus(app) {
  if (app.enforcementModel === 'none') return { tone: 'danger', label: 'Not set up' };
  if (app.verificationStatus !== 'verified') return { tone: 'warning', label: 'Waiting to confirm' };
  if (app.enforcementMode !== 'active') return { tone: 'warning', label: 'Watching only' };
  return { tone: 'ok', label: 'Protected' };
}

function isRecentlyUpdated(dateString, days = 7) {
  if (!dateString) return false;
  return Date.now() - new Date(dateString).getTime() <= days * 24 * 60 * 60 * 1000;
}

export default function Dashboard() {
  const posture = useApi(fetchFortressPosture, []);
  const apps = useApi(fetchApplications, []);
  const devices = useApi(fetchNetworkDevices, []);
  const databases = useApi(fetchDatabaseAssets, []);
  // Ask the server for exactly the two slices this page needs, rather than
  // fetching every finding and filtering client-side — the finding list is
  // capped server-side, and an unfiltered fetch can silently drop open
  // high/critical findings behind older resolved ones once an org has a
  // long history, undercounting "needs a decision" vs. what the Findings
  // tab shows when filtered to the same statuses.
  const priorityFindingsApi = useApi(() => fetchFindings({ status: 'new,investigating', severity: 'high,critical' }), []);
  const resolvedFindingsApi = useApi(() => fetchFindings({ status: 'remediated' }), []);

  const anyError = posture.error || apps.error || devices.error || databases.error || priorityFindingsApi.error || resolvedFindingsApi.error;
  const anyLoading = posture.loading || apps.loading || devices.loading || databases.loading || priorityFindingsApi.loading || resolvedFindingsApi.loading;
  const reloadAll = () => { posture.reload(); apps.reload(); devices.reload(); databases.reload(); priorityFindingsApi.reload(); resolvedFindingsApi.reload(); };

  if (anyError) return <ErrorState error={anyError} onRetry={reloadAll} />;
  if (anyLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading overview…</p>;

  const p = posture.data;
  const applications = apps.data || [];
  const allDevices = devices.data || [];
  const allDatabases = databases.data || [];

  const priorityFindings = (priorityFindingsApi.data || []).sort((a, b) => b.riskScore - a.riskScore);
  const resolvedThisWeek = (resolvedFindingsApi.data || []).filter((f) => isRecentlyUpdated(f.updatedAt)).length;

  // Group each device/database under the application it belongs to (see
  // applicationAssetId on those models) rather than showing them as
  // unrelated top-level rows — devices/databases with no link stay flat.
  const devicesByApp = new Map();
  const orphanDevices = [];
  for (const d of allDevices) {
    if (d.applicationAssetId) {
      if (!devicesByApp.has(d.applicationAssetId)) devicesByApp.set(d.applicationAssetId, []);
      devicesByApp.get(d.applicationAssetId).push(d);
    } else orphanDevices.push(d);
  }
  const databasesByApp = new Map();
  const orphanDatabases = [];
  for (const d of allDatabases) {
    if (d.applicationAssetId) {
      if (!databasesByApp.has(d.applicationAssetId)) databasesByApp.set(d.applicationAssetId, []);
      databasesByApp.get(d.applicationAssetId).push(d);
    } else orphanDatabases.push(d);
  }

  const needsDecisionCount = priorityFindings.length;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '1rem 1.25rem',
          borderRadius: 12,
          marginBottom: 24,
          background: needsDecisionCount > 0 ? 'var(--warning-soft)' : 'var(--success-soft)',
        }}
      >
        <div>
          <p style={{ fontSize: 16, fontWeight: 500, margin: 0, color: needsDecisionCount > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {needsDecisionCount > 0 ? `${needsDecisionCount} thing${needsDecisionCount === 1 ? '' : 's'} need${needsDecisionCount === 1 ? 's' : ''} your decision` : 'Everything is currently under control'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Everything else across Fortress and your {applications.length} asset{applications.length === 1 ? '' : 's'} is healthy and being watched.
          </p>
        </div>
      </div>

      <StatCardRow>
        <StatCard label="Your assets" value={applications.length} />
        <StatCard label="Needs a decision" value={needsDecisionCount} tone={needsDecisionCount > 0 ? 'danger' : undefined} />
        <StatCard label="Resolved this week" value={resolvedThisWeek} tone="ok" />
        <StatCard
          label="CommandCentre itself"
          value={p.postureBand === 'fortified' ? 'Secure' : p.postureBand === 'defensible' ? 'Stable' : 'Attention needed'}
          tone={p.postureBand === 'fortified' ? 'ok' : p.postureBand === 'defensible' ? undefined : 'danger'}
        />
      </StatCardRow>

      {priorityFindings.length > 0 && (
        <>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', margin: '0 0 8px' }}>Needs your decision</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {priorityFindings.slice(0, 5).map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.severity === 'critical' ? 'var(--danger)' : 'var(--warning)', marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, margin: 0 }}>
                    {f.title} <span style={{ color: 'var(--text-muted)' }}>on {f.application?.name || 'Unknown asset'}</span>
                  </p>
                  {f.remediationRecommendation && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0 0' }}>{f.remediationRecommendation}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <Card title="Fortress — CommandCentre's own health">
          {Object.entries(p.controls).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span style={{ fontSize: 13 }}>{CONTROL_LABELS[key] || key}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: CONTROL_COLOR[value] || 'var(--text-muted)' }}>
                {CONTROL_LABEL_TEXT[value] || value}
              </span>
            </div>
          ))}
        </Card>

        <Card title="Your registered assets">
          {applications.length === 0 && orphanDevices.length === 0 && orphanDatabases.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No assets registered yet.</p>
          ) : (
            <>
              {applications.map((app, i) => {
                const status = assetProtectionStatus(app);
                const children = [...(devicesByApp.get(app.id) || []), ...(databasesByApp.get(app.id) || [])];
                return (
                  <div key={app.id} style={{ padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{app.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: status.tone === 'ok' ? 'var(--success)' : status.tone === 'warning' ? 'var(--warning)' : 'var(--danger)' }}>{status.label}</span>
                    </div>
                    {children.map((child) => (
                      <div key={`${child.id}-${child.name}`} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{child.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: child.state === 'online' ? 'var(--success)' : child.state === 'offline' ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {child.state === 'online' ? 'Healthy' : child.state === 'offline' ? 'Down' : child.state}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {[...orphanDevices, ...orphanDatabases].map((asset, i) => (
                <div key={`${asset.id}-orphan`} style={{ padding: '8px 0', borderTop: applications.length === 0 && i === 0 ? 'none' : '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 14 }}>{asset.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: asset.state === 'online' ? 'var(--success)' : asset.state === 'offline' ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {asset.state === 'online' ? 'Healthy' : asset.state === 'offline' ? 'Down' : asset.state}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
