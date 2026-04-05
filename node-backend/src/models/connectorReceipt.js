import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('ConnectorReceipt', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    connectorName: { type: DataTypes.STRING(64), allowNull: false },
    dedupeKey: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    sourceIp: { type: DataTypes.STRING(64), allowNull: true },
    seenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
};
