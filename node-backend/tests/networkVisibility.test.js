import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { extractAuthCookie } from './helpers/authCookie.js';

// A dedicated organization keeps this test's device counts exact — the
// route has no filter beyond tenant scoping, so sharing the default org
// with other test files' NetworkDevice fixtures would make exact-count
// assertions flaky.
let orgId;
let adminToken;

beforeAll(async () => {
  await ready;
  const hash = await bcrypt.hash('password123', 10);

  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.create({ name: 'Network Visibility Test Org', slug: `network-visibility-${Date.now()}` });
    orgId = org.id;
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'network_visibility_admin',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27100000400',
      telegramChatId: '200000400',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });

  await runWithOrganization(orgId, async () => {
    await sequelize.models.NetworkDevice.create({
      organizationId: orgId,
      name: 'core-router-1',
      deviceType: 'router',
      state: 'online',
      idsIpsEnabled: true,
      lastIdsIpsEventAt: new Date('2026-01-01T00:00:00Z'),
    });
    await sequelize.models.NetworkDevice.create({
      organizationId: orgId,
      name: 'core-router-2',
      deviceType: 'router',
      state: 'offline',
      idsIpsEnabled: false,
    });
    await sequelize.models.NetworkDevice.create({
      organizationId: orgId,
      name: 'floor-ap-1',
      deviceType: 'access_point',
      state: 'unknown',
      passiveScanEnabled: true,
      lastPassiveScanAt: new Date('2026-01-02T00:00:00Z'),
    });
  });

  const login = await request(app).post('/api/token').send({ username: 'network_visibility_admin', password: 'password123' });
  expect(login.status).toBe(200);
  adminToken = extractAuthCookie(login);
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/security/network-visibility/overview', () => {
  it('reports real device counts and real per-device sensor coverage, never invented device/sensor telemetry', async () => {
    const res = await request(app)
      .get('/api/security/network-visibility/overview')
      .set('Cookie', adminToken);

    expect(res.status).toBe(200);

    expect(res.body.inventory).toEqual({
      registeredDevices: 3,
      byType: { router: 2, access_point: 1 },
      online: 1,
      offline: 1,
      unknown: 1,
    });

    expect(res.body.sensorCoverage).toEqual({
      idsIpsEnabledDeviceCount: 1,
      idsIpsCoveragePercent: 33,
      lastIdsIpsEventAt: '2026-01-01T00:00:00.000Z',
      passiveScanEnabledDeviceCount: 1,
      passiveScanCoveragePercent: 33,
      lastPassiveScanAt: '2026-01-02T00:00:00.000Z',
    });

    // The previously-fabricated fields must be gone entirely, not just renamed.
    expect(res.body.sensors).toBeUndefined();
    expect(res.body.trafficAnalytics.topTalkers).toBeUndefined();
  });
});
