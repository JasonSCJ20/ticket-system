// Port-scan / connection-anomaly detection without packet capture: a real,
// working signature (one remote IP touching many distinct local ports in a
// short window) built entirely from periodic /proc/net/tcp snapshots — no
// raw sockets, no native bindings, no root needed for this part specifically
// (only the firewall-rewrite side needs elevated capabilities).
//
// This will miss a slow/low-rate scan spread over hours, and it can't see
// SYN packets that never complete a connection (a stealth SYN scan) — those
// need real packet capture, which is a deliberate scope line for now (see
// the module doc in index.js). What it does catch: the loud, common case —
// a scanner hitting many ports quickly.
export function createConnectionTracker({ windowMs = 60_000, portThreshold = 15 } = {}) {
  // sourceIp -> Map<port, lastSeenTimestamp>
  const observations = new Map();

  function prune(now) {
    for (const [ip, ports] of observations) {
      for (const [port, seenAt] of ports) {
        if (now - seenAt > windowMs) ports.delete(port);
      }
      if (ports.size === 0) observations.delete(ip);
    }
  }

  function record(connections, now = Date.now()) {
    for (const conn of connections) {
      if (!observations.has(conn.remoteIp)) observations.set(conn.remoteIp, new Map());
      observations.get(conn.remoteIp).set(conn.localPort, now);
    }
    prune(now);
  }

  // Returns any source IP currently over threshold, with the port count and
  // the actual ports touched (useful evidence in the reported finding).
  function detectScans(now = Date.now()) {
    prune(now);
    const flagged = [];
    for (const [ip, ports] of observations) {
      if (ports.size >= portThreshold) {
        flagged.push({ sourceIp: ip, portCount: ports.size, ports: Array.from(ports.keys()).sort((a, b) => a - b) });
      }
    }
    return flagged;
  }

  return { record, detectScans };
}
