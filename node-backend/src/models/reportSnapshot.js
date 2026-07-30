import { DataTypes } from 'sequelize';

// Persists each generated executive/technical report over time — reports
// were previously pure point-in-time JSON computed live from current DB
// state and never stored, so there was no way to answer "is our risk index
// trending up or down" without a human manually screenshotting it. A daily
// snapshot (see the cron job in app.js) makes that a real, queryable trend.
export default (sequelize) => {
  return sequelize.define('ReportSnapshot', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING(32), allowNull: false },
    generatedAt: { type: DataTypes.DATE, allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
  });
};
