import { jest } from '@jest/globals';
import { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { monitorAuditChain } from '../src/services/auditChainMonitor.js';

let orgId;

beforeAll(async () => {
  await ready;
  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.create({ name: 'Audit Chain Monitor Test Org', slug: `audit-chain-monitor-${Date.now()}` });
    orgId = org.id;
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('monitorAuditChain', () => {
  it('does not alert or write a tamper record when the chain is intact', async () => {
    await runWithOrganization(orgId, () => sequelize.models.AuditLog.create({
      entityType: 'test', entityId: '1', actor: 'test', action: 'test.event', details: null,
    }));

    const alert = jest.fn().mockResolvedValue(undefined);
    const result = await runWithOrganization(orgId, () => monitorAuditChain({
      models: { AuditLog: sequelize.models.AuditLog },
      alert,
    }));

    expect(result.valid).toBe(true);
    expect(alert).not.toHaveBeenCalled();

    const tamperRecord = await runWithOrganization(orgId, () => sequelize.models.AuditLog.findOne({
      where: { action: 'audit_chain.tamper_detected' },
    }));
    expect(tamperRecord).toBeNull();
  });

  it('alerts and writes a real tamper record the moment a row is altered after being written', async () => {
    const row = await runWithOrganization(orgId, () => sequelize.models.AuditLog.create({
      entityType: 'test', entityId: '2', actor: 'test', action: 'test.event_to_tamper', details: null,
    }));

    // Simulates real tampering: the row's content is changed directly, but
    // its stored hash (computed only in beforeCreate) is left stale — the
    // exact scenario verifyAuditChain exists to catch.
    await runWithOrganization(orgId, () => row.update({ action: 'test.tampered_action' }, { hooks: false }));

    const alert = jest.fn().mockResolvedValue(undefined);
    const result = await runWithOrganization(orgId, () => monitorAuditChain({
      models: { AuditLog: sequelize.models.AuditLog },
      alert,
    }));

    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(row.id);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ valid: false, brokenAtId: row.id }));

    const tamperRecord = await runWithOrganization(orgId, () => sequelize.models.AuditLog.findOne({
      where: { action: 'audit_chain.tamper_detected' },
      order: [['id', 'DESC']],
    }));
    expect(tamperRecord).toBeTruthy();
    expect(tamperRecord.actor).toBe('scheduler');
    expect(JSON.parse(tamperRecord.details).brokenAtId).toBe(row.id);
  });
});
