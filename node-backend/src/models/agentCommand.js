import { DataTypes } from 'sequelize';

// Queued commands pushed from CommandCentre down to an embedded agent —
// the "kill this IP/session" half of the loop. DB-backed (not in-memory,
// unlike the ephemeral canary nonces) so a queued command survives a
// restart before the agent's next poll picks it up.
export default (sequelize) => {
  return sequelize.define('AgentCommand', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    applicationAssetId: { type: DataTypes.INTEGER, allowNull: false },
    action: { type: DataTypes.ENUM('block_ip', 'block_session', 'unblock_ip'), allowNull: false },
    target: { type: DataTypes.STRING(255), allowNull: false },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'acknowledged'), allowNull: false, defaultValue: 'pending' },
    acknowledgedAt: { type: DataTypes.DATE, allowNull: true },
  });
};
