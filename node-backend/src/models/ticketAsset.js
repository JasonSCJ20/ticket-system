import { DataTypes } from 'sequelize';

// Which real registered asset(s) a ticket is about — mirrors PatchTask's
// existing assetType/assetId/assetName polymorphic-reference pattern rather
// than inventing a new one, since ApplicationAsset/NetworkDevice/DatabaseAsset
// are three separate tables with no common parent to point a single FK at.
// A ticket can link more than one asset (one row per asset here) so an
// incident spanning several assets can name all of them, not just one.
export default (sequelize) => {
  return sequelize.define('TicketAsset', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    ticketId: { type: DataTypes.INTEGER, allowNull: false },
    assetType: {
      type: DataTypes.ENUM('application', 'network_device', 'database_asset'),
      allowNull: false,
    },
    assetId: { type: DataTypes.INTEGER, allowNull: false },
    assetName: { type: DataTypes.STRING(128), allowNull: false },
  });
};
