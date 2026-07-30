import { describe, it, expect } from 'vitest';
import { createAuthAttemptTracker } from '../src/authTracker.js';

function failure(ip, user) {
  return { type: 'auth_failure', ip, user, invalidUser: false };
}

describe('createAuthAttemptTracker', () => {
  it('flags an IP once it crosses the failure threshold', () => {
    const tracker = createAuthAttemptTracker({ windowMs: 60_000, failureThreshold: 3 });
    const now = 1_000_000;
    tracker.record([failure('203.0.113.5', 'root'), failure('203.0.113.5', 'admin'), failure('203.0.113.5', 'admin')], now);
    const flagged = tracker.detectBruteForce(now);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ sourceIp: '203.0.113.5', attemptCount: 3 });
    expect(flagged[0].users.sort()).toEqual(['admin', 'root']);
  });

  it('does not flag an IP under the threshold', () => {
    const tracker = createAuthAttemptTracker({ windowMs: 60_000, failureThreshold: 5 });
    const now = 1_000_000;
    tracker.record([failure('198.51.100.4', 'deploy'), failure('198.51.100.4', 'deploy')], now);
    expect(tracker.detectBruteForce(now)).toEqual([]);
  });

  it('does not re-flag the same IP again within the window once already flagged', () => {
    const tracker = createAuthAttemptTracker({ windowMs: 60_000, failureThreshold: 2 });
    const now = 1_000_000;
    tracker.record([failure('203.0.113.5', 'root'), failure('203.0.113.5', 'root')], now);
    expect(tracker.detectBruteForce(now)).toHaveLength(1);
    tracker.record([failure('203.0.113.5', 'root')], now + 1000);
    expect(tracker.detectBruteForce(now + 1000)).toEqual([]);
  });

  it('forgets attempts once they age out of the window', () => {
    const tracker = createAuthAttemptTracker({ windowMs: 1000, failureThreshold: 2 });
    const start = 1_000_000;
    tracker.record([failure('203.0.113.5', 'root'), failure('203.0.113.5', 'root')], start);
    expect(tracker.detectBruteForce(start + 5000)).toEqual([]);
  });

  it('flags a successful login from an IP with recent failed attempts on record', () => {
    const tracker = createAuthAttemptTracker({ windowMs: 60_000, failureThreshold: 10 });
    const now = 1_000_000;
    tracker.record([failure('203.0.113.5', 'root'), failure('203.0.113.5', 'root')], now);
    const result = tracker.checkSuccessAfterFailures({ type: 'auth_success', ip: '203.0.113.5', user: 'root' }, now);
    expect(result).toEqual({ sourceIp: '203.0.113.5', user: 'root', priorFailedAttempts: 2 });
  });

  it('does not flag a successful login from a clean IP', () => {
    const tracker = createAuthAttemptTracker({ windowMs: 60_000, failureThreshold: 10 });
    const result = tracker.checkSuccessAfterFailures({ type: 'auth_success', ip: '10.0.0.2', user: 'deploy' }, 1_000_000);
    expect(result).toBeNull();
  });
});
