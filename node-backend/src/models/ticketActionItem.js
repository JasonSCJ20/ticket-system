import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('TicketActionItem', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ticketId: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    ownerScjId: { type: DataTypes.STRING(14), allowNull: true },
    status: { type: DataTypes.ENUM('open', 'blocked', 'done'), allowNull: false, defaultValue: 'open' },
    dueAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
  });
};
