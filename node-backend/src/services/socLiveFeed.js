// ─── Ring Buffer ──────────────────────────────────────────────────────────────
// Previously seeded with 50 fabricated historical events on load and topped
// up with 3-7 more fake ones every 2 minutes (fictional nation-state actor
// IPs/geolocations, invented CVE "probes", invented data-exfil alerts) —
// none of it reflected anything that actually happened. Now the ring starts
// empty and is populated only by real activity: pushFindingEvent() (called
// from ingestFinding for every genuinely new SecurityFinding) and
// pushScanToolEvent() (called after each real scan-run). An empty feed
// until something real happens is more honest than a permanently-full fake
// one.
const RING_CAP = 500;
const eventRing = [];
let nextId = 1;

// ─── Public: push a pre-built or partial event ───────────────────────────────
export function pushEvent(event) {
  if (!event.id) event.id = nextId++;
  eventRing.push(event);
  if (eventRing.length > RING_CAP) eventRing.shift();
}

// ─── Public: push a real security finding into the live feed ────────────────
// Only ever called for a genuinely new SecurityFinding (ingestFinding skips
// this on the dedup/re-seen path) — every field here comes from the finding
// itself, not a fabricated pool. `evidence` may (not must) carry a real
// sourceIp emitted by whichever detector reported the finding (sentinel,
// agent, a scanner) — parsed best-effort, never invented if absent.
export function pushFindingEvent(finding) {
  let srcIp = null;
  try {
    const parsed = JSON.parse(finding.evidence || '{}');
    if (parsed && typeof parsed.sourceIp === 'string') srcIp = parsed.sourceIp;
  } catch {
    // evidence isn't JSON, or has no sourceIp — omit it rather than guess.
  }

  pushEvent({
    id: nextId++,
    timestamp: new Date().toISOString(),
    type: finding.category || 'finding',
    severity: finding.severity,
    tool: finding.sourceTool,
    srcIp,
    dstIp: finding.affectedAssetRef || null,
    dstAsset: finding.affectedAssetRef || null,
    dstAssetType: finding.affectedAssetType || 'application',
    message: `${finding.sourceTool}: ${finding.title}`,
  });
}

// ─── Public: push a tool-executed scan event into the feed ───────────────────
export function pushScanToolEvent({ toolName, toolId, assetIp, assetName, assetType, findingCount = 0, status = 'completed' }) {
  const severity = findingCount > 0 ? (findingCount >= 3 ? 'high' : 'medium') : 'info';
  const message  = findingCount > 0
    ? `${toolName} scan completed on ${assetName} (${assetIp}) — ${findingCount} finding(s) detected [status=${status}]`
    : `${toolName} scan completed on ${assetName} (${assetIp}) — CLEAN, no findings [status=${status}]`;

  pushEvent({
    id:           nextId++,
    timestamp:    new Date().toISOString(),
    type:         'scan-run',
    severity,
    tool:         toolName,
    srcIp:        '127.0.0.1',
    srcCountry:   'ZA',
    srcFlag:      '🛡️',
    srcCity:      'Fortress Engine',
    srcOrg:       'Internal Security Stack',
    srcThreat:    'internal',
    dstIp:        assetIp  || '0.0.0.0',
    dstPort:      0,
    dstAsset:     assetName || 'Unknown Asset',
    dstAssetType: assetType || 'unknown',
    message,
    status,
    toolId,
    findingCount,
  });
}

// ─── Public API: query the live feed ─────────────────────────────────────────
export function getLiveFeed({ limit = 60, since = null } = {}) {
  let result = [...eventRing];
  if (since) {
    const sinceTs = new Date(since).getTime();
    if (!Number.isNaN(sinceTs)) {
      result = result.filter((e) => new Date(e.timestamp).getTime() > sinceTs);
    }
  }
  return result.reverse().slice(0, limit); // newest first
}

