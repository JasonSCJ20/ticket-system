import fs from 'fs';

// TCP connection states as encoded in /proc/net/tcp — only the ones this
// module actually cares about are named; the rest fall through as their raw
// hex code, which is fine since nothing here branches on them.
const TCP_STATES = {
  '01': 'ESTABLISHED',
  '0A': 'LISTEN',
  '06': 'TIME_WAIT',
};

function hexToIp(hex) {
  const bytes = [];
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes.join('.');
}

// Pure parser — takes the raw text content of /proc/net/tcp(6), not a file
// path, so it's exercised directly in tests against a real fixture string
// without needing an actual Linux host.
export function parseTcpTable(content) {
  const lines = content.trim().split('\n').slice(1); // header row
  const rows = [];
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;
    const [localHex, localPortHex] = fields[1].split(':');
    const [remoteHex, remotePortHex] = fields[2].split(':');
    const stateHex = fields[3];
    rows.push({
      localIp: hexToIp(localHex),
      localPort: parseInt(localPortHex, 16),
      remoteIp: hexToIp(remoteHex),
      remotePort: parseInt(remotePortHex, 16),
      state: TCP_STATES[stateHex] || stateHex,
    });
  }
  return rows;
}

// Reads the real kernel tables. Linux-only — on any other platform (or if
// the file simply isn't there for some other reason) this returns an empty
// list rather than throwing, since a sentinel that can't read port state
// should degrade to "no visibility" rather than crash the whole daemon.
export function readTcpTables(paths = ['/proc/net/tcp', '/proc/net/tcp6']) {
  const rows = [];
  for (const path of paths) {
    try {
      rows.push(...parseTcpTable(fs.readFileSync(path, 'utf8')));
    } catch {
      // Not Linux, or /proc unavailable — degrade silently, the caller
      // decides what "no data" means for its own purposes.
    }
  }
  return rows;
}

export function listListeningPorts(rows = readTcpTables()) {
  const ports = new Set();
  for (const row of rows) {
    if (row.state === 'LISTEN') ports.add(row.localPort);
  }
  return Array.from(ports).sort((a, b) => a - b);
}

export function listActiveConnections(rows = readTcpTables()) {
  return rows.filter((row) => row.state === 'ESTABLISHED' && row.remoteIp !== '0.0.0.0');
}

// A connection this host initiated outward (as opposed to one a remote peer
// initiated inbound) always has a local port that ISN'T one of this host's
// own listening ports — /proc/net/tcp doesn't record direction directly, but
// that distinction reconstructs it reliably.
export function listOutboundConnections(rows, listeningPorts) {
  const listening = new Set(listeningPorts);
  return rows.filter(
    (row) => row.state === 'ESTABLISHED' && row.remoteIp !== '0.0.0.0' && !listening.has(row.localPort),
  );
}
