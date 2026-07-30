import { DataTypes } from 'sequelize';

// Queued commands pushed from CommandCentre down to an embedded agent —
// the "kill this IP/session" half of the loop. DB-backed (not in-memory,
// unlike the ephemeral canary nonces) so a queued command survives a
// restart before the agent's next poll picks it up.
export default (sequelize) => {
  return sequelize.define('AgentCommand', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    applicationAssetId: { type: DataTypes.INTEGER, allowNull: false },
    action: { type: DataTypes.ENUM('block_ip', 'block_session', 'unblock_ip'), allowNull: false },
    target: { type: DataTypes.STRING(255), allowNull: false },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    // 'pending'/'acknowledged' are for the embedded-agent model (the agent
    // polls and acks on its own schedule). Edge-model commands have no agent
    // to poll, so they execute synchronously against the edge provider's API
    // right in the request that created them, landing directly on
    // 'acknowledged' (success) or 'failed' (the API call itself failed) —
    // never left 'pending' with no one ever going to act on it.
    status: { type: DataTypes.ENUM('pending', 'acknowledged', 'failed'), allowNull: false, defaultValue: 'pending' },
    acknowledgedAt: { type: DataTypes.DATE, allowNull: true },
    // The edge provider's own rule/record id for this command (e.g. a
    // Cloudflare IP Access Rule id) — needed so a later unblock_ip command
    // knows exactly which rule to remove, rather than guessing.
    externalRef: { type: DataTypes.STRING(255), allowNull: true },
    failureReason: { type: DataTypes.STRING(500), allowNull: true },
  });
};
