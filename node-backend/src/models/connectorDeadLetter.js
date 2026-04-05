import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('ConnectorDeadLetter', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    connectorName: { type: DataTypes.STRING(64), allowNull: false },
    externalEventId: { type: DataTypes.STRING(255), allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'retried', 'failed', 'discarded'),
      allowNull: false,
      defaultValue: 'pending',
    },
    payload: { type: DataTypes.TEXT, allowNull: false },
    attemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.TEXT, allowNull: true },
    processedAt: { type: DataTypes.DATE, allowNull: true },
  });
};
