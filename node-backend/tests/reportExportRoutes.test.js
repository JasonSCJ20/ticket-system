import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { extractAuthCookie } from './helpers/authCookie.js';

let adminToken;
let defaultOrgId;

beforeAll(async () => {
  await ready;
  const hash = await bcrypt.hash('password123', 10);
  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    defaultOrgId = org.id;
    await sequelize.models.User.destroy({ where: {} });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'export_admin_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27123456799',
      telegramChatId: '100000799',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });
  const res = await request(app).post('/api/token').send({ username: 'export_admin_test', password: 'password123' });
  adminToken = extractAuthCookie(res);
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/reports/executive/export.pdf', () => {
  it('returns a real PDF file as an attachment', async () => {
    const res = await request(app)
      .get('/api/reports/executive/export.pdf')
      .set('Cookie', adminToken);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*\.pdf"/);
    expect(Buffer.isBuffer(res.body) || res.body instanceof Uint8Array).toBe(true);
    expect(Buffer.from(res.body).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('rejects a non-admin request', async () => {
    await runWithOrganization(defaultOrgId, () => sequelize.models.User.create({
      name: 'export_analyst_test',
      role: 'analyst',
      password_hash: bcrypt.hashSync('password123', 10),
      telegramNumber: '+27123456798',
      telegramChatId: '100000798',
      audienceCode: 'STAFF',
      operationalTeams: ['Network'],
      department: 'Networks',
    }));
    const login = await request(app).post('/api/token').send({ username: 'export_analyst_test', password: 'password123' });
    const res = await request(app)
      .get('/api/reports/executive/export.pdf')
      .set('Cookie', extractAuthCookie(login));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/reports/technical/export.csv', () => {
  it('returns real CSV content as an attachment', async () => {
    const res = await request(app)
      .get('/api/reports/technical/export.csv')
      .set('Cookie', adminToken);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*\.csv"/);
    expect(res.text.split('\n')[0]).toBe('metric,key,value');
  });
});

describe('GET /api/reports/trends', () => {
  it('returns stored snapshots for trend charting', async () => {
    await runWithOrganization(defaultOrgId, async () => {
      await sequelize.models.ReportSnapshot.destroy({ where: {} });
      await sequelize.models.ReportSnapshot.create({
        type: 'executive',
        generatedAt: new Date('2026-01-01T06:00:00Z'),
        payload: { riskIndex: 20, posture: 'controlled' },
      });
      await sequelize.models.ReportSnapshot.create({
        type: 'executive',
        generatedAt: new Date('2026-01-02T06:00:00Z'),
        payload: { riskIndex: 35, posture: 'watch' },
      });
    });

    const res = await request(app)
      .get('/api/reports/trends?type=executive')
      .set('Cookie', adminToken);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].payload.riskIndex).toBe(20);
    expect(res.body[1].payload.riskIndex).toBe(35);
  });
});
