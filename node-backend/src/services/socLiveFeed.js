import { randomInt } from 'node:crypto';

// ─── Ring Buffer ──────────────────────────────────────────────────────────────
const RING_CAP = 500;
const eventRing = [];
let nextId = 1;

// ─── Threat actor pool (realistic external threat sources) ────────────────────
const THREAT_ACTORS = [
  { ip: '103.93.78.4',    country: 'CN', flag: '🇨🇳', city: 'Shanghai',       org: 'CHINANET-BB',    threat: 'APT'         },
  { ip: '175.45.176.0',   country: 'KP', flag: '🇰🇵', city: 'Pyongyang',      org: 'STAR-KP',        threat: 'Nation-State' },
  { ip: '91.207.4.23',    country: 'RU', flag: '🇷🇺', city: 'Moscow',         org: 'HOSTPRO-RU',     threat: 'APT'         },
  { ip: '185.220.101.45', country: 'RU', flag: '🇷🇺', city: 'St. Petersburg', org: 'TOR-EXIT-RU',    threat: 'TOR'         },
  { ip: '94.182.144.12',  country: 'IR', flag: '🇮🇷', city: 'Tehran',         org: 'MCCI-IR',        threat: 'APT'         },
  { ip: '177.67.80.3',    country: 'BR', flag: '🇧🇷', city: 'São Paulo',      org: 'CLARO-SA',       threat: 'Scanner'     },
  { ip: '167.172.58.92',  country: 'US', flag: '🇺🇸', city: 'New York',       org: 'DIGITALOCEAN',   threat: 'Botnet'      },
  { ip: '104.21.74.109',  country: 'US', flag: '🇺🇸', city: 'San Francisco',  org: 'CLOUDFLARE-ABU', threat: 'Botnet'      },
  { ip: '185.130.44.108', country: 'DE', flag: '🇩🇪', city: 'Frankfurt',      org: 'HETZNER-TOR',    threat: 'TOR'         },
  { ip: '89.234.157.254', country: 'NL', flag: '🇳🇱', city: 'Amsterdam',      org: 'PULSANT-NL',     threat: 'TOR'         },
  { ip: '116.58.24.197',  country: 'PK', flag: '🇵🇰', city: 'Karachi',        org: 'WORLDCALL',      threat: 'Scanner'     },
  { ip: '103.205.142.11', country: 'IN', flag: '🇮🇳', city: 'Mumbai',         org: 'TATACOMM',       threat: 'Scanner'     },
  { ip: '113.190.84.45',  country: 'VN', flag: '🇻🇳', city: 'Hanoi',          org: 'VNPT-VN',        threat: 'Scanner'     },
  { ip: '93.114.94.111',  country: 'RO', flag: '🇷🇴', city: 'Bucharest',      org: 'RDSNET',         threat: 'Botnet'      },
  { ip: '197.242.20.44',  country: 'NG', flag: '🇳🇬', city: 'Lagos',          org: 'MAINONE-NG',     threat: 'Phishing'    },
  { ip: '41.60.233.12',   country: 'KE', flag: '🇰🇪', city: 'Nairobi',        org: 'SAFARICOM',      threat: 'Scanner'     },
  { ip: '82.196.7.91',    country: 'UA', flag: '🇺🇦', city: 'Kyiv',           org: 'UKRTELECOM',     threat: 'Botnet'      },
  { ip: '5.188.206.14',   country: 'RU', flag: '🇷🇺', city: 'Novosibirsk',    org: 'SELECTEL',       threat: 'Botnet'      },
  { ip: '45.142.212.100', country: 'NL', flag: '🇳🇱', city: 'Rotterdam',      org: 'SERVERIUS',      threat: 'Scanner'     },
  { ip: '198.199.120.44', country: 'SG', flag: '🇸🇬', city: 'Singapore',      org: 'DO-SGP',         threat: 'Scanner'     },
];

