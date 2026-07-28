import express from 'express';
import { body, validationResult } from 'express-validator';
import { refreshSecurityStateCache, getSecurityStateCache } from '../services/securityStateCache.js';

const router = express.Router();

// Three separate, never-conflated response tiers — see the design notes for
// why: session revocation and IP blocking cause zero downtime and are safe
// for an automated response; full lockdown is a deliberate, human-only,
// last-resort control that actually takes CommandCentre's own API offline,
// and must never fire from an automated detection.
export default ({ models, authMiddleware }) => {
  const { SecurityState, AuditLog } = models;

  const adminOnly = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };

  async function getState() {
    return SecurityState.findByPk(1);
  }

  router.get('/status', authMiddleware, adminOnly, async (_req, res) => {
    const state = await getState();
    return res.json({
      globalRevokeAfter: state.globalRevokeAfter,
      globalRevokeReason: state.globalRevokeReason,
      lockdownActive: state.lockdownActive,
      lockdownReason: state.lockdownReason,
      lockdownAt: state.lockdownAt,
      blockedIps: state.blockedIps,
    });
  });

  router.post(
    '/revoke-sessions',
    authMiddleware,
    adminOnly,
    body('reason').optional().isString().trim().isLength({ max: 500 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const state = await getState();
      await state.update({
        globalRevokeAfter: new Date(),
        globalRevokeReason: req.body.reason || null,
        globalRevokeBy: req.user?.username || 'unknown',
      });
      await refreshSecurityStateCache();

      await AuditLog.create({
        entityType: 'security_state',
        entityId: 'kill_switch',
        actor: req.user?.username || 'unknown',
        actorRole: req.user?.role || null,
        action: 'fortress.sessions_revoked',
        ipAddress: req.ip,
        details: JSON.stringify({ reason: req.body.reason || null }),
      });

      // The requester's own token was issued before this instant too, so it
      // is now revoked along with everyone else's — this is deliberate.
      return res.json({ revoked: true, revokedAt: state.globalRevokeAfter });
    },
  );

  router.post(
    '/block-ip',
    authMiddleware,
    adminOnly,
    body('ip').isString().trim().isLength({ min: 3, max: 64 }),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const state = await getState();
      const blockedIps = Array.from(new Set([...(state.blockedIps || []), req.body.ip]));
      await state.update({ blockedIps });
      await refreshSecurityStateCache();

      await AuditLog.create({
        entityType: 'security_state',
        entityId: 'kill_switch',
        actor: req.user?.username || 'unknown',
        actorRole: req.user?.role || null,
        action: 'fortress.ip_blocked',
        ipAddress: req.ip,
        details: JSON.stringify({ blockedIp: req.body.ip, reason: req.body.reason || null }),
      });

      return res.json({ blocked: true, blockedIps });
    },
  );

  router.post(
    '/unblock-ip',
    authMiddleware,
    adminOnly,
    body('ip').isString().trim().isLength({ min: 3, max: 64 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const state = await getState();
      const blockedIps = (state.blockedIps || []).filter((ip) => ip !== req.body.ip);
      await state.update({ blockedIps });
      await refreshSecurityStateCache();

      await AuditLog.create({
        entityType: 'security_state',
        entityId: 'kill_switch',
        actor: req.user?.username || 'unknown',
        actorRole: req.user?.role || null,
        action: 'fortress.ip_unblocked',
        ipAddress: req.ip,
        details: JSON.stringify({ unblockedIp: req.body.ip }),
      });

      return res.json({ blocked: false, blockedIps });
    },
  );

  router.post(
    '/lockdown',
    authMiddleware,
    adminOnly,
    body('active').isBoolean(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const state = await getState();
      await state.update({
        lockdownActive: req.body.active,
        lockdownReason: req.body.active ? (req.body.reason || null) : null,
        lockdownAt: req.body.active ? new Date() : null,
        lockdownBy: req.user?.username || 'unknown',
      });
      await refreshSecurityStateCache();

      await AuditLog.create({
        entityType: 'security_state',
        entityId: 'kill_switch',
        actor: req.user?.username || 'unknown',
        actorRole: req.user?.role || null,
        action: req.body.active ? 'fortress.lockdown_activated' : 'fortress.lockdown_deactivated',
        ipAddress: req.ip,
        details: JSON.stringify({ reason: req.body.reason || null }),
      });

      return res.json({ lockdownActive: state.lockdownActive, lockdownAt: state.lockdownAt });
    },
  );

  return router;
};

// Exported for the early app-level middleware (lockdown + IP block) — kept
// here so the "what counts as exempt from lockdown" list lives next to the
// endpoints that manage it.
export function isLockdownExempt(path) {
  return (
    path === '/api/healthz'
    || path === '/api/token'
    || path.startsWith('/api/security/fortress/kill-switch')
  );
}

// req.path has the mount prefix stripped when read inside a nested
// app.use('/api', ...) middleware, which silently breaks prefix checks like
// the one above. req.originalUrl always carries the full path regardless of
// mount depth — use that instead (query string stripped) everywhere this
// exemption check is evaluated.
function fullPath(req) {
  return req.originalUrl.split('?')[0];
}

export function checkRequestAgainstSecurityState(req, res) {
  const state = getSecurityStateCache();
  // The kill-switch management path itself is always exempt from both the IP
  // block and the lockdown, for the same reason: an admin must always be
  // able to reach the controls that undo a block or a lockdown, even one
  // affecting their own current IP — otherwise a mistaken self-block has no
  // recovery path short of direct database access.
  const exempt = isLockdownExempt(fullPath(req));

  if (state.blockedIps.has(req.ip) && !exempt) {
    res.status(403).json({ error: 'Your IP has been blocked by CommandCentre.' });
    return false;
  }

  if (state.lockdownActive && !exempt) {
    res.status(503).json({
      error: 'CommandCentre is in lockdown.',
      lockdownReason: state.lockdownReason,
    });
    return false;
  }

  return true;
}
