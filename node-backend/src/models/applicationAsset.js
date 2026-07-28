import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('ApplicationAsset', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    baseUrl: { type: DataTypes.STRING(512), allowNull: false },
    environment: { type: DataTypes.ENUM('production', 'staging', 'development'), allowNull: false, defaultValue: 'production' },
    ownerEmail: { type: DataTypes.STRING(255), allowNull: true },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    toolStack: { type: DataTypes.JSON, allowNull: false, defaultValue: { idsIps: 'Suricata', networkMonitoring: 'Prometheus', vulnScanner: 'Wazuh' } },
    healthStatus: { type: DataTypes.ENUM('healthy', 'degraded', 'critical', 'unknown'), allowNull: false, defaultValue: 'unknown' },
    lastPassiveScanAt: { type: DataTypes.DATE, allowNull: true },
    lastActiveScanAt: { type: DataTypes.DATE, allowNull: true },
    // Real enforcement (embedded agent or edge WAF), distinct from the
    // simulated toolStack label above. 'none' means the asset is registered
    // for visibility only, with no active protection wired up yet.
    enforcementModel: { type: DataTypes.ENUM('agent', 'edge', 'none'), allowNull: false, defaultValue: 'none' },
    // New assets start in shadow mode (observe + report "would-block" findings
    // without touching real traffic) until manually promoted — never default
    // straight to blocking real customer traffic on day one.
    enforcementMode: { type: DataTypes.ENUM('shadow', 'active'), allowNull: false, defaultValue: 'shadow' },
    verificationStatus: {
      type: DataTypes.ENUM('not_configured', 'pending', 'verified', 'degraded', 'failed'),
      allowNull: false,
      defaultValue: 'not_configured',
    },
    lastVerifiedAt: { type: DataTypes.DATE, allowNull: true },
    lastHeartbeatAt: { type: DataTypes.DATE, allowNull: true },
    // Agent path: we only ever store a hash of the key we issued, the same
    // way a password is hashed — we never need the plaintext again after
    // issuance, only to verify a presented key matches.
    agentKeyHash: { type: DataTypes.STRING(128), allowNull: true },
    // Edge path: unlike the agent key, CommandCentre must actively call
    // Cloudflare's API with this credential later, so it has to be
    // recoverable — stored as an AES-256-GCM ciphertext blob, never plaintext.
    edgeCredentialSecret: { type: DataTypes.TEXT, allowNull: true },
    // Non-secret routing metadata needed to use the credential (which
    // account/zone it applies to) — safe to store unencrypted.
    edgeCredentialMeta: { type: DataTypes.JSON, allowNull: true },
  });
};