// ─── Our protected assets ─────────────────────────────────────────────────────
const OUR_ASSETS = [
  { ip: '192.168.1.1',   name: 'Core Router',        type: 'router',   port: 80   },
  { ip: '192.168.1.254', name: 'Perimeter Firewall',  type: 'firewall', port: 443  },
  { ip: '10.0.0.5',      name: 'Web Application',     type: 'web',      port: 443  },
  { ip: '10.0.0.10',     name: 'Database Server',     type: 'database', port: 5432 },
  { ip: '10.0.0.15',     name: 'Auth Service',        type: 'auth',     port: 8443 },
  { ip: '172.16.0.1',    name: 'DMZ Gateway',         type: 'gateway',  port: 22   },
  { ip: '10.10.0.3',     name: 'API Gateway',         type: 'api',      port: 8001 },
  { ip: '10.20.0.2',     name: 'Mail Server',         type: 'mail',     port: 25   },
  { ip: '10.30.0.1',     name: 'VPN Concentrator',    type: 'vpn',      port: 1194 },
  { ip: '10.40.0.5',     name: 'Internal DNS Resolver', type: 'dns',    port: 53   },
];

// ─── Weighted event type pool ─────────────────────────────────────────────────
const EVENT_TYPES = [
  { type: 'connection',   severity: 'info',     tool: 'Zeek',     weight: 28 },
  { type: 'dns-query',    severity: 'low',      tool: 'Zeek',     weight: 18 },
  { type: 'port-scan',    severity: 'medium',   tool: 'Suricata', weight: 16 },
  { type: 'auth-fail',    severity: 'medium',   tool: 'Wazuh',    weight: 14 },
  { type: 'intrusion',    severity: 'high',     tool: 'Suricata', weight: 10 },
  { type: 'vuln-probe',   severity: 'high',     tool: 'OpenVAS',  weight: 8  },
  { type: 'data-exfil',   severity: 'critical', tool: 'Falco',    weight: 4  },
  { type: 'lateral-move', severity: 'critical', tool: 'Falco',    weight: 2  },
];

const INTRUSION_SIGS = [
  'SQL Injection attempt detected (UNION SELECT)',
  'Remote Code Execution payload via HTTP POST',
  'Local File Inclusion probe: ../../etc/passwd',
  'XSS reflected payload in User-Agent header',
  'Shell injection via HTTP query parameter',
  'Log4Shell exploitation attempt CVE-2021-44228',
  'Spring4Shell RCE attempt CVE-2022-22965',
  'SSRF request to internal cloud metadata endpoint',
  'Directory traversal attack on file upload endpoint',
  'Blind SSRF via DNS callback detected',
  'Java deserialization gadget chain in request body',
  'JWT algorithm confusion attack (alg:none)',
  'NoSQL injection probe in MongoDB endpoint',
  'XXE injection in XML content-type body',
  'IDOR enumeration: sequential ID probing detected',
];

const VULN_CVES = [
  'CVE-2021-44228 (Log4Shell)',
  'CVE-2022-22965 (Spring4Shell)',
  'CVE-2023-44487 (HTTP/2 Rapid Reset)',
  'CVE-2021-26084 (Confluence RCE)',
  'CVE-2022-1388 (F5 BIG-IP Auth bypass)',
  'CVE-2023-23397 (Outlook NTLM hash theft)',
  'CVE-2021-36942 (ZeroLogon PetitPotam)',
  'CVE-2022-30190 (Follina MSDT)',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[randomInt(0, arr.length)];
}

