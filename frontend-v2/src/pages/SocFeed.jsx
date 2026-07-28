import { useApi } from '../hooks/useApi.js';
import { fetchLiveFeed, fetchThreatOrigins, fetchReconDetections, fetchSchedulerState } from '../api/security.js';
import { Card, KpiRow, Kpi, Badge, ErrorState } from '../components/ui.jsx';

const SEVERITY_TONE = { info: 'low', low: 'low', medium: 'medium', high: 'high', critical: 'critical' };

export default function SocFeed() {
  const feed = useApi(fetchLiveFeed, []);
  const origins = useApi(fetchThreatOrigins, []);
  const recon = useApi(fetchReconDetections, []);
  const scheduler = useApi(fetchSchedulerState, []);

  const anyError = feed.error || origins.error || recon.error || scheduler.error;
  const anyLoading = feed.loading || origins.loading || recon.loading || scheduler.loading;

  const reloadAll = () => {
    feed.reload();
    origins.reload();
    recon.reload();
    scheduler.reload();
  };

  if (anyError) return <ErrorState error={anyError} onRetry={reloadAll} />;
  if (anyLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading SOC feed…</p>;

  return (
    <div>
      <KpiRow>
        <Kpi label="Events (window)" value={feed.data.total} />
        <Kpi label="Total attacks" value={origins.data.totalAttacks} />
        <Kpi label="Top origin" value={origins.data.topCountry ? `${originFlag(origins.data, origins.data.topCountry)} ${origins.data.topCountry}` : '—'} />
        <Kpi label="Active scanners" value={recon.data.scannerCount} />
      </KpiRow>

      <Card title="Live feed" right={<button onClick={reloadAll} style={refreshBtn}>Refresh</button>}>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Destination</th>
                <th style={thStyle}>Message</th>
              </tr>
            </thead>
            <tbody>
              {feed.data.events.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                  <td style={tdStyle}>
                    <Badge tone={SEVERITY_TONE[e.severity] || 'medium'}>{e.severity}</Badge>
                  </td>
                  <td style={tdStyle}>{e.type}</td>
                  <td style={tdStyle}>
                    {e.srcFlag} {e.srcCountry} · {e.srcIp} {e.srcThreat && e.srcThreat !== 'internal' && <Badge tone="high">{e.srcThreat}</Badge>}
                  </td>
                  <td style={tdStyle}>{e.dstAsset} :{e.dstPort}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card title="Threat origins">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Origin</th>
                <th style={thStyle}>Threat</th>
                <th style={thStyle}>Count</th>
                <th style={thStyle}>Crit/High</th>
              </tr>
            </thead>
            <tbody>
              {origins.data.origins.slice(0, 12).map((o) => (
                <tr key={o.srcIp} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{o.flag} {o.city}, {o.country} ({o.org})</td>
                  <td style={tdStyle}><Badge tone="high">{o.threat}</Badge></td>
                  <td style={tdStyle}>{o.count}</td>
                  <td style={tdStyle}>{o.critical}/{o.high}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Recon &amp; scanning activity">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Port scans</th>
                <th style={thStyle}>Auth fails</th>
                <th style={thStyle}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {recon.data.detections.slice(0, 12).map((d) => (
                <tr key={d.srcIp} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{d.srcFlag} {d.srcIp} ({d.srcOrg})</td>
                  <td style={tdStyle}>{d.portScans}</td>
                  <td style={tdStyle}>{d.authFails}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{new Date(d.lastSeen).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Detection tooling health">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr>
              <th style={thStyle}>Tool</th>
              <th style={thStyle}>Mode</th>
              <th style={thStyle}>Runs</th>
              <th style={thStyle}>Failures</th>
              <th style={thStyle}>Last success</th>
            </tr>
          </thead>
          <tbody>
            {scheduler.data.state.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={tdStyle}>{s.name} <span style={{ color: 'var(--text-muted)' }}>({s.engine})</span></td>
                <td style={tdStyle}>
                  <Badge tone={s.mode === 'active' ? 'ok' : 'medium'}>{s.mode}</Badge>
                </td>
                <td style={tdStyle}>{s.totalRuns}</td>
                <td style={tdStyle}>
                  <Badge tone={s.failureCount > 0 ? 'high' : 'ok'}>{s.failureCount}</Badge>
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function originFlag(data, code) {
  const match = data.origins.find((o) => o.country === code);
  return match?.flag || '';
}

const thStyle = { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const tdStyle = { padding: '7px 8px' };
const refreshBtn = { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer' };
