import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING, unique: true, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    surname: { type: DataTypes.STRING, allowNull: true },
    department: { type: DataTypes.ENUM('Networks', 'Dev', 'Hardware'), allowNull: true },
    operationalTeams: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    audienceCode: { type: DataTypes.STRING(8), allowNull: true },
    jobTitle: { type: DataTypes.STRING, allowNull: true },
    scjId: { type: DataTypes.STRING(14), unique: true, allowNull: true },
    email: { type: DataTypes.STRING, unique: true, allowNull: true },
    telegramNumber: { type: DataTypes.STRING(32), unique: true, allowNull: true },
    telegramChatId: { type: DataTypes.STRING(32), unique: true, allowNull: true },
    telegramId: { type: DataTypes.INTEGER, unique: true, allowNull: true },
    role: { type: DataTypes.STRING, defaultValue: 'analyst' },
    password_hash: { type: DataTypes.STRING, allowNull: true },
    mfaEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    mfaSecret: { type: DataTypes.STRING(128), allowNull: true },
    resetPasswordCode: { type: DataTypes.STRING(16), allowNull: true },
    resetPasswordCodeExpiresAt: { type: DataTypes.DATE, allowNull: true },
    notifyTelegram: { type: DataTypes.BOOLEAN, defaultValue: true },
    notifyEmail: { type: DataTypes.BOOLEAN, defaultValue: true },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    lastLoginIp: { type: DataTypes.STRING(64), allowNull: true },
    lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    lastSeenIp: { type: DataTypes.STRING(64), allowNull: true },
    lastSeenUserAgent: { type: DataTypes.STRING(512), allowNull: true },
    isOnline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastTelegramDeliveryAt: { type: DataTypes.DATE, allowNull: true },
    lastTelegramDeliveryStatus: { type: DataTypes.STRING(32), allowNull: true },
    lastTelegramReadAt: { type: DataTypes.DATE, allowNull: true },
    lastSeenGeo: { type: DataTypes.STRING(128), allowNull: true },  // "City, Country" from ip-api
  });
};
