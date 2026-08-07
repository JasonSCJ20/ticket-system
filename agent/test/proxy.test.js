import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';

// Real integration test for the reverse-proxy mode: a real CommandCentre
// backend, a real plain-HTTP "upstream" app with zero CommandCentre code in
// it (simulating a pre-built system with no code access), and the real
// createReverseProxy() fronting it — nothing mocked. The registered asset's
// baseUrl points at the PROXY (what's actually reachable from the outside),
// which forwards to the upstream.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'sqlite://./agent-proxy-integration-test.db';
process.env.SECRET_KEY = 'test-secret-key-for-agent-proxy-integration-tests-only';
process.env.ADMIN_USERNAME = 'agent-proxy-test-admin';
process.env.ADMIN_PASSWORD = 'agent-proxy-test-password-123';
process.env.PORT = '0';

const { default: backendApp, ready: backendReady } = await import(
  '../../node-backend/src/app.js'
);
const { sequelize } = await import('../../node-backend/src/models/index.js');
const { runAsPlatformAdmin, runWithOrganization } = await import('../../node-backend/src/services/tenantContext.js');
const { createReverseProxy } = await import('../src/proxy.js');

let backendServer;
let apiBaseUrl;
let adminToken;
let assetId;
let upstreamServer;
let proxyServer;
let proxyBaseUrl;
let agentKey;
let defaultOrgId;

async function login() {
  const res = await fetch(`${apiBaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  });
  const body = await res.json();
  return body.access_token;
}

beforeAll(async () => {
  await backendReady;
  backendServer = backendApp.listen(0);
  await new Promise((resolve) => backendServer.once('listening', resolve));
  const port = backendServer.address().port;
  apiBaseUrl = `http://127.0.0.1:${port}/api`;

  defaultOrgId = await runAsPlatformAdmin(async () => {
    const admin = await sequelize.models.User.findOne({ where: { name: process.env.ADMIN_USERNAME } });
    await admin.update({
      telegramNumber: '+27123456781',
      telegramChatId: '100000902',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    return admin.organizationId;
  });

  adminToken = await login();
  expect(adminToken).toBeTruthy();

  const created = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.create({
    name: 'agent-proxy-integration-target',
    baseUrl: 'placeholder',
  }));
  assetId = created.id;

  const keyRes = await fetch(`${apiBaseUrl}/security/applications/${assetId}/agent-key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const keyBody = await keyRes.json();
  agentKey = keyBody.agentKey;

  // The "pre-built system" — genuinely no CommandCentre code, just a plain
  // Node HTTP server, standing in for something like a legacy PHP app.
  upstreamServer = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('upstream app ok');
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
  const upstreamPort = upstreamServer.address().port;

  proxyServer = createReverseProxy({
    assetId,
    agentKey,
    commandCentreUrl: apiBaseUrl,
    target: `http://127.0.0.1:${upstreamPort}`,
    port: 0,
    heartbeatIntervalMs: 500,
    commandPollIntervalMs: 500,
  });
  await new Promise((resolve) => proxyServer.once('listening', resolve));
  proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;

  await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.update({ baseUrl: proxyBaseUrl }, { where: { id: assetId } }));
}, 30000);

afterAll(async () => {
  proxyServer?.stop?.();
  upstreamServer?.close();
  backendServer?.close();
  await sequelize.close();
});

describe('createReverseProxy() fronting a plain HTTP app with zero CommandCentre code', () => {
  it('forwards a normal request through to the real upstream app untouched', async () => {
    const res = await fetch(`${proxyBaseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('upstream app ok');
  });

  it('sends real heartbeats and reaches verified status via the real canary flow, without any upstream code changes', async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));

    const statusBefore = await fetch(`${apiBaseUrl}/security/applications/${assetId}/enforcement-status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    expect(statusBefore.lastHeartbeatAt).not.toBeNull();

    const verify = await fetch(`${apiBaseUrl}/security/applications/${assetId}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    expect(verify.verificationId).toBeTruthy();

    let verified = false;
    for (let i = 0; i < 20 && !verified; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const check = await fetch(`${apiBaseUrl}/security/applications/${assetId}/verify/${verify.verificationId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((r) => r.json());
      verified = check.status === 'verified';
    }
    expect(verified).toBe(true);
  }, 20000);

  it('reports a shadow-mode finding for a malicious query string but still forwards the request', async () => {
    const res = await fetch(`${proxyBaseUrl}/?q=' OR '1'='1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('upstream app ok');

    await new Promise((resolve) => setTimeout(resolve, 300));
    const findings = await fetch(`${apiBaseUrl}/security/findings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    const match = (findings.results || findings).find?.((f) => f.title?.includes('SQL injection'));
    expect(match).toBeTruthy();
  }, 10000);

  it('promotes to active mode and then actually blocks the same malicious request before it ever reaches upstream', async () => {
    await fetch(`${apiBaseUrl}/security/applications/${assetId}/mode`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'active' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

    const res = await fetch(`${proxyBaseUrl}/?q=' OR '1'='1`);
    expect(res.status).toBe(403);
  }, 10000);

  it('blocks a specific IP once CommandCentre queues a block_ip command, and records it in the local command log', async () => {
    await fetch(`${apiBaseUrl}/security/applications/${assetId}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block_ip', target: '127.0.0.1', reason: 'proxy integration test' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

    const res = await fetch(`${proxyBaseUrl}/`);
    expect(res.status).toBe(403);

    const log = proxyServer.getCommandLog();
    expect(log.some((entry) => entry.action === 'block_ip' && entry.target === '127.0.0.1')).toBe(true);
  }, 10000);
});
