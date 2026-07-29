import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('ApplicationAsset', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    // Not every asset has a web endpoint — a router or bare server has an IP
    // but no baseUrl, so this can no longer be required. At least one of
    // baseUrl/ipAddress is enforced at the route-validation layer instead.
    baseUrl: { type: DataTypes.STRING(512), allowNull: true },
    assetType: { type: DataTypes.ENUM('application', 'server', 'computer', 'router', 'other'), allowNull: false, defaultValue: 'application' },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
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
    // Host-level sentinel (@commandcentre/sentinel) — independent of
    // enforcementModel above, since a sentinel can run alongside an embedded
    // agent (defense in depth on one application asset) or completely alone
    // (a router/server has no app to embed an agent into, only a host to run
    // a sentinel on). Same one-way-hash pattern as agentKeyHash.
    sentinelKeyHash: { type: DataTypes.STRING(128), allowNull: true },
    // Same shadow-first philosophy as enforcementMode: a new sentinel only
    // observes and reports until manually promoted to actually rewriting
    // firewall rules.
    sentinelMode: { type: DataTypes.ENUM('shadow', 'active'), allowNull: false, defaultValue: 'shadow' },
    lastSentinelHeartbeatAt: { type: DataTypes.DATE, allowNull: true },
  });
};
