import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';

// Real integration test: a real CommandCentre backend instance (the actual
// node-backend, imported directly and started on an ephemeral port) plus a
// real host app running the real shield() middleware, talking over real
// HTTP — nothing here is mocked. This is the same package a client's app
// would install; the only difference from production use is that both ends
// happen to live in this monorepo.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'sqlite://./agent-integration-test.db';
process.env.SECRET_KEY = 'test-secret-key-for-agent-integration-tests-only';
process.env.ADMIN_USERNAME = 'agent-test-admin';
process.env.ADMIN_PASSWORD = 'agent-test-password-123';
process.env.PORT = '0';

const { default: backendApp, ready: backendReady } = await import(
  '../../node-backend/src/app.js'
);
const { sequelize } = await import('../../node-backend/src/models/index.js');
const { runAsPlatformAdmin, runWithOrganization } = await import('../../node-backend/src/services/tenantContext.js');
const { shield } = await import('../src/index.js');

let backendServer;
let backendBaseUrl;
let apiBaseUrl;
let adminToken;
let assetId;
let hostServer;
let hostBaseUrl;
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
  backendBaseUrl = `http://127.0.0.1:${port}`;
  apiBaseUrl = `${backendBaseUrl}/api`;

  // app.js's setup() unconditionally seeds exactly one persistent admin row
  // matching ADMIN_USERNAME/ADMIN_PASSWORD at boot (its own "Persistent
  // Admin Account" upsert) — work with that single row instead of creating
  // a second one with the same name, which would otherwise collide in the
  // login lookup and silently resolve to whichever row comes first.
  // Direct model access outside an HTTP request has no tenant context
  // established automatically — see node-backend's tenantContext.js.
  defaultOrgId = await runAsPlatformAdmin(async () => {
    const admin = await sequelize.models.User.findOne({ where: { name: process.env.ADMIN_USERNAME } });
    await admin.update({
      telegramNumber: '+27123456780',
      telegramChatId: '100000901',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    return admin.organizationId;
  });

  adminToken = await login();
  expect(adminToken).toBeTruthy();

  const created = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.create({
    name: 'agent-integration-target',
    baseUrl: 'placeholder',
  }));
  assetId = created.id;

  const keyRes = await fetch(`${apiBaseUrl}/security/applications/${assetId}/agent-key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const keyBody = await keyRes.json();
  agentKey = keyBody.agentKey;
  expect(agentKey).toMatch(/^cca_/);
}, 30000);

afterAll(async () => {
  hostServer?.close();
  backendServer?.close();
  await sequelize.close();
});

describe('shield() against a real CommandCentre backend', () => {
  it('starts a host app, sends real heartbeats, and reaches verified status via the real canary flow', async () => {
    const hostApp = express();
    hostApp.use(express.json());
    const middleware = shield({
      assetId,
      agentKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 500,
      commandPollIntervalMs: 500,
    });
    hostApp.use(middleware);
    hostApp.get('/', (_req, res) => res.send('host app ok'));

    hostServer = await new Promise((resolve) => {
      const server = http.createServer(hostApp).listen(0, '127.0.0.1', () => resolve(server));
    });
    hostBaseUrl = `http://127.0.0.1:${hostServer.address().port}`;

    // Point the registered asset's baseUrl at the real host app so the
    // backend's canary probe can actually reach it.
    await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.update({ baseUrl: hostBaseUrl }, { where: { id: assetId } }));

    // Let the heartbeat loop fire at least once for real.
    await new Promise((resolve) => setTimeout(resolve, 700));

    const statusBefore = await fetch(`${apiBaseUrl}/security/applications/${assetId}/enforcement-status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    expect(statusBefore.lastHeartbeatAt).not.toBeNull();
    expect(statusBefore.enforcementMode).toBe('shadow');

    const verify = await fetch(`${apiBaseUrl}/security/applications/${assetId}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    expect(verify.verificationId).toBeTruthy();

    // The real backend fires a real probe at hostBaseUrl; the real agent
    // middleware intercepts it and reports back — poll until it resolves.
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

  it('reports a shadow-mode finding but still serves the request', async () => {
    const res = await fetch(`${hostBaseUrl}/?q=' OR '1'='1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('host app ok');

    // Give the async finding report a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const findingsRes = await fetch(`${apiBaseUrl}/security/findings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const findings = await findingsRes.json();
    if (findingsRes.status !== 200) {
      console.log('DEBUG findings status', findingsRes.status, JSON.stringify(findings));
    }
    const match = (findings.results || findings).find?.((f) => f.title?.includes('SQL injection'));
    expect(match).toBeTruthy();
  }, 10000);

  it('promotes to active mode and then actually blocks the same request', async () => {
    const promote = await fetch(`${apiBaseUrl}/security/applications/${assetId}/mode`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'active' }),
    });
    expect(promote.status).toBe(200);

    // Wait for the agent's next heartbeat to pick up the mode change.
    await new Promise((resolve) => setTimeout(resolve, 700));

    const res = await fetch(`${hostBaseUrl}/?q=' OR '1'='1`);
    expect(res.status).toBe(403);
  }, 10000);

  it('blocks a specific IP once CommandCentre queues a block_ip command', async () => {
    await fetch(`${apiBaseUrl}/security/applications/${assetId}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block_ip', target: '127.0.0.1', reason: 'integration test' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

    const res = await fetch(`${hostBaseUrl}/`);
    expect(res.status).toBe(403);
  }, 10000);
});
