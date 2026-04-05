import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define('Ticket', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(512), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), defaultValue: 'medium' },
    status: { type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'), defaultValue: 'open' },
    lifecycleStage: {
      type: DataTypes.ENUM('identified', 'triaged', 'contained', 'eradicated', 'recovered', 'postmortem', 'closed'),
      allowNull: false,
      defaultValue: 'identified',
    },
    slaDueAt: { type: DataTypes.DATE, allowNull: true },
    triagedAt: { type: DataTypes.DATE, allowNull: true },
    containedAt: { type: DataTypes.DATE, allowNull: true },
    eradicatedAt: { type: DataTypes.DATE, allowNull: true },
    recoveredAt: { type: DataTypes.DATE, allowNull: true },
    postmortemAt: { type: DataTypes.DATE, allowNull: true },
    resolvedAt: { type: DataTypes.DATE, allowNull: true },
    closedAt: { type: DataTypes.DATE, allowNull: true },
    breachedSla: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    businessImpactScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
    impactedServices: { type: DataTypes.TEXT, allowNull: true },
    executiveSummary: { type: DataTypes.TEXT, allowNull: true },
    governanceTags: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    creatorId: { type: DataTypes.INTEGER, allowNull: true },
    assigneeId: { type: DataTypes.STRING(14), allowNull: true },
  });
};
