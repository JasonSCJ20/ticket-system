import { DataTypes } from 'sequelize';

// Singleton row (id always 1) backing CommandCentre's own kill-switch tiers.
// `globalRevokeAfter` implements instant "sign everyone out" for a stateless
// JWT system: any token with an `iat` before this timestamp is rejected by
// the auth middleware, without needing to enumerate or track individual
// active sessions. `lockdownActive` is the separate, more severe, manual-only
// full-lockdown tier — never set automatically by a detection.
export default (sequelize) => {
  return sequelize.define('SecurityState', {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    globalRevokeAfter: { type: DataTypes.DATE, allowNull: true },
    globalRevokeReason: { type: DataTypes.STRING(500), allowNull: true },
    globalRevokeBy: { type: DataTypes.STRING(128), allowNull: true },
    lockdownActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lockdownReason: { type: DataTypes.STRING(500), allowNull: true },
    lockdownAt: { type: DataTypes.DATE, allowNull: true },
    lockdownBy: { type: DataTypes.STRING(128), allowNull: true },
    // Targeted IP blocks against CommandCentre's own API — the middle,
    // zero-downtime tier between session revocation and full lockdown.
    blockedIps: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  });
};
