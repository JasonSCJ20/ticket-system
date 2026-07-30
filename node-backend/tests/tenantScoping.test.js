import { Sequelize, DataTypes } from 'sequelize';
import { applyTenantScoping } from '../src/services/tenantScoping.js';
import { runWithOrganization, runAsPlatformAdmin, getTenantContext } from '../src/services/tenantContext.js';

// A real, throwaway in-memory Sequelize instance with one simple scoped
// model — isolated from the full app's DB so this test proves the hook
// mechanism itself is correct, independent of any real model's shape.
let sequelize;
let Widget;

beforeAll(async () => {
  sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  Widget = sequelize.define('Widget', {
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
  });
  applyTenantScoping(Widget);
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('applyTenantScoping', () => {
  it('throws on a find with no tenant context established at all', async () => {
    await expect(Widget.findAll()).rejects.toThrow(/Refusing to run an unscoped find/);
  });

  it('throws on a create with no tenant context established', async () => {
    await expect(Widget.create({ name: 'orphan' })).rejects.toThrow(/Refusing to run an unscoped create/);
  });

  it('auto-stamps organizationId on create from the active tenant context', async () => {
    const widget = await runWithOrganization(1, () => Widget.create({ name: 'org-1-widget' }));
    expect(widget.organizationId).toBe(1);
  });

  it('scopes find results to only the active organization', async () => {
    await runWithOrganization(1, () => Widget.create({ name: 'org-1-widget-2' }));
    await runWithOrganization(2, () => Widget.create({ name: 'org-2-widget' }));

    const org1Results = await runWithOrganization(1, () => Widget.findAll());
    expect(org1Results.every((w) => w.organizationId === 1)).toBe(true);
    expect(org1Results.some((w) => w.name === 'org-2-widget')).toBe(false);

    const org2Results = await runWithOrganization(2, () => Widget.findAll());
    expect(org2Results.every((w) => w.organizationId === 2)).toBe(true);
    expect(org2Results.some((w) => w.name.startsWith('org-1'))).toBe(false);
  });

  it('scopes count() the same way as findAll', async () => {
    const org1Count = await runWithOrganization(1, () => Widget.count());
    const org2Count = await runWithOrganization(2, () => Widget.count());
    expect(org1Count).toBe(2); // org-1-widget, org-1-widget-2
    expect(org2Count).toBe(1); // org-2-widget
  });

  it('does not leak an explicit where clause across tenants — organizationId always wins', async () => {
    // Even a caller who (mistakenly, or maliciously via a manipulated
    // request) tries to query for another org's row by id must not
    // succeed — the hook's organizationId is appended, not merely
    // suggested.
    const org2Widget = await runWithOrganization(2, () => Widget.findOne({ where: { name: 'org-2-widget' } }));
    const attemptFromOrg1 = await runWithOrganization(1, () => Widget.findByPk(org2Widget.id));
    expect(attemptFromOrg1).toBeNull();
  });

  it('platform admin context bypasses scoping and can see every organization', async () => {
    const all = await runAsPlatformAdmin(() => Widget.findAll());
    expect(all.length).toBeGreaterThanOrEqual(3);
    const orgIds = new Set(all.map((w) => w.organizationId));
    expect(orgIds.has(1)).toBe(true);
    expect(orgIds.has(2)).toBe(true);
  });

  it('platform admin create requires an explicit organizationId (no auto-stamp to bypass on)', async () => {
    await expect(runAsPlatformAdmin(() => Widget.create({ name: 'no-org' }))).rejects.toThrow();
    const created = await runAsPlatformAdmin(() => Widget.create({ name: 'explicit-org', organizationId: 3 }));
    expect(created.organizationId).toBe(3);
  });

  it('bulk destroy is scoped to the active organization only', async () => {
    await runWithOrganization(1, () => Widget.destroy({ where: {} }));
    const remainingOrg1 = await runWithOrganization(1, () => Widget.findAll());
    const remainingOrg2 = await runWithOrganization(2, () => Widget.findAll());
    expect(remainingOrg1).toEqual([]);
    expect(remainingOrg2.length).toBeGreaterThan(0); // untouched
  });

  it('context does not leak between concurrent async operations', async () => {
    const results = await Promise.all([
      runWithOrganization(2, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getTenantContext().organizationId;
      }),
      runWithOrganization(3, async () => {
        return getTenantContext().organizationId;
      }),
    ]);
    expect(results).toEqual([2, 3]);
  });
});
