import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin } from '../src/services/tenantContext.js';
import { extractAuthCookie } from './helpers/authCookie.js';

let ownerToken;
let otherOwnerToken;
let adminToken;
let myAssetId;
let otherAssetId;
let myDeviceId;
let otherDeviceId;
let orphanDeviceId;

beforeAll(async () => {
  await ready;

  // Direct model access outside an HTTP request has no tenant context
  // established automatically — this whole fixture setup runs as a
  // platform-admin operation, with organizationId set explicitly on every
  // create (platform-admin deliberately does not auto-stamp it).
  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    await sequelize.models.User.destroy({ where: {} });
    await sequelize.models.ApplicationAsset.destroy({ where: {}, cascade: true, force: true });
    await sequelize.models.SecurityFinding.destroy({ where: {}, cascade: true, force: true });
    await sequelize.models.NetworkDevice.destroy({ where: {}, cascade: true, force: true });

    const hash = await bcrypt.hash('password123', 10);

    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'admin_owner_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27123456700',
      telegramChatId: '100000700',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'owner_test_a',
      role: 'owner',
      email: 'owner-a@example.com',
      password_hash: hash,
      telegramNumber: '+27123456701',
      telegramChatId: '100000701',
      audienceCode: 'DGSN',
      operationalTeams: [],
      department: 'External',
    });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'owner_test_b',
      role: 'owner',
      email: 'owner-b@example.com',
      password_hash: hash,
      telegramNumber: '+27123456702',
      telegramChatId: '100000702',
      audienceCode: 'DGSN',
      operationalTeams: [],
      department: 'External',
    });

    const myAsset = await sequelize.models.ApplicationAsset.create({
      organizationId: org.id,
      name: `owned-by-a-${Date.now()}`,
      baseUrl: 'https://owner-a-asset.test',
      environment: 'production',
      enabled: true,
      ownerEmail: 'owner-a@example.com',
    });
    myAssetId = myAsset.id;

    const otherAsset = await sequelize.models.ApplicationAsset.create({
      organizationId: org.id,
      name: `owned-by-b-${Date.now()}`,
      baseUrl: 'https://owner-b-asset.test',
      environment: 'production',
      enabled: true,
      ownerEmail: 'owner-b@example.com',
    });
    otherAssetId = otherAsset.id;

    await sequelize.models.SecurityFinding.create({
      organizationId: org.id,
      applicationAssetId: myAssetId,
      sourceTool: 'Test',
      detectionMode: 'active',
      category: 'vulnerability',
      severity: 'high',
      title: 'Finding on asset A',
      description: 'x',
      requiresManualConfirmation: true,
    });
    await sequelize.models.SecurityFinding.create({
      organizationId: org.id,
      applicationAssetId: otherAssetId,
      sourceTool: 'Test',
      detectionMode: 'active',
      category: 'vulnerability',
      severity: 'high',
      title: 'Finding on asset B',
      description: 'x',
      requiresManualConfirmation: true,
    });

    const myDevice = await sequelize.models.NetworkDevice.create({
      organizationId: org.id,
      name: `device-of-a-${Date.now()}`,
      deviceType: 'router',
      applicationAssetId: myAssetId,
    });
    myDeviceId = myDevice.id;
    const otherDevice = await sequelize.models.NetworkDevice.create({
      organizationId: org.id,
      name: `device-of-b-${Date.now()}`,
      deviceType: 'router',
      applicationAssetId: otherAssetId,
    });
    otherDeviceId = otherDevice.id;
    const orphanDevice = await sequelize.models.NetworkDevice.create({
      organizationId: org.id,
      name: `orphan-device-${Date.now()}`,
      deviceType: 'router',
    });
    orphanDeviceId = orphanDevice.id;
  });

  const adminLogin = await request(app).post('/api/token').send({ username: 'admin_owner_test', password: 'password123' });
  adminToken = extractAuthCookie(adminLogin);
  const ownerLogin = await request(app).post('/api/token').send({ username: 'owner_test_a', password: 'password123' });
  ownerToken = extractAuthCookie(ownerLogin);
  const otherOwnerLogin = await request(app).post('/api/token').send({ username: 'owner_test_b', password: 'password123' });
  otherOwnerToken = extractAuthCookie(otherOwnerLogin);
});

afterAll(async () => {
  await sequelize.close();
});

