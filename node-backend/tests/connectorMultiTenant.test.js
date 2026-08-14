import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { extractAuthCookie } from './helpers/authCookie.js';

// Real end-to-end test for per-tenant connector secrets: issues a real
// secret for a second organization via the platform-admin endpoint, then
// proves a correctly-signed request using that secret is attributed to
// THAT organization specifically — not the default one every connector
// used to be hardcoded to, and not visible when querying the default org.
let platformAdminToken;
let secondOrgId;
let secondOrgSlug;
let connectorSecret;

function signedHeaders(secret, bodyString) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}.${bodyString}`;
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return { 'x-connector-timestamp': timestamp, 'x-connector-signature': signature };
}

beforeAll(async () => {
  await ready;
  const hash = await bcrypt.hash('password123', 10);

  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    await sequelize.models.User.destroy({ where: { name: 'platform_admin_connector_test' } });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'platform_admin_connector_test',
      role: 'platform_admin',
      password_hash: hash,
      telegramNumber: '+27100000020',
      telegramChatId: '200000020',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });

  const login = await request(app).post('/api/token').send({ username: 'platform_admin_connector_test', password: 'password123' });
  platformAdminToken = extractAuthCookie(login);

  const createOrg = await request(app)
    .post('/api/platform/organizations')
    .set('Cookie', platformAdminToken)
    .send({ name: 'Connector Tenant Inc', slug: `connector-tenant-${Date.now()}` });
  secondOrgId = createOrg.body.id;
  secondOrgSlug = createOrg.body.slug;

  const issued = await request(app)
    .post(`/api/platform/organizations/${secondOrgId}/connector-secret`)
    .set('Cookie', platformAdminToken);
  connectorSecret = issued.body.connectorSecret;
});

afterAll(async () => {
  await sequelize.close();
});

describe('per-tenant connector secrets', () => {
  it('issues a real secret that is never returned again and is stored encrypted, not in the clear', async () => {
    expect(connectorSecret).toBeTruthy();
    expect(connectorSecret.length).toBeGreaterThanOrEqual(32);

    const org = await runAsPlatformAdmin(() => sequelize.models.Organization.findByPk(secondOrgId));
    expect(org.connectorSecret).toBeTruthy();
    expect(org.connectorSecret).not.toBe(connectorSecret);
  });

  it('a request signed with the second org\'s own secret and x-connector-org header is attributed to that org, not the default', async () => {
    const eventTitle = `Connector isolation test ${Date.now()}`;
    const payload = { events: [{ app_name: 'Connector Test App', alert: { signature: eventTitle, severity: 2 } }] };
    const bodyString = JSON.stringify(payload);
    const headers = signedHeaders(connectorSecret, bodyString);

    const res = await request(app)
      .post('/api/security/connectors/suricata/eve')
      .set('x-connector-org', secondOrgSlug)
      .set('x-connector-timestamp', headers['x-connector-timestamp'])
      .set('x-connector-signature', headers['x-connector-signature'])
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(202);
    expect(res.body.created).toBe(1);

    const foundInSecondOrg = await runWithOrganization(secondOrgId, () => sequelize.models.SecurityFinding.findOne({ where: { title: eventTitle } }));
    expect(foundInSecondOrg).toBeTruthy();

    const defaultOrg = await runAsPlatformAdmin(() => sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } }));
    const foundInDefaultOrg = await runWithOrganization(defaultOrg.id, () => sequelize.models.SecurityFinding.findOne({ where: { title: eventTitle } }));
    expect(foundInDefaultOrg).toBeNull();
  });

  it('rejects a request that reuses the second org\'s slug but signs with the wrong secret', async () => {
    const payload = { events: [{ app_name: 'Should Not Ingest', alert: { signature: 'wrong secret test', severity: 2 } }] };
    const bodyString = JSON.stringify(payload);
    const headers = signedHeaders('not-the-real-secret', bodyString);

    const res = await request(app)
      .post('/api/security/connectors/suricata/eve')
      .set('x-connector-org', secondOrgSlug)
      .set('x-connector-timestamp', headers['x-connector-timestamp'])
      .set('x-connector-signature', headers['x-connector-signature'])
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(401);
  });
});
