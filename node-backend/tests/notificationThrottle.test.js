import { createNotificationThrottle } from '../src/services/notificationThrottle.js';

function finding(overrides = {}) {
  return { id: 1, title: 'Something happened', severity: 'high', ...overrides };
}

describe('createNotificationThrottle', () => {
  it('admits alerts up to the per-window cap for a given user', () => {
    const throttle = createNotificationThrottle({ windowMs: 60_000, maxPerWindow: 3 });
    const now = 1_000_000;
    expect(throttle.admit('user-1', finding({ id: 1 }), now)).toEqual({ send: true });
    expect(throttle.admit('user-1', finding({ id: 2 }), now)).toEqual({ send: true });
    expect(throttle.admit('user-1', finding({ id: 3 }), now)).toEqual({ send: true });
  });

  it('suppresses alerts beyond the cap within the same window', () => {
    const throttle = createNotificationThrottle({ windowMs: 60_000, maxPerWindow: 2 });
    const now = 1_000_000;
    throttle.admit('user-1', finding({ id: 1 }), now);
    throttle.admit('user-1', finding({ id: 2 }), now);
    const result = throttle.admit('user-1', finding({ id: 3 }), now);
    expect(result).toEqual({ send: false, suppressedCount: 1 });
  });

  it('never throttles critical severity, even past the cap', () => {
    const throttle = createNotificationThrottle({ windowMs: 60_000, maxPerWindow: 1 });
    const now = 1_000_000;
    throttle.admit('user-1', finding({ id: 1, severity: 'high' }), now);
    const result = throttle.admit('user-1', finding({ id: 2, severity: 'critical' }), now);
    expect(result).toEqual({ send: true });
  });

  it('tracks each user independently', () => {
    const throttle = createNotificationThrottle({ windowMs: 60_000, maxPerWindow: 1 });
    const now = 1_000_000;
    throttle.admit('user-1', finding({ id: 1 }), now);
    expect(throttle.admit('user-1', finding({ id: 2 }), now).send).toBe(false);
    expect(throttle.admit('user-2', finding({ id: 3 }), now).send).toBe(true);
  });

  it('resets the cap once the window has elapsed', () => {
    const throttle = createNotificationThrottle({ windowMs: 1000, maxPerWindow: 1 });
    const start = 1_000_000;
    throttle.admit('user-1', finding({ id: 1 }), start);
    expect(throttle.admit('user-1', finding({ id: 2 }), start + 500).send).toBe(false);
    expect(throttle.admit('user-1', finding({ id: 3 }), start + 1500).send).toBe(true);
  });

  it('collectDueDigests returns nothing before the window has elapsed', () => {
    const throttle = createNotificationThrottle({ windowMs: 60_000, maxPerWindow: 1 });
    const now = 1_000_000;
    throttle.admit('user-1', finding({ id: 1 }), now);
    throttle.admit('user-1', finding({ id: 2 }), now);
    expect(throttle.collectDueDigests(now + 1000)).toEqual([]);
  });

  it('collectDueDigests returns and clears suppressed alerts once the window elapses', () => {
    const throttle = createNotificationThrottle({ windowMs: 1000, maxPerWindow: 1 });
    const start = 1_000_000;
    throttle.admit('user-1', finding({ id: 1, title: 'first' }), start);
    throttle.admit('user-1', finding({ id: 2, title: 'second' }), start + 100);

    const due = throttle.collectDueDigests(start + 2000);
    expect(due).toEqual([{ userId: 'user-1', items: [{ findingId: 2, title: 'second', severity: 'high' }] }]);

    // Cleared — a second collection call finds nothing left to report.
    expect(throttle.collectDueDigests(start + 3000)).toEqual([]);
  });

  it('does not report a digest for a user with no suppressed alerts, even after the window elapses', () => {
    const throttle = createNotificationThrottle({ windowMs: 1000, maxPerWindow: 5 });
    const start = 1_000_000;
    throttle.admit('user-1', finding({ id: 1 }), start); // well under the cap, never suppressed
    expect(throttle.collectDueDigests(start + 2000)).toEqual([]);
  });
});
