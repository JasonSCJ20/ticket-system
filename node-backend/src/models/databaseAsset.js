import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('DatabaseAsset', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    engine: { type: DataTypes.ENUM('postgresql', 'mysql', 'mssql', 'oracle', 'mongodb', 'redis', 'other'), allowNull: false, defaultValue: 'postgresql' },
    environment: { type: DataTypes.ENUM('on_prem', 'cloud', 'hybrid'), allowNull: false, defaultValue: 'on_prem' },
    host: { type: DataTypes.STRING(255), allowNull: false },
    port: { type: DataTypes.INTEGER, allowNull: true },
    ownerEmail: { type: DataTypes.STRING(255), allowNull: true },
    criticality: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), allowNull: false, defaultValue: 'high' },
    patchLevel: { type: DataTypes.STRING(128), allowNull: true },
    backupStatus: { type: DataTypes.ENUM('healthy', 'warning', 'critical', 'unknown'), allowNull: false, defaultValue: 'unknown' },
    encryptionAtRest: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    tlsInTransit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    state: { type: DataTypes.ENUM('online', 'offline', 'degraded', 'maintenance', 'unknown'), allowNull: false, defaultValue: 'unknown' },
    monitoringEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    lastSecurityReviewAt: { type: DataTypes.DATE, allowNull: true },
    riskScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 40 },
    notes: { type: DataTypes.TEXT, allowNull: true },
  });
};
