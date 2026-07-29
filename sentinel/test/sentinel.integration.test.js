import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Real integration test: a real CommandCentre backend instance (the actual
// node-backend, imported directly and started on an ephemeral port) plus the
// real sentinel() daemon, talking over real HTTP — nothing here is mocked
// except the two things that genuinely can't run in a test environment: the
// real firewall (no root/iptables here) and the real /proc/net/tcp reads
// (this test host's actual network state, not a simulated scan).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'sqlite://./sentinel-integration-test.db';
process.env.SECRET_KEY = 'test-secret-key-for-sentinel-integration-tests-only';
process.env.ASSET_CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key-not-for-production-use';
process.env.ADMIN_USERNAME = 'sentinel-test-admin';
process.env.ADMIN_PASSWORD = 'sentinel-test-password-123';
process.env.PORT = '0';

const { default: backendApp, ready: backendReady } = await import(
  '../../node-backend/src/app.js'
);
const { sequelize } = await import('../../node-backend/src/models/index.js');
const { sentinel } = await import('../src/index.js');

let backendServer;
let backendBaseUrl;
let apiBaseUrl;
let adminToken;
let assetId;

async function login() {
  const res = await fetch(`${apiBaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  });
  const data = await res.json();
  return data.access_token;
}

async function api(path, { method = 'GET', body, key } = {}) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(key ? { 'x-agent-key': key } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data };
}

beforeAll(async () => {
  await backendReady;
  backendServer = backendApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => backendServer.on('listening', resolve));
  const port = backendServer.address().port;
  backendBaseUrl = `http://127.0.0.1:${port}`;
  apiBaseUrl = `${backendBaseUrl}/api`;

  const admin = await sequelize.models.User.findOne({ where: { name: process.env.ADMIN_USERNAME } });
  await admin.update({
    telegramNumber: '+27123456781',
    telegramChatId: '100000902',
    audienceCode: 'TJN',
    operationalTeams: ['Network'],
    department: 'Networks',
  });
  adminToken = await login();

  const created = await api('/security/applications', {
    method: 'POST',
    body: { name: `router-${Date.now()}`, assetType: 'router', ipAddress: '10.0.0.1', environment: 'production' },
  });
  assetId = created.body.id;
});

afterAll(async () => {
  await new Promise((resolve) => backendServer.close(resolve));
});

describe('sentinel() against a real CommandCentre backend', () => {
  it('registers via heartbeat and reports its open-port inventory', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    expect(issued.status).toBe(201);
    const sentinelKey = issued.body.sentinelKey;

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000, // only the initial immediate run fires in this test
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      readOpenPorts: () => [22, 443],
      readConnections: () => [],
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    instance.stop();

    const status = await api(`/security/applications/${assetId}/enforcement-status`);
    expect(status.body.hasSentinelKey).toBe(true);
    expect(status.body.lastSentinelHeartbeatAt).not.toBeNull();
    expect(status.body.lastKnownOpenPorts).toEqual([22, 443]);
    expect(status.body.sentinelMode).toBe('shadow');
  });

  it('detects a simulated port scan, reports it, and does not touch the firewall in shadow mode', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    const blockIp = vi.fn();

    // Simulate one remote IP hitting many distinct local ports — the exact
    // shape connectionTracker.js is designed to catch.
    const scannerConnections = Array.from({ length: 20 }, (_, i) => ({
      remoteIp: '203.0.113.50', remotePort: 55000, localIp: '10.0.0.1', localPort: 1000 + i, state: 'ESTABLISHED',
    }));

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      firewall: { blockIp, unblockIp: vi.fn(), listBlockedIps: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => scannerConnections,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    instance.stop();

    expect(blockIp).not.toHaveBeenCalled(); // shadow mode: report only

    const findings = await api('/security/findings?status=new');
    const scanFinding = findings.body.find((f) => f.category === 'port_scan' && f.affectedAssetRef === '10.0.0.1');
    expect(scanFinding).toBeTruthy();
    expect(scanFinding.requiresManualConfirmation).toBe(true);
  });

  it('promotes to active mode, then actually blocks a scanning IP via the injected firewall', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;

    // A fresh key resets lastSentinelHeartbeatAt to null — need one real
    // heartbeat on record before /sentinel-mode will allow promotion.
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });

    const promoted = await api(`/security/applications/${assetId}/sentinel-mode`, { method: 'PATCH', body: { mode: 'active' } });
    expect(promoted.status).toBe(200);
    expect(promoted.body.sentinelMode).toBe('active');

    const blockIp = vi.fn().mockResolvedValue(undefined);
    const scannerConnections = Array.from({ length: 20 }, (_, i) => ({
      remoteIp: '203.0.113.77', remotePort: 55000, localIp: '10.0.0.1', localPort: 2000 + i, state: 'ESTABLISHED',
    }));

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      firewall: { blockIp, unblockIp: vi.fn(), listBlockedIps: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => scannerConnections,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    instance.stop();

    expect(blockIp).toHaveBeenCalledWith('203.0.113.77');
  });

  it('executes a manually-queued block_ip command from the operator UI via the real command-poll loop', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });

    const queued = await api(`/security/applications/${assetId}/commands`, {
      method: 'POST',
      body: { action: 'block_ip', target: '198.51.100.99', reason: 'manual operator action' },
    });
    expect(queued.status).toBe(201);

    const blockIp = vi.fn().mockResolvedValue(undefined);
    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100, // fast poll so this test doesn't need to wait long
      scanCheckIntervalMs: 100_000,
      firewall: { blockIp, unblockIp: vi.fn(), listBlockedIps: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => [],
    });

    await new Promise((resolve) => setTimeout(resolve, 400));
    instance.stop();

    expect(blockIp).toHaveBeenCalledWith('198.51.100.99');

    const pending = await api(`/security/applications/${assetId}/commands/pending`, { key: sentinelKey });
    expect(pending.body).toEqual([]); // acked, no longer pending
  });
});
