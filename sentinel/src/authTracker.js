// Brute-force SSH/auth detection: counts failed-login events per source IP
// within a rolling window — the single most common real-world attack
// signal, and the same connection-rate philosophy as connectionTracker.js
// (no exotic log analytics needed, just "one IP failing repeatedly").
//
// A successful login from an IP with recent failed attempts on record is
// tracked separately and treated as more severe than the brute-force
// attempt itself — that's the "they guessed right" case.
export function createAuthAttemptTracker({ windowMs = 5 * 60_000, failureThreshold = 5 } = {}) {
  // sourceIp -> [{ timestamp, user }]
  const failures = new Map();
  const recentlyFlagged = new Map(); // sourceIp -> lastFlaggedAt, avoids re-alerting every poll

  function prune(now) {
    for (const [ip, attempts] of failures) {
      const kept = attempts.filter((a) => now - a.timestamp <= windowMs);
      if (kept.length === 0) failures.delete(ip);
      else failures.set(ip, kept);
    }
    for (const [ip, at] of recentlyFlagged) {
      if (now - at > windowMs) recentlyFlagged.delete(ip);
    }
  }

  function record(events, now = Date.now()) {
    for (const event of events) {
      if (event.type !== 'auth_failure') continue;
      if (!failures.has(event.ip)) failures.set(event.ip, []);
      failures.get(event.ip).push({ timestamp: now, user: event.user });
    }
    prune(now);
  }

  function detectBruteForce(now = Date.now()) {
    prune(now);
    const flagged = [];
    for (const [ip, attempts] of failures) {
      if (attempts.length >= failureThreshold && !recentlyFlagged.has(ip)) {
        const users = Array.from(new Set(attempts.map((a) => a.user)));
        flagged.push({ sourceIp: ip, attemptCount: attempts.length, users });
        recentlyFlagged.set(ip, now);
      }
    }
    return flagged;
  }

  function checkSuccessAfterFailures(event, now = Date.now()) {
    prune(now);
    const attempts = failures.get(event.ip);
    if (attempts && attempts.length > 0) {
      return { sourceIp: event.ip, user: event.user, priorFailedAttempts: attempts.length };
    }
    return null;
  }

  return { record, detectBruteForce, checkSuccessAfterFailures };
}
