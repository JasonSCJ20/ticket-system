import { AsyncLocalStorage } from 'async_hooks';

// Carries "which organization is this code running for" implicitly through
// an entire request (or background job) without threading an organizationId
// parameter through every function call — every tenant-scoped Sequelize
// query reads it back out via the hooks in tenantScoping.js. This is what
// makes org-scoping structural instead of "remember to add a where clause
// in every route handler" (the exact mistake that causes cross-tenant data
// leaks in multi-tenant systems).
const storage = new AsyncLocalStorage();

export function runWithOrganization(organizationId, fn) {
  return storage.run({ organizationId, isPlatformAdmin: false }, fn);
}

// An explicit, intentional bypass for the platform-admin tier (Scratch
// Solid Solutions staff managing tenants themselves, not a customer). Never
// reached by an ordinary org user's request — only wired in where a route
// is deliberately platform-scoped.
export function runAsPlatformAdmin(fn) {
  return storage.run({ organizationId: null, isPlatformAdmin: true }, fn);
}

export function getTenantContext() {
  return storage.getStore() || null;
}
