import { useApi } from '../hooks/useApi.js';
import { fetchLiveFeed, fetchThreatOrigins, fetchReconDetections, fetchSchedulerState } from '../api/security.js';
import { Card, StatCard, StatCardRow, StatusDot, Chip, Badge, ErrorState } from '../components/ui.jsx';

const SEVERITY_TONE = { info: 'muted', low: 'muted', medium: 'warning', high: 'warning', critical: 'danger' };

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
      <StatCardRow>
        <StatCard label="Events (window)" value={feed.data.total} />
        <StatCard label="Attacks detected" value={origins.data.totalAttacks} />
        <StatCard
          label="Top origin"
          value={origins.data.topCountry ? `${originFlag(origins.data, origins.data.topCountry)} ${origins.data.topCountry}` : '—'}
        />
        <StatCard label="Active scanners" value={recon.data.scannerCount} />
      </StatCardRow>

      <Card title="Live feed" right={<button onClick={reloadAll} style={refreshBtn}>Refresh</button>}>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {feed.data.events.map((e) => (
            <div
              key={e.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 4px',
                borderTop: '1px solid var(--border)',
                fontSize: 12.5,
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', width: 68, flexShrink: 0 }}>
                {new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <StatusDot tone={SEVERITY_TONE[e.severity] || 'warning'} />
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>{e.type}</span>
                <span style={{ color: 'var(--text-muted)' }}> — {e.message}</span>
              </div>
              <div style={{ flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                {e.srcFlag} {e.srcCountry} · {e.srcIp}
                {e.srcThreat && e.srcThreat !== 'internal' && (
                  <span style={{ marginLeft: 6 }}>
                    <Badge tone="high">{e.srcThreat}</Badge>
                  </span>
                )}
                <span style={{ margin: '0 6px' }}>→</span>
                <span style={{ color: 'var(--text)' }}>{e.dstAsset}</span>:{e.dstPort}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card title="Threat origins">
          {origins.data.origins.slice(0, 12).map((o) => (
            <div
              key={o.srcIp}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '1px solid var(--border)', fontSize: 12.5 }}
            >
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {o.flag} {o.city}, {o.country} <span style={{ color: 'var(--text-muted)' }}>({o.org})</span>
              </div>
              <Badge tone="high">{o.threat}</Badge>
              <span style={{ color: 'var(--text-muted)', width: 30, textAlign: 'right' }}>{o.count}</span>
              <Chip tone="muted">{o.critical}/{o.high} crit/high</Chip>
            </div>
          ))}
        </Card>

        <Card title="Recon &amp; scanning activity">
          {recon.data.detections.slice(0, 12).map((d) => (
            <div
              key={d.srcIp}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '1px solid var(--border)', fontSize: 12.5 }}
            >
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.srcFlag} {d.srcIp} <span style={{ color: 'var(--text-muted)' }}>({d.srcOrg})</span>
              </div>
              <Chip tone="muted">{d.portScans} scans</Chip>
              <Chip tone="muted">{d.authFails} auth fails</Chip>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{new Date(d.lastSeen).toLocaleTimeString()}</span>
            </div>
          ))}
        </Card>
      </div>

      <Card title="Are the detection tools actually working?">
        {scheduler.data.state.map((s) => {
          const status = toolStatus(s);
          return (
            <div
              key={s.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderTop: '1px solid var(--border)', fontSize: 13 }}
            >
              <StatusDot tone={status.tone} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{s.name}</span>{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({s.engine})</span>
              </div>
              <span style={{ color: `var(--${status.color})`, fontWeight: 600, whiteSpace: 'nowrap' }}>{status.text}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function originFlag(data, code) {
  const match = data.origins.find((o) => o.country === code);
  return match?.flag || '';
}

function toolStatus(s) {
  if (s.totalRuns === 0) {
    return { tone: 'muted', color: 'text-muted', text: 'Not running yet' };
  }
  if (s.mode === 'active' && s.failureCount === 0) {
    const when = s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : 'unknown time';
    return { tone: 'ok', color: 'success', text: `Working · last ran ${when}` };
  }
  if (s.failureCount > 0) {
    return { tone: 'danger', color: 'danger', text: `Needs attention · ${s.failureCount} failure${s.failureCount === 1 ? '' : 's'}` };
  }
  return { tone: 'warning', color: 'warning', text: 'Needs attention' };
}

const refreshBtn = { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer' };
