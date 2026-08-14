import request from 'supertest';
import bcrypt from 'bcryptjs';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { computeAuditHash, verifyAuditChain } from '../src/services/auditChain.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { extractAuthCookie } from './helpers/authCookie.js';

let token;
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
      name: 'auditchain_admin',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27123456780',
      telegramChatId: '100000901',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });
  const res = await request(app).post('/api/token').send({ username: 'auditchain_admin', password: 'password123' });
  token = extractAuthCookie(res);
});

afterAll(async () => {
  await sequelize.close();
});

describe('computeAuditHash', () => {
  it('is deterministic for identical content and previous hash', () => {
    const row = { entityType: 'ticket', entityId: '5', actor: 'admin', actorRole: 'admin', action: 'created', ipAddress: '127.0.0.1', details: null };
    expect(computeAuditHash(row, 'abc')).toBe(computeAuditHash(row, 'abc'));
  });

  it('changes if any field or the previous hash changes', () => {
    const row = { entityType: 'ticket', entityId: '5', actor: 'admin', actorRole: 'admin', action: 'created', ipAddress: '127.0.0.1', details: null };
    const base = computeAuditHash(row, 'abc');
    expect(computeAuditHash({ ...row, action: 'deleted' }, 'abc')).not.toBe(base);
    expect(computeAuditHash(row, 'xyz')).not.toBe(base);
  });
});

describe('AuditLog hash-chaining (real Sequelize model + hooks)', () => {
  it('automatically chains each new row to the previous row on real creation', async () => {
    const { first, second } = await runWithOrganization(defaultOrgId, async () => {
      await sequelize.models.AuditLog.destroy({ where: {} });
      const first = await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '1', actor: 'system', action: 'a' });
      const second = await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '2', actor: 'system', action: 'b' });
      return { first, second };
    });

    expect(first.prevHash).toBeNull();
    expect(first.hash).toBeTruthy();
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });

  it('verifyAuditChain reports valid for an untouched chain', async () => {
    const result = await runWithOrganization(defaultOrgId, async () => {
      await sequelize.models.AuditLog.destroy({ where: {} });
      await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '1', actor: 'system', action: 'a' });
      await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '2', actor: 'system', action: 'b' });
      await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '3', actor: 'system', action: 'c' });
      return verifyAuditChain(sequelize.models.AuditLog);
    });
    expect(result).toEqual({ valid: true, brokenAtId: null, totalChecked: 3 });
  });

  it('detects a direct content tamper on a middle row, bypassing model hooks', async () => {
    const { result, middleId } = await runWithOrganization(defaultOrgId, async () => {
      await sequelize.models.AuditLog.destroy({ where: {} });
      await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '1', actor: 'system', action: 'a' });
      const middle = await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '2', actor: 'system', action: 'b' });
      await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '3', actor: 'system', action: 'c' });

      // A raw UPDATE, exactly what a DBA with direct database access could
      // do — no application code path re-computes the hash for this.
      await sequelize.query('UPDATE "AuditLogs" SET "action" = \'tampered\' WHERE id = ?', { replacements: [middle.id] });

      return { result: await verifyAuditChain(sequelize.models.AuditLog), middleId: middle.id };
    });
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(middleId);
  });

  it('detects a deleted middle row via the following row\'s prevHash no longer matching', async () => {
    const { result, lastId } = await runWithOrganization(defaultOrgId, async () => {
      await sequelize.models.AuditLog.destroy({ where: {} });
      await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '1', actor: 'system', action: 'a' });
      const middle = await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '2', actor: 'system', action: 'b' });
      const last = await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '3', actor: 'system', action: 'c' });

      await sequelize.query('DELETE FROM "AuditLogs" WHERE id = ?', { replacements: [middle.id] });

      return { result: await verifyAuditChain(sequelize.models.AuditLog), lastId: last.id };
    });
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(lastId);
  });

  it('GET /api/governance/audit-logs/verify exposes the real verification result', async () => {
    await runWithOrganization(defaultOrgId, async () => {
      await sequelize.models.AuditLog.destroy({ where: {} });
      await sequelize.models.AuditLog.create({ entityType: 'test', entityId: '1', actor: 'system', action: 'a' });
    });

    const res = await request(app)
      .get('/api/governance/audit-logs/verify')
      .set('Cookie', token);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.totalChecked).toBe(1);
  });
});
