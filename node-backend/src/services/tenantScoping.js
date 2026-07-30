import { getTenantContext } from './tenantContext.js';

// Applies fail-closed tenant scoping to a Sequelize model: by default, any
// find/update/destroy against this model THROWS if no tenant context is
// established, rather than silently running unscoped and returning every
// organization's data. That's a deliberate reversal of the usual failure
// mode — "forgot to scope this query" should be a loud crash caught in
// testing, not a quiet cross-tenant data leak caught by a customer.
//
// A platform-admin context (see tenantContext.js) is the one explicit,
// intentional bypass — used only where a route is deliberately
// platform-wide (managing tenants themselves), never for ordinary org data.
export function applyTenantScoping(model) {
  const requireContext = (operation) => {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new Error(
        `Refusing to run an unscoped ${operation} against ${model.name} — no tenant context is established. `
        + 'Wrap this code path in runWithOrganization() or runAsPlatformAdmin().',
      );
    }
    return ctx;
  };

  model.addHook('beforeFind', (options) => {
    const ctx = requireContext('find');
    if (ctx.isPlatformAdmin) return;
    options.where = { ...(options.where || {}), organizationId: ctx.organizationId };
  });

  // beforeValidate, not beforeCreate — Sequelize runs its own field
  // validations (including the NOT NULL check on organizationId) BEFORE
  // beforeCreate fires. Stamping the value that late would always be too
  // late; the built-in validator would already have rejected the null.
  model.addHook('beforeValidate', (instance) => {
    const ctx = requireContext('create');
    if (ctx.isPlatformAdmin) return; // platform admin must set organizationId explicitly
    if (instance.organizationId == null) instance.organizationId = ctx.organizationId;
  });

  model.addHook('beforeBulkCreate', (instances) => {
    const ctx = requireContext('bulk create');
    if (ctx.isPlatformAdmin) return;
    for (const instance of instances) {
      if (instance.organizationId == null) instance.organizationId = ctx.organizationId;
    }
  });

  model.addHook('beforeBulkUpdate', (options) => {
    const ctx = requireContext('bulk update');
    if (ctx.isPlatformAdmin) return;
    options.where = { ...(options.where || {}), organizationId: ctx.organizationId };
  });

  model.addHook('beforeBulkDestroy', (options) => {
    const ctx = requireContext('bulk destroy');
    if (ctx.isPlatformAdmin) return;
    options.where = { ...(options.where || {}), organizationId: ctx.organizationId };
  });

  model.addHook('beforeCount', (options) => {
    const ctx = requireContext('count');
    if (ctx.isPlatformAdmin) return;
    options.where = { ...(options.where || {}), organizationId: ctx.organizationId };
  });
}