describe('owner-role asset/finding scoping', () => {
  it('an owner sees only their own asset in GET /applications', async () => {
    const res = await request(app).get('/api/security/applications').set('Cookie', ownerToken);
    expect(res.status).toBe(200);
    const ids = res.body.map((a) => a.id);
    expect(ids).toContain(myAssetId);
    expect(ids).not.toContain(otherAssetId);
  });

  it('a different owner sees only their own, different asset', async () => {
    const res = await request(app).get('/api/security/applications').set('Cookie', otherOwnerToken);
    expect(res.status).toBe(200);
    const ids = res.body.map((a) => a.id);
    expect(ids).toContain(otherAssetId);
    expect(ids).not.toContain(myAssetId);
  });

  it('an owner sees only findings tied to their own asset in GET /findings', async () => {
    const res = await request(app).get('/api/security/findings').set('Cookie', ownerToken);
    expect(res.status).toBe(200);
    const titles = res.body.map((f) => f.title);
    expect(titles).toContain('Finding on asset A');
    expect(titles).not.toContain('Finding on asset B');
  });

  it('admin is unaffected and still sees every asset and finding', async () => {
    const assetsRes = await request(app).get('/api/security/applications').set('Cookie', adminToken);
    const ids = assetsRes.body.map((a) => a.id);
    expect(ids).toContain(myAssetId);
    expect(ids).toContain(otherAssetId);

    const findingsRes = await request(app).get('/api/security/findings').set('Cookie', adminToken);
    const titles = findingsRes.body.map((f) => f.title);
    expect(titles).toContain('Finding on asset A');
    expect(titles).toContain('Finding on asset B');
  });

  it('an owner can fetch the brief for their own finding', async () => {
    const findingsRes = await request(app).get('/api/security/findings').set('Cookie', ownerToken);
    const mine = findingsRes.body.find((f) => f.title === 'Finding on asset A');
    const res = await request(app).get(`/api/security/findings/${mine.id}/brief`).set('Cookie', ownerToken);
    expect(res.status).toBe(200);
  });

  it('an owner gets 404, not the data, when guessing another owner\'s finding ID', async () => {
    const adminFindingsRes = await request(app).get('/api/security/findings').set('Cookie', adminToken);
    const notMine = adminFindingsRes.body.find((f) => f.title === 'Finding on asset B');
    const res = await request(app).get(`/api/security/findings/${notMine.id}/brief`).set('Cookie', ownerToken);
    expect(res.status).toBe(404);
  });

  it('an owner sees only network devices that belong to their own application, never orphans or other owners\' devices', async () => {
    const res = await request(app).get('/api/security/network/devices').set('Cookie', ownerToken);
    expect(res.status).toBe(200);
    const ids = res.body.map((d) => d.id);
    expect(ids).toContain(myDeviceId);
    expect(ids).not.toContain(otherDeviceId);
    expect(ids).not.toContain(orphanDeviceId);
  });

  it('admin still sees every network device including orphans', async () => {
    const res = await request(app).get('/api/security/network/devices').set('Cookie', adminToken);
    const ids = res.body.map((d) => d.id);
    expect(ids).toContain(myDeviceId);
    expect(ids).toContain(otherDeviceId);
    expect(ids).toContain(orphanDeviceId);
  });
});

describe('owner role is blocked from internal-only routes', () => {
  it('cannot list tickets', async () => {
    const res = await request(app).get('/api/tickets').set('Cookie', ownerToken);
    expect(res.status).toBe(403);
  });

  it('cannot list the team roster', async () => {
    const res = await request(app).get('/api/users').set('Cookie', ownerToken);
    expect(res.status).toBe(403);
  });

  it('cannot fetch monthly or technical reports', async () => {
    const monthly = await request(app).get('/api/reports/monthly').set('Cookie', ownerToken);
    expect(monthly.status).toBe(403);
    const technical = await request(app).get('/api/reports/technical').set('Cookie', ownerToken);
    expect(technical.status).toBe(403);
  });

  it('cannot read SOC operational telemetry', async () => {
    const feed = await request(app).get('/api/security/soc/live-feed').set('Cookie', ownerToken);
    expect(feed.status).toBe(403);
    const origins = await request(app).get('/api/security/soc/threat-origins').set('Cookie', ownerToken);
    expect(origins.status).toBe(403);
  });

  it('cannot list patch tasks or scan run history', async () => {
    const patches = await request(app).get('/api/security/patches').set('Cookie', ownerToken);
    expect(patches.status).toBe(403);
    const scans = await request(app).get('/api/security/scan/runs').set('Cookie', ownerToken);
    expect(scans.status).toBe(403);
  });

  it('cannot confirm a finding or create a ticket from one', async () => {
    const findingsRes = await request(app).get('/api/security/findings').set('Cookie', ownerToken);
    const mine = findingsRes.body.find((f) => f.title === 'Finding on asset A');
    const confirm = await request(app).post(`/api/security/findings/${mine.id}/confirm`).set('Cookie', ownerToken);
    expect(confirm.status).toBe(403);
    const createTicket = await request(app).post(`/api/security/findings/${mine.id}/create-ticket`).set('Cookie', ownerToken);
    expect(createTicket.status).toBe(403);
  });

  it('cannot read the remaining internal aggregate/overview routes (Phase 3 sweep)', async () => {
    const paths = [
      '/api/security/database/overview',
      '/api/security/detection/stack',
      '/api/security/executive-impact',
      '/api/security/threat-intel/overview',
      '/api/security/network-visibility/overview',
      // Missed in the original Phase 3 sweep — found during a later
      // production-readiness audit. Neither is scoped to just the owner's
      // own assets, and fortress/posture includes real staff usernames
      // from recent privileged actions, which is never client-facing.
      '/api/security/health-summary',
      '/api/security/fortress/posture',
    ];
    for (const path of paths) {
      const res = await request(app).get(path).set('Cookie', ownerToken);
      expect(res.status).toBe(403);
    }
  });

  it('admin and analyst are unaffected by the new gates', async () => {
    const ticketsAdmin = await request(app).get('/api/tickets').set('Cookie', adminToken);
    expect(ticketsAdmin.status).toBe(200);
    const usersAdmin = await request(app).get('/api/users').set('Cookie', adminToken);
    expect(usersAdmin.status).toBe(200);
  });
});
