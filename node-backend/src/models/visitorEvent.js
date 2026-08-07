import { DataTypes } from 'sequelize';

// A real, benign-traffic log for a registered ApplicationAsset — distinct
// from SecurityFinding (which only records attack-pattern matches) and from
// User.lastSeenAt/isOnline (which tracks internal CommandCentre staff, not
// external visitors to a client's monitored application). Reported in
// batches by the embedded agent/reverse-proxy on its existing heartbeat
// cadence, not one row per request in real time — see agent/src/core.js.
//
// Retention: no retention policy had been specified when this was built, so
// a 90-day default was assumed (see the daily cleanup cron in app.js) —
// long enough for a month-over-month traffic view, short enough that a
// busy asset's visitor log doesn't grow unbounded. Revisit if the business
// wants a different window.
export default (sequelize) => {
  return sequelize.define('VisitorEvent', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    applicationAssetId: { type: DataTypes.INTEGER, allowNull: false },
    ipAddress: { type: DataTypes.STRING(64), allowNull: false },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
    path: { type: DataTypes.STRING(512), allowNull: true },
    method: { type: DataTypes.STRING(10), allowNull: true },
    statusCode: { type: DataTypes.INTEGER, allowNull: true },
    visitedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
};
