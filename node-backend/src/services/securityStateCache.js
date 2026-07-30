import { logger } from '../logger.js';
import { runWithOrganization, runAsPlatformAdmin } from './tenantContext.js';

// Fast, in-memory mirror of each organization's SecurityState row (one row
// per tenant — see models/securityState.js), so the lockdown/IP-block/
// session-revoke checks that run on (almost) every request don't hit the
// database each time. Refreshed periodically for every known organization,
// and immediately after any kill-switch action for that one org so
// activation is never delayed by the poll interval — a lockdown must take
// effect the instant it's triggered, not up to REFRESH_INTERVAL_MS later.
const REFRESH_INTERVAL_MS = 5000;

const EMPTY_STATE = Object.freeze({
  lockdownActive: false,
  lockdownReason: null,
  globalRevokeAfter: null,
  blockedIps: new Set(),
});

// organizationId -> cache entry
const cacheByOrg = new Map();

let SecurityStateModel = null;
let OrganizationModel = null;
let refreshTimer = null;

export function initSecurityStateCache(securityStateModel, organizationModel) {
  SecurityStateModel = securityStateModel;
  OrganizationModel = organizationModel;
  refreshAllOrganizations();
  if (!refreshTimer) {
    refreshTimer = setInterval(refreshAllOrganizations, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
  }
}

export async function refreshSecurityStateCache(organizationId) {
  if (!SecurityStateModel || organizationId == null) return;
  try {
    const row = await runWithOrganization(organizationId, () => SecurityStateModel.findOne({}));
    if (!row) return;
    cacheByOrg.set(organizationId, {
      lockdownActive: row.lockdownActive,
      lockdownReason: row.lockdownReason,
      globalRevokeAfter: row.globalRevokeAfter,
      blockedIps: new Set(row.blockedIps || []),
    });
  } catch (err) {
    logger.error({ err, organizationId }, 'securityStateCache refresh failed');
  }
}

async function refreshAllOrganizations() {
  if (!OrganizationModel) return;
  try {
    const organizations = await runAsPlatformAdmin(() => OrganizationModel.findAll());
    await Promise.all(organizations.map((org) => refreshSecurityStateCache(org.id)));
  } catch (err) {
    logger.error({ err }, 'securityStateCache refresh-all failed');
  }
}

// Never throws / never returns undefined, even for an organization whose
// cache hasn't populated yet — an unpopulated org must read as "nothing is
// locked down" (fail open on this specific cache, not fail closed), since
// treating "haven't cached it yet" as "everyone is locked out" would itself
// be a real availability incident for a brand new organization.
export function getSecurityStateCache(organizationId) {
  return cacheByOrg.get(organizationId) || EMPTY_STATE;
}
