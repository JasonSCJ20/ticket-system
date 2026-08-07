import { DataTypes } from 'sequelize';

// The tenant. Every customer company using CommandCentre (once resold, not
// just Scratch Solid Solutions' own internal use) is one row here, and
// every tenant-scoped table carries an organizationId pointing back to it.
export default (sequelize) => {
  return sequelize.define('Organization', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    plan: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'standard' },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    // Per-tenant connector credential (Wazuh/Suricata/Prometheus), encrypted
    // at rest the same way ApplicationAsset.edgeCredentialSecret is — the
    // server needs the plaintext back to verify an HMAC signature, unlike a
    // password. Null until a platform admin issues one for this org;
    // securityConnectors.js falls back to the single global
    // CONFIG.CONNECTOR_SHARED_SECRET when this is unset, so existing
    // single-tenant connector configs keep working unchanged.
    connectorSecret: { type: DataTypes.TEXT, allowNull: true },
  });
};
