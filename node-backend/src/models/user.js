import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING, unique: true, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    surname: { type: DataTypes.STRING, allowNull: true },
    department: { type: DataTypes.ENUM('Networks', 'Dev', 'Hardware'), allowNull: true },
    jobTitle: { type: DataTypes.STRING, allowNull: true },
    scjId: { type: DataTypes.STRING(14), unique: true, allowNull: true },
    email: { type: DataTypes.STRING, unique: true, allowNull: true },
    telegramNumber: { type: DataTypes.STRING(32), unique: true, allowNull: true },
    telegramId: { type: DataTypes.INTEGER, unique: true, allowNull: true },
    role: { type: DataTypes.STRING, defaultValue: 'analyst' },
    password_hash: { type: DataTypes.STRING, allowNull: true },
    resetPasswordCode: { type: DataTypes.STRING(16), allowNull: true },
    resetPasswordCodeExpiresAt: { type: DataTypes.DATE, allowNull: true },
    notifyTelegram: { type: DataTypes.BOOLEAN, defaultValue: true },
    notifyEmail: { type: DataTypes.BOOLEAN, defaultValue: true },
  });
};
