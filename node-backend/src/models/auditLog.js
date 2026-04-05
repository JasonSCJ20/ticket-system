import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('AuditLog', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    entityType: { type: DataTypes.STRING(64), allowNull: false },
    entityId: { type: DataTypes.STRING(64), allowNull: false },
    actor: { type: DataTypes.STRING(128), allowNull: false },
    actorRole: { type: DataTypes.STRING(64), allowNull: true },
    action: { type: DataTypes.STRING(128), allowNull: false },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    details: { type: DataTypes.TEXT, allowNull: true },
  });
};
