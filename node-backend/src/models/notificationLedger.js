import { DataTypes } from 'sequelize';

// Per-notification audit ledger: one row per outbound notification attempt.
// Provides full traceability of who was notified, when, via which channel, and whether it was delivered/read.
export default (sequelize) => {
  return sequelize.define('NotificationLedger', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    channel: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'telegram' }, // 'telegram' | 'email'
    subject: { type: DataTypes.STRING(255), allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'pending' }, // 'delivered' | 'failed' | 'not_configured' | 'read'
    referenceType: { type: DataTypes.STRING(64), allowNull: true }, // 'ticket' | 'alert' | 'broadcast' | 'system'
    referenceId: { type: DataTypes.STRING(64), allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
    errorMessage: { type: DataTypes.STRING(512), allowNull: true },
  });
};
