import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { fetchApplications, fetchNetworkDevices, fetchDatabaseAssets, fetchFindings } from '../api/security.js';
import { Card, ErrorState, StatCard, StatCardRow } from '../components/ui.jsx';
import FindingDetail from './FindingDetail.jsx';

function isRecentlyUpdated(dateString, days = 7) {
  if (!dateString) return false;
  return Date.now() - new Date(dateString).getTime() <= days * 24 * 60 * 60 * 1000;
}

function assetStatus(app) {
  if (app.enforcementModel === 'none') return { color: 'var(--danger)', label: 'Not set up' };
  if (app.verificationStatus !== 'verified') return { color: 'var(--warning)', label: 'Waiting to confirm' };
  return { color: 'var(--success)', label: 'Protected' };
}

// Everything here is fetched through the exact same endpoints admin/analyst
// use — the backend itself scopes every result down to assets/findings this
// signed-in owner actually owns (see scopeAssetWhereToOwner and
// scopeChildAssetWhereToOwner in routes/security.js). Nothing here is
// filtered client-side; there is no unscoped data to accidentally leak.
export default function OwnerDashboard() {
  const apps = useApi(fetchApplications, []);
  const devices = useApi(fetchNetworkDevices, []);
  const databases = useApi(fetchDatabaseAssets, []);
  const findings = useApi(() => fetchFindings(), []);
  const [selected, setSelected] = useState(null);

  const anyError = apps.error || devices.error || databases.error || findings.error;
  const anyLoading = apps.loading || devices.loading || databases.loading || findings.loading;
  const reloadAll = () => { apps.reload(); devices.reload(); databases.reload(); findings.reload(); };

  if (anyError) return <ErrorState error={anyError} onRetry={reloadAll} />;
  if (anyLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading your assets…</p>;

  const applications = apps.data || [];
  const allFindings = findings.data || [];
  const openFindings = allFindings.filter((f) => ['new', 'investigating'].includes(f.status));
  const criticalOpen = openFindings.filter((f) => f.severity === 'critical').length;
  const resolvedThisWeek = allFindings.filter((f) => f.status === 'remediated' && isRecentlyUpdated(f.updatedAt)).length;

  const devicesByApp = new Map();
  for (const d of devices.data || []) {
    if (!devicesByApp.has(d.applicationAssetId)) devicesByApp.set(d.applicationAssetId, []);
    devicesByApp.get(d.applicationAssetId).push(d);
  }
  const databasesByApp = new Map();
  for (const d of databases.data || []) {
    if (!databasesByApp.has(d.applicationAssetId)) databasesByApp.set(d.applicationAssetId, []);
    databasesByApp.get(d.applicationAssetId).push(d);
  }

  return (
    <div>
      <p style={{ fontSize: 20, fontWeight: 500, margin: '0 0 4px' }}>Your assets</p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
        A private view of everything registered under your name — what's being watched, what needs attention, and what's already been handled.
      </p>

      <StatCardRow>
        <StatCard label="Your assets" value={applications.length} />
        <StatCard label="Open threats" value={openFindings.length} tone={openFindings.length > 0 ? 'warning' : undefined} />
        <StatCard label="Critical" value={criticalOpen} tone={criticalOpen > 0 ? 'danger' : undefined} />
        <StatCard label="Resolved this week" value={resolvedThisWeek} tone="ok" />
      </StatCardRow>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16 }}>
        <div>
          <Card title="Your assets">
            {applications.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No assets registered under your name yet.</p>
            ) : (
              applications.map((app, i) => {
                const status = assetStatus(app);
                const children = [...(devicesByApp.get(app.id) || []), ...(databasesByApp.get(app.id) || [])];
                return (
                  <div key={app.id} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{app.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: status.color }}>{status.label}</span>
                    </div>
                    {children.map((child) => (
                      <div key={`${child.id}-${child.name}`} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{child.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: child.state === 'online' ? 'var(--success)' : child.state === 'offline' ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {child.state === 'online' ? 'Healthy' : child.state === 'offline' ? 'Down' : child.state || 'Unknown'}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </Card>

          <Card title={`Threats on your assets (${openFindings.length} open)`}>
            {allFindings.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Nothing has ever been detected on your assets — a clean record.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {allFindings.map((f, i) => (
                  <div
                    key={f.id}
                    onClick={() => setSelected(f)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 4px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                      cursor: 'pointer',
                      background: selected?.id === f.id ? 'var(--accent-soft)' : 'transparent',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.severity === 'critical' || f.severity === 'high' ? 'var(--danger)' : f.severity === 'medium' ? 'var(--warning)' : 'var(--text-muted)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, margin: 0 }}>{f.title}</p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{f.application?.name || 'Unknown asset'}</p>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', color: f.status === 'remediated' ? 'var(--success)' : f.status === 'dismissed' ? 'var(--text-muted)' : 'var(--warning)' }}>
                      {f.status === 'remediated' ? 'Fixed' : f.status === 'dismissed' ? 'Dismissed' : f.status === 'investigating' ? 'Being worked on' : 'New'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {selected && (
          <FindingDetail
            finding={selected}
            onClose={() => setSelected(null)}
            onChanged={() => { reloadAll(); setSelected(null); }}
            readOnly
          />
        )}
      </div>
    </div>
  );
}
