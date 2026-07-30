import { DataTypes } from 'sequelize';
import { computeAuditHash } from '../services/auditChain.js';

export default (sequelize) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    entityType: { type: DataTypes.STRING(64), allowNull: false },
    entityId: { type: DataTypes.STRING(64), allowNull: false },
    actor: { type: DataTypes.STRING(128), allowNull: false },
    actorRole: { type: DataTypes.STRING(64), allowNull: true },
    action: { type: DataTypes.STRING(128), allowNull: false },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    details: { type: DataTypes.TEXT, allowNull: true },
    // Hash-chain fields — every new row links to the previous row's hash,
    // so altering or deleting a row breaks verification from that point
    // forward (see verifyAuditChain in services/auditChain.js). Computed
    // automatically below; no caller ever sets these directly.
    prevHash: { type: DataTypes.STRING(64), allowNull: true },
    hash: { type: DataTypes.STRING(64), allowNull: true },
  }, {
    hooks: {
      async beforeCreate(row) {
        const previous = await AuditLog.findOne({ order: [['id', 'DESC']] });
        row.prevHash = previous ? previous.hash : null;
        row.hash = computeAuditHash(row, row.prevHash);
      },
    },
  });
  return AuditLog;
};
