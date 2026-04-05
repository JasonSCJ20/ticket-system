/**
 * Database-backed auth rate limiter.
 *
 * Replaces in-memory Maps so throttle state persists across process restarts
 * and works correctly with multi-process deployments (PM2 cluster mode, etc).
 *
 * Stores lightweight rows in the AuthRateLimit table:
 *   scopeKey  – e.g. "reset_request:user@example.com"
 *   count     – attempts in the current window
 *   windowStart – epoch ms of window open
 *   lockUntil   – epoch ms of lock expiry (0 = not locked)
 *
 * A cleanup cron purges expired rows every 30 minutes so the table stays small.
 */

import { DataTypes } from 'sequelize';
import { Op } from 'sequelize';
import { sequelize } from '../models/index.js';

let AuthRateLimit;

export function initAuthRateLimit() {
  AuthRateLimit = sequelize.define('AuthRateLimit', {
    scopeKey: { type: DataTypes.STRING(255), primaryKey: true },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    windowStart: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    lockUntil: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'AuthRateLimits',
    timestamps: false,
  });
  return AuthRateLimit.sync({ alter: true });
}

export async function consumeAuthAttempt(scope, key, { limit, windowMs, lockMs }) {
  const normalizedKey = `${scope}:${String(key || '').toLowerCase().trim()}`;
  const now = Date.now();

  const [row] = await AuthRateLimit.findOrCreate({
    where: { scopeKey: normalizedKey },
    defaults: { count: 0, windowStart: now, lockUntil: 0 },
  });

  const lockUntil = Number(row.lockUntil);
  if (lockUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((lockUntil - now) / 1000) };
  }

  let count = Number(row.count);
  let windowStart = Number(row.windowStart);

  if (now - windowStart > windowMs) {
    count = 0;
    windowStart = now;
  }

  count += 1;

  if (count > limit) {
    const newLock = now + lockMs;
    await row.update({ count, windowStart, lockUntil: newLock });
    return { allowed: false, retryAfterSec: Math.ceil(lockMs / 1000) };
  }

  await row.update({ count, windowStart, lockUntil: 0 });
  return { allowed: true, retryAfterSec: 0 };
}

export async function clearAuthAttemptState(scope, key) {
  const normalizedKey = `${scope}:${String(key || '').toLowerCase().trim()}`;
  await AuthRateLimit.destroy({ where: { scopeKey: normalizedKey } });
}

// Call once at startup to purge expired rows.
export async function pruneExpiredAuthRateLimits() {
  const now = Date.now();
  await AuthRateLimit.destroy({
    where: {
      lockUntil: { [Op.lt]: now },
      count: { [Op.lte]: 0 },
    },
  });
}
