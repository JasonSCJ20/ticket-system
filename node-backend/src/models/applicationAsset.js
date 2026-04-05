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
  });
};
