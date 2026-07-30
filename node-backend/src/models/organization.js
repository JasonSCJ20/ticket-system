import { DataTypes } from 'sequelize';

// The tenant. Every customer company using CommandCentre (once resold, not
// just Scratch Solid Solutions' own internal use) is one row here, and
// every tenant-scoped table carries an organizationId pointing back to it.
export default (sequelize) => {
  return sequelize.define('Organization', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    plan: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'standard' },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
  });
};
