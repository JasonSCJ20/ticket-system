// Outbound connection anomaly detection. connectionTracker.js watches
// inbound scan attempts; this module watches the other direction —
// connections THIS host initiates outward — for the two most common
// data-exfiltration / C2 signatures that don't require payload inspection,
// only connection metadata:
//
//  1. Fan-out: touching an unusually large number of distinct outbound
//     destinations in a short window (bulk exfil, or a compromised host
//     probing for C2 infrastructure).
//  2. Beaconing: repeated connections to the SAME destination at a
//     suspiciously regular interval — the hallmark of a scripted C2
//     check-in, which looks nothing like normal bursty human/app traffic.
//
// Scope note: fan-out is report-only, even in active mode — auto-blocking
// 20+ arbitrary destinations at once risks taking down the host's own
// legitimate traffic and deserves a human look first. Beaconing, by
// contrast, identifies one specific confirmed-regular destination, so it's
// eligible for the same shadow/active auto-isolate treatment as inbound
// scans (see index.js).
export function createOutboundTracker({
  windowMs = 5 * 60_000,
  destinationThreshold = 25,
  beaconMinOccurrences = 4,
  beaconToleranceMs = 5_000,
} = {}) {
  // "ip:port" -> [timestamp, ...]
  const destinations = new Map();
  let lastFanOutFlagAt = 0;
  const flaggedBeacons = new Set(); // avoid re-reporting the same confirmed beacon every tick

  function prune(now) {
    for (const [key, timestamps] of destinations) {
      const kept = timestamps.filter((t) => now - t <= windowMs);
      if (kept.length === 0) {
        destinations.delete(key);
        flaggedBeacons.delete(key);
      } else {
        destinations.set(key, kept);
      }
    }
  }

  function record(outboundConnections, now = Date.now()) {
    for (const conn of outboundConnections) {
      const key = `${conn.remoteIp}:${conn.remotePort}`;
      if (!destinations.has(key)) destinations.set(key, []);
      destinations.get(key).push(now);
    }
    prune(now);
  }

  function detectFanOut(now = Date.now()) {
    prune(now);
    const distinctIps = new Set(Array.from(destinations.keys()).map((k) => k.slice(0, k.lastIndexOf(':'))));
    if (distinctIps.size >= destinationThreshold && now - lastFanOutFlagAt > windowMs) {
      lastFanOutFlagAt = now;
      return { destinationCount: distinctIps.size, destinations: Array.from(distinctIps).slice(0, 20) };
    }
    return null;
  }

  // Real regularity check, no statistics library needed: with enough
  // samples, compute the intervals between consecutive connections and
  // flag if every interval sits within tolerance of the median. Bursty,
  // human-driven, or ordinary application traffic won't do this; a fixed
  // check-in loop will.
  function detectBeacons(now = Date.now()) {
    prune(now);
    const flagged = [];
    for (const [key, timestamps] of destinations) {
      if (timestamps.length < beaconMinOccurrences || flaggedBeacons.has(key)) continue;
      const sorted = [...timestamps].sort((a, b) => a - b);
      const intervals = [];
      for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
      const sortedIntervals = [...intervals].sort((a, b) => a - b);
      const median = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
      if (median === 0) continue; // simultaneous burst, not a periodic check-in
      const regular = intervals.every((i) => Math.abs(i - median) <= beaconToleranceMs);
      if (regular) {
        flaggedBeacons.add(key);
        const separatorIndex = key.lastIndexOf(':');
        flagged.push({
          remoteIp: key.slice(0, separatorIndex),
          remotePort: Number(key.slice(separatorIndex + 1)),
          occurrences: timestamps.length,
          intervalMs: median,
        });
      }
    }
    return flagged;
  }

  return { record, detectFanOut, detectBeacons };
}
