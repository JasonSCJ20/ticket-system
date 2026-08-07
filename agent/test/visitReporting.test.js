import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';

// Real integration test: real CommandCentre backend + real shield()
// middleware, verifying that legitimate traffic gets buffered in the agent
// and flushed as a batch on the heartbeat tick, landing in the real
// VisitorEvent table — nothing mocked.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'sqlite://./agent-visit-integration-test.db';
process.env.SECRET_KEY = 'test-secret-key-for-agent-visit-integration-tests-only';
process.env.ADMIN_USERNAME = 'agent-visit-test-admin';
process.env.ADMIN_PASSWORD = 'agent-visit-test-password-123';
process.env.PORT = '0';

const { default: backendApp, ready: backendReady } = await import(
  '../../node-backend/src/app.js'
);
const { sequelize } = await import('../../node-backend/src/models/index.js');
const { runAsPlatformAdmin, runWithOrganization } = await import('../../node-backend/src/services/tenantContext.js');
const { shield } = await import('../src/index.js');

let backendServer;
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
  apiBaseUrl = `http://127.0.0.1:${port}/api`;

  defaultOrgId = await runAsPlatformAdmin(async () => {
    const admin = await sequelize.models.User.findOne({ where: { name: process.env.ADMIN_USERNAME } });
    await admin.update({
      telegramNumber: '+27123456782',
      telegramChatId: '100000903',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    return admin.organizationId;
  });

  adminToken = await login();
  expect(adminToken).toBeTruthy();

  const created = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.create({
    name: 'agent-visit-integration-target',
    baseUrl: 'placeholder',
  }));
  assetId = created.id;

  const keyRes = await fetch(`${apiBaseUrl}/security/applications/${assetId}/agent-key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const keyBody = await keyRes.json();
  agentKey = keyBody.agentKey;

  const hostApp = express();
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
}, 30000);

afterAll(async () => {
  hostServer?.close();
  backendServer?.close();
  await sequelize.close();
});

describe('shield() visitor traffic batching', () => {
  it('buffers real requests and flushes them as a batch to CommandCentre on the next heartbeat', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${hostBaseUrl}/`);
      expect(res.status).toBe(200);
    }

    // Let a heartbeat tick fire for real, flushing the buffered visits.
    await new Promise((resolve) => setTimeout(resolve, 700));

    const summary = await fetch(`${apiBaseUrl}/security/applications/${assetId}/visitors/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());

    expect(summary.last24h.totalVisits).toBe(3);
    expect(summary.last24h.uniqueIps).toBe(1);
  }, 10000);
});
