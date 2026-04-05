import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('PatchTask', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assetType: {
      type: DataTypes.ENUM('application', 'network_device', 'database_asset'),
      allowNull: false,
    },
    assetId: { type: DataTypes.INTEGER, allowNull: false },
    assetName: { type: DataTypes.STRING(128), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM('todo', 'in_progress', 'completed'),
      allowNull: false,
      defaultValue: 'todo',
    },
    severity: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
      allowNull: false,
      defaultValue: 'medium',
    },
    currentVersion: { type: DataTypes.STRING(128), allowNull: true },
    targetVersion: { type: DataTypes.STRING(128), allowNull: true },
    ownerEmail: { type: DataTypes.STRING(255), allowNull: true },
    dueDate: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    lastActionAt: { type: DataTypes.DATE, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true },
  });
};