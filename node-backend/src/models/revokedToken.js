import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('RevokedToken', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    jti: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
  });
};