function weightedPick(items) {
  const total = items.reduce((s, i) => s + (i.weight || 1), 0);
  let r = randomInt(0, total);
  for (const item of items) {
    r -= (item.weight || 1);
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

function randomSrcPort() {
  return 1024 + randomInt(0, 63511);
}

function buildEventMessage(type, actor, asset, srcPort) {
  const scanPorts = [22, 80, 443, 3389, 5432, 1433, 3306, 6379, 8080, 8443, 9200, 27017, 445, 139, 21, 23];
  const portSample = scanPorts.slice(0, 6 + randomInt(0, 7)).join(',');
  switch (type) {
    case 'connection':
      return `NEW SESSION ${actor.ip}:${srcPort} → ${asset.ip}:${asset.port} [TCP] source=${actor.city},${actor.country} org=${actor.org}`;
    case 'dns-query':
      return `DNS QUERY from ${actor.ip}: A? ${asset.name.toLowerCase().replace(/\s+/g, '-')}.internal (→ ${asset.ip}) [suspicious external resolver]`;
    case 'port-scan':
      return `PORT SCAN ${actor.ip} (${actor.city}, ${actor.country} / ${actor.org}) → ${asset.ip} ports [${portSample}] SYN sweep detected`;
    case 'auth-fail':
      return `AUTH FAILURE ${actor.ip}:${srcPort} → ${asset.ip}:${asset.port} attempt #${randomInt(1, 20)} user=root,admin,sa [brute-force pattern]`;
    case 'intrusion':
      return `IDS ALERT SID:${10000 + randomInt(0, 9999)} ${actor.ip} → ${asset.ip} — ${pick(INTRUSION_SIGS)}`;
    case 'vuln-probe':
      return `VULN PROBE ${actor.ip} → ${asset.ip}:${asset.port} — signature match for ${pick(VULN_CVES)}`;
    case 'data-exfil':
      return `DATA EXFIL ALERT ${asset.ip} → ${actor.ip}:443 outbound ${randomInt(3, 120)}MB — Falco kernel syscall anomaly detected`;
    case 'lateral-move':
      return `LATERAL MOVEMENT ${actor.ip} → ${asset.ip}:${asset.port} — ${pick(['SMB pass-the-hash', 'Kerberoasting', 'DCOM lateral', 'WMI exec', 'PsExec pivot'])} detected`;
    default:
      return `SECURITY EVENT from ${actor.ip} targeting ${asset.ip}:${asset.port}`;
  }
}

// ─── Public: generate a single random event body ──────────────────────────────
export function generateEventBody(overrides = {}) {
  const actor   = pick(THREAT_ACTORS);
  const asset   = pick(OUR_ASSETS);
  const evType  = weightedPick(EVENT_TYPES);
  const srcPort = randomSrcPort();

  return {
    id:           nextId++,
    timestamp:    overrides.timestamp || new Date().toISOString(),
    type:         overrides.type      || evType.type,
    severity:     overrides.severity  || evType.severity,
    tool:         overrides.tool      || evType.tool,
    srcIp:        overrides.srcIp     || actor.ip,
    srcCountry:   actor.country,
    srcFlag:      actor.flag,
    srcCity:      actor.city,
    srcOrg:       actor.org,
    srcThreat:    actor.threat,
    dstIp:        asset.ip,
    dstPort:      asset.port,
    dstAsset:     asset.name,
    dstAssetType: asset.type,
    message:      overrides.message   || buildEventMessage(evType.type, actor, asset, srcPort),
    ...overrides,
  };
}

// ─── Public: push a pre-built or partial event ───────────────────────────────
export function pushEvent(event) {
  if (!event.id) event.id = nextId++;
  eventRing.push(event);
  if (eventRing.length > RING_CAP) eventRing.shift();
}

// ─── Public: generate N ambient events and push them ─────────────────────────
export function generateAndPushEvents(count = 5) {
  for (let i = 0; i < count; i++) pushEvent(generateEventBody());
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
  const reconTypes = new Set(['port-scan', 'dns-query', 'auth-fail', 'vuln-probe']);
  const byIp = new Map();
  for (const ev of eventRing) {
    if (!reconTypes.has(ev.type) || ev.srcThreat === 'internal') continue;
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
    if (ev.type === 'auth-fail')  entry.authFails++;
    if (ev.type === 'vuln-probe') entry.vulnProbes++;
    entry.targetsHit.add(ev.dstAsset || ev.dstIp || 'unknown');
    if (new Date(ev.timestamp) > new Date(entry.lastSeen)) entry.lastSeen = ev.timestamp;
  }
  return Array.from(byIp.values())
    .map((e) => ({ ...e, targetsHit: Array.from(e.targetsHit) }))
    .sort((a, b) => b.totalEvents - a.totalEvents)
    .slice(0, 25);
}

// ─── Seed the ring on module load ─────────────────────────────────────────────
// Pre-populate with 50 realistic events spread over the last 45 minutes
(function seedRing() {
  const now  = Date.now();
  const span = 45 * 60 * 1000;
  for (let i = 50; i >= 1; i--) {
    const ts = new Date(now - Math.floor((i / 50) * span)).toISOString();
    pushEvent(generateEventBody({ timestamp: ts }));
  }
}());
