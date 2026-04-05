import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('NetworkDevice', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    deviceType: { type: DataTypes.ENUM('router', 'switch', 'access_point', 'endpoint', 'firewall', 'server', 'other'), allowNull: false, defaultValue: 'endpoint' },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    macAddress: { type: DataTypes.STRING(64), allowNull: true },
    location: { type: DataTypes.STRING(128), allowNull: true },
    vendor: { type: DataTypes.STRING(128), allowNull: true },
    model: { type: DataTypes.STRING(128), allowNull: true },
    firmwareVersion: { type: DataTypes.STRING(64), allowNull: true },
    monitoringEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    state: { type: DataTypes.ENUM('online', 'offline', 'degraded', 'maintenance', 'unknown'), allowNull: false, defaultValue: 'unknown' },
    idsIpsEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    passiveScanEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    lastPassiveScanAt: { type: DataTypes.DATE, allowNull: true },
    lastIdsIpsEventAt: { type: DataTypes.DATE, allowNull: true },
    riskScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 },
    notes: { type: DataTypes.TEXT, allowNull: true },
  });
};
