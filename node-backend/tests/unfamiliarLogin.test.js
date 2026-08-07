import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin } from '../src/services/tenantContext.js';

// Real end-to-end check that logging in doesn't crash or misbehave now that
// every successful login runs the unfamiliar-location check (flagUnfamiliarLogin
// in app.js). A real geo lookup isn't exercised here (that's covered by the
// pure-logic tests in loginAnomaly.test.js) — a loopback request always
// resolves to 'Local / Private' before any external call would happen, so
// this only proves the login path stays fast, successful, and doesn't spam
// an audit trail for the ordinary local/dev case.

let userId;

beforeAll(async () => {
  await ready;

  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    await sequelize.models.User.destroy({ where: { name: 'unfamiliar_login_test' } });
    await sequelize.models.AuditLog.destroy({ where: { action: 'user.unfamiliar_login_location' }, force: true });

    const hash = await bcrypt.hash('password123', 10);
    const user = await sequelize.models.User.create({
      organizationId: org.id,
      name: 'unfamiliar_login_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27123456795',
      telegramChatId: '100000795',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    userId = user.id;
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /token — unfamiliar-location check does not disrupt normal login', () => {
  it('logs in successfully from a loopback request (resolves to Local / Private, never flagged)', async () => {
    const res = await request(app).post('/api/token').send({ username: 'unfamiliar_login_test', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
  });

  it('does not create an unfamiliar-login audit entry for a loopback/local login', async () => {
    // Give the best-effort async check a moment to run.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const entries = await runAsPlatformAdmin(() => sequelize.models.AuditLog.findAll({
      where: { entityType: 'user', entityId: String(userId), action: 'user.unfamiliar_login_location' },
    }));
    expect(entries).toHaveLength(0);
  });

  it('knownLoginGeos remains a real array on the user row, not corrupted', async () => {
    const user = await runAsPlatformAdmin(() => sequelize.models.User.findByPk(userId));
    expect(Array.isArray(user.knownLoginGeos)).toBe(true);
  });
});
