import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('TicketComment', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ticketId: { type: DataTypes.INTEGER, allowNull: false },
    authorName: { type: DataTypes.STRING(128), allowNull: false },
    authorRole: { type: DataTypes.STRING(64), allowNull: true },
    visibility: { type: DataTypes.ENUM('internal', 'executive'), allowNull: false, defaultValue: 'internal' },
    message: { type: DataTypes.TEXT, allowNull: false },
  });
};
