import { DataTypes } from 'sequelize';

// One row per organization backing that tenant's own Fortress kill-switch
// tiers (previously a single global singleton, id always 1 — every
// organization now gets its own independent lockdown/revoke/IP-block state,
// since one customer's incident response must never affect another's
// sessions or API access).
// `globalRevokeAfter` implements instant "sign everyone out" for a stateless
// JWT system: any token with an `iat` before this timestamp is rejected by
// the auth middleware, without needing to enumerate or track individual
// active sessions. `lockdownActive` is the separate, more severe, manual-only
// full-lockdown tier — never set automatically by a detection.
export default (sequelize) => {
  return sequelize.define('SecurityState', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    organizationId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
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
