import net from 'net';

// A small, deliberately conservative port set: enough to establish real
// reachability plus the classic externally-exploitable risk indicators.
const COMMON_PORTS = [21, 22, 23, 80, 443, 3389, 5900, 8080, 8443];

// Ports that are themselves a real exposure signal if found open on a
// network device — not because any specific vulnerability was found in
// them, but because these protocols are common ransomware/credential-theft
// entry points when reachable (RDP, Telnet, FTP, VNC).
const HIGH_RISK_PORTS = {
  21: 'FTP (unencrypted credentials)',
  23: 'Telnet (unencrypted credentials)',
  3389: 'RDP (common ransomware entry point)',
  5900: 'VNC (frequently unauthenticated)',
};

// Real TCP-connect reachability/port probing against a network device's
// declared IP — replaces the old risk-score "drift" in app.js's device
// automation, which never actually contacted the device at all; it just
// nudged a self-referential risk number up or down based on its own prior
// value and the device's declared type. This performs a real, if simple,
// connectivity check using nothing but Node's own net module — no external
// binary (nmap/etc.) required.
export function createDeviceProbe({ connect = net.connect, timeoutMs = 1500, ports = COMMON_PORTS } = {}) {
  function probePort(ip, port) {
    return new Promise((resolve) => {
      const socket = connect(port, ip);
      socket.setTimeout(timeoutMs);
      const finish = (open) => {
        socket.destroy();
        resolve(open);
      };
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  async function probe(ip) {
    const results = await Promise.all(ports.map(async (port) => ({ port, open: await probePort(ip, port) })));
    const openPorts = results.filter((r) => r.open).map((r) => r.port);
    const highRiskOpenPorts = openPorts.filter((port) => HIGH_RISK_PORTS[port]);
    return {
      reachable: openPorts.length > 0,
      openPorts,
      highRiskOpenPorts: highRiskOpenPorts.map((port) => ({ port, reason: HIGH_RISK_PORTS[port] })),
    };
  }

  return { probe };
}