// ─── Public API: get attack origins aggregated from ring ─────────────────────
// Only populates once real events carry geolocation data (not built yet —
// see the "worth adding: real GeoIP enrichment" note where pushFindingEvent
// is used). Returns an empty list rather than fabricated countries/orgs
// until that exists.
export function getThreatOrigins() {
  const byCountry = new Map();
  for (const ev of eventRing) {
    if (!ev.srcCountry || ev.srcThreat === 'internal') continue;
    const key = ev.srcCountry;
    if (!byCountry.has(key)) {
      byCountry.set(key, {
        country:  ev.srcCountry,
        flag:     ev.srcFlag   || '',
        city:     ev.srcCity   || '',
        org:      ev.srcOrg    || '',
        threat:   ev.srcThreat || 'Unknown',
        srcIp:    ev.srcIp,
        count:    0,
        critical: 0,
        high:     0,
        latestAt: ev.timestamp,
        types:    new Set(),
        typeCounts: new Map(),
        targetCounts: new Map(),
      });
    }
    const entry = byCountry.get(key);
    entry.count++;
    if (ev.severity === 'critical') entry.critical++;
    if (ev.severity === 'high')     entry.high++;
    if (new Date(ev.timestamp) > new Date(entry.latestAt)) entry.latestAt = ev.timestamp;
    entry.types.add(ev.type);
    const typeKey = ev.type || 'event';
    entry.typeCounts.set(typeKey, (entry.typeCounts.get(typeKey) || 0) + 1);
    const targetKey = ev.dstAsset || ev.dstIp || 'unknown';
    entry.targetCounts.set(targetKey, (entry.targetCounts.get(targetKey) || 0) + 1);
  }
  return Array.from(byCountry.values())
    .map((e) => ({
      ...e,
      types: Array.from(e.types),
      topTypes: Array.from(e.typeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
      topTargets: Array.from(e.targetCounts.entries())
        .map(([target, count]) => ({ target, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Public API: identify IPs doing reconnaissance ───────────────────────────
export function getReconDetections() {
  const reconTypes = new Set(['port-scan', 'dns-query', 'auth-fail', 'vuln-probe', 'intrusion', 'brute_force_ssh', 'ssh_compromise_suspected', 'outbound_fanout', 'outbound_beaconing']);
  const byIp = new Map();
  for (const ev of eventRing) {
    if (!reconTypes.has(ev.type) || ev.srcThreat === 'internal' || !ev.srcIp) continue;
    const key = ev.srcIp;
    if (!byIp.has(key)) {
      byIp.set(key, {
        srcIp:       ev.srcIp,
        srcCountry:  ev.srcCountry,
        srcFlag:     ev.srcFlag    || '',
        srcCity:     ev.srcCity    || '',
        srcOrg:      ev.srcOrg     || '',
        srcThreat:   ev.srcThreat  || 'Unknown',
        totalEvents: 0,
        portScans:   0,
        dnsLookups:  0,
        authFails:   0,
        vulnProbes:  0,
        targetsHit:  new Set(),
        firstSeen:   ev.timestamp,
        lastSeen:    ev.timestamp,
      });
    }
    const entry = byIp.get(key);
    entry.totalEvents++;
    if (ev.type === 'port-scan')  entry.portScans++;
    if (ev.type === 'dns-query')  entry.dnsLookups++;
    if (ev.type === 'auth-fail' || ev.type === 'brute_force_ssh' || ev.type === 'ssh_compromise_suspected') entry.authFails++;
    if (ev.type === 'vuln-probe') entry.vulnProbes++;
    entry.targetsHit.add(ev.dstAsset || ev.dstIp || 'unknown');
    if (new Date(ev.timestamp) > new Date(entry.lastSeen)) entry.lastSeen = ev.timestamp;
  }
  return Array.from(byIp.values())
    .map((e) => ({ ...e, targetsHit: Array.from(e.targetsHit) }))
    .sort((a, b) => b.totalEvents - a.totalEvents)
    .slice(0, 25);
}
