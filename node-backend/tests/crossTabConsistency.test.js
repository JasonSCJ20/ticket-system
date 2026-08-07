import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin } from '../src/services/tenantContext.js';

// Guards the fix for a real cross-tab discrepancy: the Overview/Dashboard
// page used to fetch GET /security/findings with no filters (capped at a
// flat `limit`, ordered by riskScore DESC across ALL statuses) and then
// filter client-side for "needs a decision" (high/critical severity, open
// status). Once an org accumulates enough historical findings, older
// high-scoring *resolved* findings can crowd newer, lower-scoring *open*
// ones out of that capped window — so the Dashboard's count silently
// undercounts relative to what filtering the real Findings tab by the same
// statuses returns. The fix moves the filtering server-side (comma-separated
// status/severity query params), which these tests exercise directly.

let adminToken;
let assetId;

beforeAll(async () => {
  await ready;

  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    await sequelize.models.User.destroy({ where: {} });
    await sequelize.models.ApplicationAsset.destroy({ where: {}, cascade: true, force: true });
    await sequelize.models.SecurityFinding.destroy({ where: {}, cascade: true, force: true });

    const hash = await bcrypt.hash('password123', 10);
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'admin_crosstab_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27123456799',
      telegramChatId: '100000799',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });

    const asset = await sequelize.models.ApplicationAsset.create({
      organizationId: org.id,
      name: 'crosstab-test-asset',
      baseUrl: 'https://example.test',
      environment: 'production',
    });
    assetId = asset.id;

    // A pile of old, high-scoring but already-resolved findings — these
    // used to be able to crowd a genuinely open, high-severity finding out
    // of a flat riskScore-ordered, capped result set.
    for (let i = 0; i < 10; i += 1) {
      await sequelize.models.SecurityFinding.create({
        organizationId: org.id,
        applicationAssetId: assetId,
        sourceTool: 'test',
        detectionMode: 'passive',
        category: 'test_noise',
        severity: 'critical',
        riskScore: 95,
        status: 'remediated',
        title: `Old resolved noise finding #${i}`,
        description: 'noise',
      });
    }

    await sequelize.models.SecurityFinding.create({
      organizationId: org.id,
      applicationAssetId: assetId,
      sourceTool: 'test',
      detectionMode: 'active',
      category: 'intrusion_attempt',
      severity: 'critical',
      riskScore: 10,
      status: 'new',
      title: 'Genuinely open critical finding',
      description: 'real, unresolved',
    });

    await sequelize.models.SecurityFinding.create({
      organizationId: org.id,
      applicationAssetId: assetId,
      sourceTool: 'test',
      detectionMode: 'passive',
      category: 'misconfiguration',
      severity: 'low',
      riskScore: 5,
      status: 'investigating',
      title: 'Open but low severity finding',
      description: 'should not count as needing a decision',
    });

    const login = await request(app).post('/api/token').send({ username: 'admin_crosstab_test', password: 'password123' });
    adminToken = login.body.access_token;
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /security/findings — multi-value status/severity filters (Dashboard <-> Findings consistency)', () => {
  it('rejects an invalid status value', async () => {
    const res = await request(app)
      .get('/api/security/findings?status=not-a-real-status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
  });

  it('rejects an invalid severity value', async () => {
    const res = await request(app)
      .get('/api/security/findings?severity=super-critical')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
  });

  it('returns the genuinely open, high-severity finding even with a pile of higher-scoring resolved noise ahead of it', async () => {
    const res = await request(app)
      .get('/api/security/findings?status=new,investigating&severity=high,critical')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const titles = res.body.map((f) => f.title);
    expect(titles).toContain('Genuinely open critical finding');
    expect(titles).not.toContain('Open but low severity finding');
    expect(titles.filter((t) => t.startsWith('Old resolved noise'))).toHaveLength(0);
  });

  it('matches the count a real Findings-tab-style single-status fetch would show', async () => {
    const dashboardStyle = await request(app)
      .get('/api/security/findings?status=new,investigating&severity=high,critical')
      .set('Authorization', `Bearer ${adminToken}`)
      .then((r) => r.body);

    const findingsTabNew = await request(app)
      .get('/api/security/findings?status=new')
      .set('Authorization', `Bearer ${adminToken}`)
      .then((r) => r.body);
    const findingsTabInvestigating = await request(app)
      .get('/api/security/findings?status=investigating')
      .set('Authorization', `Bearer ${adminToken}`)
      .then((r) => r.body);

    const independentCount = [...findingsTabNew, ...findingsTabInvestigating]
      .filter((f) => ['high', 'critical'].includes(f.severity)).length;

    expect(dashboardStyle.length).toBe(independentCount);
  });
});
