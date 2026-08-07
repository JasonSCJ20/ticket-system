import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin } from '../src/services/tenantContext.js';

let adminToken;
let ownerToken;
let otherOwnerToken;
let assetId;
let otherAssetId;
let agentKey;

beforeAll(async () => {
  await ready;

  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    await sequelize.models.User.destroy({ where: {} });
    await sequelize.models.ApplicationAsset.destroy({ where: {}, cascade: true, force: true });
    await sequelize.models.VisitorEvent.destroy({ where: {}, cascade: true, force: true });

    const hash = await bcrypt.hash('password123', 10);
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'admin_visitor_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27123456798',
      telegramChatId: '100000798',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'owner_visitor_test',
      role: 'owner',
      email: 'visitor-owner@example.com',
      password_hash: hash,
      telegramNumber: '+27123456797',
      telegramChatId: '100000797',
      audienceCode: 'DGSN',
      operationalTeams: [],
      department: 'External',
    });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'other_owner_visitor_test',
      role: 'owner',
      email: 'visitor-other-owner@example.com',
      password_hash: hash,
      telegramNumber: '+27123456796',
      telegramChatId: '100000796',
      audienceCode: 'DGSN',
      operationalTeams: [],
      department: 'External',
    });

    const asset = await sequelize.models.ApplicationAsset.create({
      organizationId: org.id,
      name: 'visitor-test-asset',
      baseUrl: 'https://visitor-test.example',
      environment: 'production',
      ownerEmail: 'visitor-owner@example.com',
    });
    assetId = asset.id;

    const otherAsset = await sequelize.models.ApplicationAsset.create({
      organizationId: org.id,
      name: 'visitor-test-other-asset',
      baseUrl: 'https://visitor-other-test.example',
      environment: 'production',
      ownerEmail: 'visitor-other-owner@example.com',
    });
    otherAssetId = otherAsset.id;
  });

  const adminLogin = await request(app).post('/api/token').send({ username: 'admin_visitor_test', password: 'password123' });
  adminToken = adminLogin.body.access_token;
  const ownerLogin = await request(app).post('/api/token').send({ username: 'owner_visitor_test', password: 'password123' });
  ownerToken = ownerLogin.body.access_token;
  const otherOwnerLogin = await request(app).post('/api/token').send({ username: 'other_owner_visitor_test', password: 'password123' });
  otherOwnerToken = otherOwnerLogin.body.access_token;

  const keyRes = await request(app)
    .post(`/api/security/applications/${assetId}/agent-key`)
    .set('Authorization', `Bearer ${adminToken}`);
  agentKey = keyRes.body.agentKey;
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /security/applications/:id/visit-report', () => {
  it('rejects a request with no agent key', async () => {
    const res = await request(app)
      .post(`/api/security/applications/${assetId}/visit-report`)
      .send({ visits: [{ ipAddress: '203.0.113.5' }] });
    expect(res.status).toBe(401);
  });

  it('rejects an empty visits array', async () => {
    const res = await request(app)
      .post(`/api/security/applications/${assetId}/visit-report`)
      .set('x-agent-key', agentKey)
      .send({ visits: [] });
    expect(res.status).toBe(422);
  });

  it('accepts a real batch of visits and records them', async () => {
    const res = await request(app)
      .post(`/api/security/applications/${assetId}/visit-report`)
      .set('x-agent-key', agentKey)
      .send({
        visits: [
          { ipAddress: '203.0.113.5', userAgent: 'Mozilla/5.0', path: '/', method: 'GET', statusCode: 200 },
          { ipAddress: '203.0.113.5', path: '/pricing', method: 'GET', statusCode: 200 },
          { ipAddress: '198.51.100.9', path: '/contact', method: 'POST', statusCode: 201 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.recorded).toBe(3);

    const stored = await runAsPlatformAdmin(() => sequelize.models.VisitorEvent.findAll({ where: { applicationAssetId: assetId } }));
    expect(stored).toHaveLength(3);
  });
});

describe('GET /security/applications/:id/visitors/summary', () => {
  it('admin sees the real aggregate counts', async () => {
    const res = await request(app)
      .get(`/api/security/applications/${assetId}/visitors/summary`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.last24h.totalVisits).toBe(3);
    expect(res.body.last24h.uniqueIps).toBe(2);
  });

  it('the owning owner can see their own asset visitor summary', async () => {
    const res = await request(app)
      .get(`/api/security/applications/${assetId}/visitors/summary`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.last24h.totalVisits).toBe(3);
  });

  it('a different owner cannot see this asset\'s visitor summary', async () => {
    const res = await request(app)
      .get(`/api/security/applications/${assetId}/visitors/summary`)
      .set('Authorization', `Bearer ${otherOwnerToken}`);
    expect(res.status).toBe(404);
  });

  it('an owner\'s own (empty) asset returns zero counts, not another org\'s data', async () => {
    const res = await request(app)
      .get(`/api/security/applications/${otherAssetId}/visitors/summary`)
      .set('Authorization', `Bearer ${otherOwnerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.last24h.totalVisits).toBe(0);
  });
});
