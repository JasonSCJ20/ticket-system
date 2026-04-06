import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('ScanRunRecord', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    toolId: { type: DataTypes.STRING(64), allowNull: false },
    toolName: { type: DataTypes.STRING(128), allowNull: false },
    engine: { type: DataTypes.STRING(128), allowNull: false },
    mode: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'passive' },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'completed' },
    triggerSource: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'system' },
    actor: { type: DataTypes.STRING(128), allowNull: false, defaultValue: 'system' },
    actorRole: { type: DataTypes.STRING(64), allowNull: true },
    assetType: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'command_centre' },
    assetId: { type: DataTypes.INTEGER, allowNull: true },
    assetName: { type: DataTypes.STRING(255), allowNull: false },
    assetRef: { type: DataTypes.STRING(512), allowNull: true },
    findingIds: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    findingsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    newFindingsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    detail: { type: DataTypes.TEXT, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    durationMs: { type: DataTypes.INTEGER, allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  });
};
