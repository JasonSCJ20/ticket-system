import { describe, it, expect } from 'vitest';
import { createConnectionTracker } from '../src/connectionTracker.js';

function conn(remoteIp, localPort) {
  return { remoteIp, localPort, remotePort: 55000, localIp: '10.0.0.5', state: 'ESTABLISHED' };
}

describe('createConnectionTracker', () => {
  it('flags a source IP that touches many distinct ports within the window', () => {
    const tracker = createConnectionTracker({ windowMs: 60_000, portThreshold: 5 });
    const now = 1_000_000;
    for (let port = 1; port <= 6; port++) {
      tracker.record([conn('203.0.113.9', port)], now);
    }
    const flagged = tracker.detectScans(now);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ sourceIp: '203.0.113.9', portCount: 6 });
    expect(flagged[0].ports).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('does not flag ordinary traffic touching only a couple of ports', () => {
    const tracker = createConnectionTracker({ windowMs: 60_000, portThreshold: 5 });
    const now = 1_000_000;
    tracker.record([conn('198.51.100.4', 443), conn('198.51.100.4', 80)], now);
    expect(tracker.detectScans(now)).toEqual([]);
  });

  it('forgets observations once they age out of the window', () => {
    const tracker = createConnectionTracker({ windowMs: 1000, portThreshold: 3 });
    const start = 1_000_000;
    tracker.record([conn('203.0.113.9', 1), conn('203.0.113.9', 2), conn('203.0.113.9', 3)], start);
    expect(tracker.detectScans(start)).toHaveLength(1);

    // Well past the window with no further activity — should no longer be flagged.
    expect(tracker.detectScans(start + 5000)).toEqual([]);
  });

  it('tracks multiple source IPs independently', () => {
    const tracker = createConnectionTracker({ windowMs: 60_000, portThreshold: 3 });
    const now = 1_000_000;
    tracker.record([conn('203.0.113.9', 1), conn('203.0.113.9', 2), conn('203.0.113.9', 3)], now);
    tracker.record([conn('198.51.100.4', 443)], now);
    const flagged = tracker.detectScans(now);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].sourceIp).toBe('203.0.113.9');
  });
});
