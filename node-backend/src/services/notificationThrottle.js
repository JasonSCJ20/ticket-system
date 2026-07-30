const DEFAULT_WINDOW_MS = 10 * 60_000;
const DEFAULT_MAX_PER_WINDOW = 3;

// Real-time alerting has no dedup/throttle at all today — every high or
// critical finding notifies its whole matched audience immediately, with no
// limit. A single genuine incident that produces several distinct findings
// in quick succession (a real port scan AND a real brute-force attempt from
// the same event, say) currently means several separate pings to the same
// people within minutes — an alert-storm risk, not a hypothetical one now
// that findings are real.
//
// Deliberate design choice: only 'high' severity is throttled. 'critical'
// always sends immediately and is never folded into a digest — suppressing
// or delaying the most urgent tier is a worse failure mode than a slightly
// noisy inbox.
export function createNotificationThrottle({ windowMs = DEFAULT_WINDOW_MS, maxPerWindow = DEFAULT_MAX_PER_WINDOW } = {}) {
  // userId -> { windowStart, sentCount, suppressed: [{findingId, title, severity}] }
  const state = new Map();

  function getOrInitBucket(userId, now) {
    let bucket = state.get(userId);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, sentCount: 0, suppressed: [] };
      state.set(userId, bucket);
    }
    return bucket;
  }

  // Call before sending a real-time alert to a given user for a given
  // finding. Returns { send: true } if it should go out immediately now, or
  // { send: false, suppressedCount } if it was folded into that user's
  // throttle window instead (to be delivered later as a digest).
  function admit(userId, finding, now = Date.now()) {
    if (String(finding.severity).toLowerCase() === 'critical') return { send: true };

    const bucket = getOrInitBucket(userId, now);
    if (bucket.sentCount < maxPerWindow) {
      bucket.sentCount += 1;
      return { send: true };
    }
    bucket.suppressed.push({ findingId: finding.id, title: finding.title, severity: finding.severity });
    return { send: false, suppressedCount: bucket.suppressed.length };
  }

  // Collects any accumulated suppressed alerts whose window has now
  // elapsed, for every user with a pending digest, and clears them (the
  // next admit() call for that user starts a fresh window). Intended to be
  // called periodically by a scheduler, not per-request.
  function collectDueDigests(now = Date.now()) {
    const due = [];
    for (const [userId, bucket] of state) {
      if (now - bucket.windowStart >= windowMs && bucket.suppressed.length > 0) {
        due.push({ userId, items: bucket.suppressed });
        state.delete(userId);
      }
    }
    return due;
  }

  return { admit, collectDueDigests };
}
