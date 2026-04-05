import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('TicketResolutionReport', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ticketId: { type: DataTypes.INTEGER, allowNull: false },
    issueType: { type: DataTypes.STRING(64), allowNull: false },
    issueSummary: { type: DataTypes.TEXT, allowNull: false },
    possibleSolutions: { type: DataTypes.TEXT, allowNull: false },
    reportText: { type: DataTypes.TEXT, allowNull: false },
    resolvedBy: { type: DataTypes.STRING(128), allowNull: true },
    deliveredToAssignee: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deliveredToManager: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deliveryChannels: { type: DataTypes.STRING(255), allowNull: true },
  });
};
