import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin } from '../src/services/tenantContext.js';

let ownerToken;
let otherOwnerToken;
let adminToken;
let myAssetId;
let otherAssetId;

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
  });

  const adminLogin = await request(app).post('/api/token').send({ username: 'admin_owner_test', password: 'password123' });
  adminToken = adminLogin.body.access_token;
  const ownerLogin = await request(app).post('/api/token').send({ username: 'owner_test_a', password: 'password123' });
  ownerToken = ownerLogin.body.access_token;
  const otherOwnerLogin = await request(app).post('/api/token').send({ username: 'owner_test_b', password: 'password123' });
  otherOwnerToken = otherOwnerLogin.body.access_token;
});

afterAll(async () => {
  await sequelize.close();
});

describe('owner-role asset/finding scoping', () => {
  it('an owner sees only their own asset in GET /applications', async () => {
    const res = await request(app).get('/api/security/applications').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((a) => a.id);
    expect(ids).toContain(myAssetId);
    expect(ids).not.toContain(otherAssetId);
  });

  it('a different owner sees only their own, different asset', async () => {
    const res = await request(app).get('/api/security/applications').set('Authorization', `Bearer ${otherOwnerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((a) => a.id);
    expect(ids).toContain(otherAssetId);
    expect(ids).not.toContain(myAssetId);
  });

  it('an owner sees only findings tied to their own asset in GET /findings', async () => {
    const res = await request(app).get('/api/security/findings').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const titles = res.body.map((f) => f.title);
    expect(titles).toContain('Finding on asset A');
    expect(titles).not.toContain('Finding on asset B');
  });

  it('admin is unaffected and still sees every asset and finding', async () => {
    const assetsRes = await request(app).get('/api/security/applications').set('Authorization', `Bearer ${adminToken}`);
    const ids = assetsRes.body.map((a) => a.id);
    expect(ids).toContain(myAssetId);
    expect(ids).toContain(otherAssetId);

    const findingsRes = await request(app).get('/api/security/findings').set('Authorization', `Bearer ${adminToken}`);
    const titles = findingsRes.body.map((f) => f.title);
    expect(titles).toContain('Finding on asset A');
    expect(titles).toContain('Finding on asset B');
  });
});
