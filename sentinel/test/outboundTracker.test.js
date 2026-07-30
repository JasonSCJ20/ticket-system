import { describe, it, expect } from 'vitest';
import { createOutboundTracker } from '../src/outboundTracker.js';

function conn(remoteIp, remotePort) {
  return { remoteIp, remotePort, localIp: '10.0.0.1', localPort: 54000 };
}

describe('createOutboundTracker - fan-out', () => {
  it('flags this host once it touches enough distinct destinations within the window', () => {
    const tracker = createOutboundTracker({ windowMs: 60_000, destinationThreshold: 5 });
    const now = 1_000_000;
    for (let i = 0; i < 6; i++) tracker.record([conn(`203.0.113.${i}`, 443)], now);
    const fanOut = tracker.detectFanOut(now);
    expect(fanOut).toMatchObject({ destinationCount: 6 });
  });

  it('does not flag ordinary traffic to a couple of destinations', () => {
    const tracker = createOutboundTracker({ windowMs: 60_000, destinationThreshold: 5 });
    const now = 1_000_000;
    tracker.record([conn('203.0.113.1', 443), conn('203.0.113.2', 443)], now);
    expect(tracker.detectFanOut(now)).toBeNull();
  });

  it('does not re-flag again immediately after a fan-out was already reported', () => {
    const tracker = createOutboundTracker({ windowMs: 60_000, destinationThreshold: 3 });
    const now = 1_000_000;
    tracker.record([conn('203.0.113.1', 443), conn('203.0.113.2', 443), conn('203.0.113.3', 443)], now);
    expect(tracker.detectFanOut(now)).toBeTruthy();
    expect(tracker.detectFanOut(now + 1000)).toBeNull();
  });
});

describe('createOutboundTracker - beaconing', () => {
  it('flags a destination hit at a suspiciously regular interval', () => {
    const tracker = createOutboundTracker({ windowMs: 10 * 60_000, beaconMinOccurrences: 4, beaconToleranceMs: 500 });
    const start = 1_000_000;
    const intervalMs = 30_000;
    for (let i = 0; i < 5; i++) {
      tracker.record([conn('198.51.100.50', 8443)], start + i * intervalMs);
    }
    const flagged = tracker.detectBeacons(start + 5 * intervalMs);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ remoteIp: '198.51.100.50', remotePort: 8443, occurrences: 5, intervalMs });
  });

  it('does not flag irregular, bursty traffic to the same destination', () => {
    const tracker = createOutboundTracker({ windowMs: 10 * 60_000, beaconMinOccurrences: 4, beaconToleranceMs: 500 });
    const start = 1_000_000;
    const offsets = [0, 1200, 45000, 46500, 90000]; // wildly irregular gaps
    for (const offset of offsets) tracker.record([conn('198.51.100.51', 443)], start + offset);
    expect(tracker.detectBeacons(start + 90000)).toEqual([]);
  });

  it('does not re-flag a beacon it has already reported', () => {
    const tracker = createOutboundTracker({ windowMs: 10 * 60_000, beaconMinOccurrences: 3, beaconToleranceMs: 500 });
    const start = 1_000_000;
    for (let i = 0; i < 4; i++) tracker.record([conn('198.51.100.52', 443)], start + i * 10_000);
    expect(tracker.detectBeacons(start + 40_000)).toHaveLength(1);
    tracker.record([conn('198.51.100.52', 443)], start + 50_000);
    expect(tracker.detectBeacons(start + 50_000)).toEqual([]);
  });

  it('requires the minimum occurrence count before considering a beacon', () => {
    const tracker = createOutboundTracker({ windowMs: 10 * 60_000, beaconMinOccurrences: 5, beaconToleranceMs: 500 });
    const start = 1_000_000;
    for (let i = 0; i < 3; i++) tracker.record([conn('198.51.100.53', 443)], start + i * 10_000);
    expect(tracker.detectBeacons(start + 30_000)).toEqual([]);
  });
});
