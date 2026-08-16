import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Real integration test proving the fix for a gap the audit flagged: an
// already-acknowledged block_ip command used to vanish from a restarted
// agent's memory, since /commands/pending only ever serves still-pending
// commands. Everything here is real — a real backend, a real queued
// command, a real ack, then a genuinely fresh createAgentCore instance
// (simulating a process restart with empty local state) that must recover
// the block on its own before ever being told about it again.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'sqlite://./agent-resync-integration-test.db';
process.env.SECRET_KEY = 'test-secret-key-for-agent-resync-integration-tests-only';
process.env.ADMIN_USERNAME = 'agent-resync-test-admin';
process.env.ADMIN_PASSWORD = 'agent-resync-test-password-123';
process.env.PORT = '0';

const { default: backendApp, ready: backendReady } = await import(
  '../../node-backend/src/app.js'
);
const { sequelize } = await import('../../node-backend/src/models/index.js');
const { runAsPlatformAdmin, runWithOrganization } = await import('../../node-backend/src/services/tenantContext.js');
const { createAgentCore } = await import('../src/core.js');

let backendServer;
let apiBaseUrl;
let adminToken;
let assetId;

async function login() {
  const res = await fetch(`${apiBaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  });
  const setCookie = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const authCookie = setCookie.find((line) => line.startsWith('access_token='));
  if (!authCookie) return null;
  return decodeURIComponent(authCookie.split(';')[0].split('=').slice(1).join('='));
}

let agentKey;

beforeAll(async () => {
  await backendReady;
  backendServer = backendApp.listen(0);
  await new Promise((resolve) => backendServer.once('listening', resolve));
  const port = backendServer.address().port;
  apiBaseUrl = `http://127.0.0.1:${port}/api`;

  const defaultOrgId = await runAsPlatformAdmin(async () => {
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
    name: 'agent-resync-integration-target',
    baseUrl: 'placeholder',
  }));
  assetId = created.id;

  const keyRes = await fetch(`${apiBaseUrl}/security/applications/${assetId}/agent-key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  agentKey = (await keyRes.json()).agentKey;
}, 30000);

afterAll(async () => {
  backendServer?.close();
  await sequelize.close();
});

describe('agent core resync on restart', () => {
  it('a fresh instance recovers an already-acknowledged block without a new command ever being issued', async () => {
    const firstInstance = createAgentCore({
      assetId,
      agentKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 200,
    });

    await fetch(`${apiBaseUrl}/security/applications/${assetId}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block_ip', target: '198.51.100.23', reason: 'resync test' }),
    });

    // Let the first instance's real poll loop pick up and ack the command.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(firstInstance.isIpBlocked('198.51.100.23')).toBe(true);
    firstInstance.stop();

    // A brand-new instance — no polling has happened yet, no knowledge of
    // the (already-acked) block at all — must recover it during its own
    // startup resync, before its first command poll would even run.
    const secondInstance = createAgentCore({
      assetId,
      agentKey,
      commandCentreUrl: apiBaseUrl,
      heartbeatIntervalMs: 100_000,
      commandPollIntervalMs: 100_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(secondInstance.isIpBlocked('198.51.100.23')).toBe(true);
    secondInstance.stop();
  }, 15000);
});
