// Fast, in-memory mirror of the SecurityState singleton row, so the
// lockdown/IP-block/session-revoke checks that run on (almost) every request
// don't hit the database each time. Refreshed periodically, and immediately
// after any kill-switch action so activation is never delayed by the poll
// interval — a lockdown must take effect the instant it's triggered, not up
// to REFRESH_INTERVAL_MS later.
const REFRESH_INTERVAL_MS = 5000;

let cache = {
  lockdownActive: false,
  lockdownReason: null,
  globalRevokeAfter: null,
  blockedIps: new Set(),
};

let SecurityStateModel = null;
let refreshTimer = null;

export function initSecurityStateCache(model) {
  SecurityStateModel = model;
  refreshSecurityStateCache();
  if (!refreshTimer) {
    refreshTimer = setInterval(refreshSecurityStateCache, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
  }
}

export async function refreshSecurityStateCache() {
  if (!SecurityStateModel) return;
  try {
    const row = await SecurityStateModel.findByPk(1);
    if (!row) return;
    cache = {
      lockdownActive: row.lockdownActive,
      lockdownReason: row.lockdownReason,
      globalRevokeAfter: row.globalRevokeAfter,
      blockedIps: new Set(row.blockedIps || []),
    };
  } catch (err) {
    console.error('[securityStateCache] refresh failed:', err.message);
  }
}

export function getSecurityStateCache() {
  return cache;
}
