import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('TicketHistory', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ticketId: { type: DataTypes.INTEGER, allowNull: false },
    eventType: { type: DataTypes.STRING, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: true },
  });
};
