// Import Sequelize ORM
import { DataTypes, Sequelize } from 'sequelize';
// Import configuration
import { CONFIG } from '../config.js';

// Resolve dialect from DATABASE_URL so PostgreSQL/MySQL work
// without any code changes — just swap the connection string.
function resolveDialect(url = '') {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgres';
  if (url.startsWith('mysql://') || url.startsWith('mysql2://')) return 'mysql';
  return 'sqlite';
}

const dialect = resolveDialect(CONFIG.DATABASE_URL);

export const sequelize = new Sequelize(CONFIG.DATABASE_URL, {
  dialect,
  // sqlite needs the storage path resolved from the URL
  ...(dialect === 'sqlite' ? { storage: CONFIG.DATABASE_URL.replace(/^sqlite:\/\/\.?\//, '') } : {}),
  logging: false,
  pool: dialect !== 'sqlite' ? { max: 10, min: 2, acquire: 30000, idle: 10000 } : undefined,
});

// Function to initialize all database models
export const initModels = async () => {
  // Test database connection
  await sequelize.authenticate();
  // Dynamically import and initialize User model
  const userModel = (await import('./user.js')).default(sequelize);
  // Dynamically import and initialize Ticket model
  const ticketModel = (await import('./ticket.js')).default(sequelize);
  // Dynamically import and initialize TicketHistory model
  const ticketHistoryModel = (await import('./ticketHistory.js')).default(sequelize);
  const applicationAssetModel = (await import('./applicationAsset.js')).default(sequelize);
  const securityFindingModel = (await import('./securityFinding.js')).default(sequelize);
  const connectorDeadLetterModel = (await import('./connectorDeadLetter.js')).default(sequelize);
  const ticketResolutionReportModel = (await import('./ticketResolutionReport.js')).default(sequelize);
  const auditLogModel = (await import('./auditLog.js')).default(sequelize);
  const ticketCommentModel = (await import('./ticketComment.js')).default(sequelize);
  const ticketActionItemModel = (await import('./ticketActionItem.js')).default(sequelize);
  const connectorReceiptModel = (await import('./connectorReceipt.js')).default(sequelize);
  const networkDeviceModel = (await import('./networkDevice.js')).default(sequelize);
  const databaseAssetModel = (await import('./databaseAsset.js')).default(sequelize);
  const patchTaskModel = (await import('./patchTask.js')).default(sequelize);
  const revokedTokenModel = (await import('./revokedToken.js')).default(sequelize);

  // Define relationships by SCJ ID instead of numeric PK.
  userModel.hasMany(ticketModel, { foreignKey: 'assigneeId', sourceKey: 'scjId', as: 'assignedTickets', constraints: false });
  ticketModel.belongsTo(userModel, { foreignKey: 'assigneeId', targetKey: 'scjId', as: 'assignee', constraints: false });

  // Define relationships: Ticket has many history entries
  ticketModel.hasMany(ticketHistoryModel, { foreignKey: 'ticketId', as: 'histories' });
  // Define relationships: TicketHistory belongs to ticket
  ticketHistoryModel.belongsTo(ticketModel, { foreignKey: 'ticketId', as: 'ticket' });
  ticketModel.hasMany(ticketResolutionReportModel, { foreignKey: 'ticketId', as: 'resolutionReports' });
  ticketResolutionReportModel.belongsTo(ticketModel, { foreignKey: 'ticketId', as: 'ticket' });
  ticketModel.hasMany(ticketCommentModel, { foreignKey: 'ticketId', as: 'comments' });
  ticketCommentModel.belongsTo(ticketModel, { foreignKey: 'ticketId', as: 'ticket' });
  ticketModel.hasMany(ticketActionItemModel, { foreignKey: 'ticketId', as: 'actionItems' });
  ticketActionItemModel.belongsTo(ticketModel, { foreignKey: 'ticketId', as: 'ticket' });

  applicationAssetModel.hasMany(securityFindingModel, { foreignKey: 'applicationAssetId', as: 'findings' });
  securityFindingModel.belongsTo(applicationAssetModel, { foreignKey: 'applicationAssetId', as: 'application' });

  // Rebuild schema in tests; create-only in normal runtime.
  await sequelize.sync({ force: process.env.NODE_ENV === 'test' });

  if (process.env.NODE_ENV !== 'test') {
    const queryInterface = sequelize.getQueryInterface();

    const ensureColumn = async (tableName, columnName, definition) => {
      const schema = await queryInterface.describeTable(tableName);
      if (!schema[columnName]) {
        await queryInterface.addColumn(tableName, columnName, definition);
      }
    };

    const ensureIndex = async (tableName, fields, indexName) => {
      try {
        await queryInterface.addIndex(tableName, fields, { name: indexName });
      } catch (err) {
        // Ignore duplicate index creation attempts across repeated startups.
        const message = String(err?.message || '');
        const isDuplicate = message.includes('already exists')
          || message.includes('Duplicate key name')
          || message.includes('duplicate index name')
          || message.includes('index') && message.includes('exists');
        if (!isDuplicate) throw err;
      }
    };

    await ensureColumn('Users', 'username', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'surname', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'department', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'jobTitle', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'scjId', { type: DataTypes.STRING(14), allowNull: true });
    await ensureColumn('Users', 'email', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'telegramNumber', { type: DataTypes.STRING(32), allowNull: true });
    await ensureColumn('Users', 'notifyEmail', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
    await ensureColumn('Users', 'mfaEnabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn('Users', 'mfaSecret', { type: DataTypes.STRING(128), allowNull: true });
    await ensureColumn('Users', 'resetPasswordCode', { type: DataTypes.STRING(16), allowNull: true });
    await ensureColumn('Users', 'resetPasswordCodeExpiresAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'lifecycleStage', { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'identified' });
    await ensureColumn('Tickets', 'slaDueAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'triagedAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'containedAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'eradicatedAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'recoveredAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'postmortemAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'resolvedAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'closedAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Tickets', 'breachedSla', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn('Tickets', 'businessImpactScore', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 });
    await ensureColumn('Tickets', 'impactedServices', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('Tickets', 'executiveSummary', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('Tickets', 'governanceTags', { type: DataTypes.JSON, allowNull: false, defaultValue: [] });
    await ensureColumn('SecurityFindings', 'externalEventId', { type: DataTypes.STRING(255), allowNull: true });
    await ensureColumn('SecurityFindings', 'fingerprint', { type: DataTypes.STRING(128), allowNull: true });
    await ensureColumn('SecurityFindings', 'rawPayload', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('SecurityFindings', 'confidenceScore', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 70 });
    await ensureColumn('SecurityFindings', 'likelihoodScore', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 65 });
    await ensureColumn('SecurityFindings', 'impactScore', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 70 });
    await ensureColumn('SecurityFindings', 'riskScore', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 });
    await ensureColumn('SecurityFindings', 'riskBand', { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'medium' });
    await ensureColumn('SecurityFindings', 'cveId', { type: DataTypes.STRING(32), allowNull: true });
    await ensureColumn('SecurityFindings', 'cweId', { type: DataTypes.STRING(32), allowNull: true });
    await ensureColumn('SecurityFindings', 'mitreTechnique', { type: DataTypes.STRING(32), allowNull: true });
    await ensureColumn('SecurityFindings', 'affectedAssetType', { type: DataTypes.STRING(64), allowNull: true });
    await ensureColumn('SecurityFindings', 'affectedAssetRef', { type: DataTypes.STRING(255), allowNull: true });
    await ensureColumn('SecurityFindings', 'detectedAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('SecurityFindings', 'executiveSummary', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('SecurityFindings', 'businessImpact', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('SecurityFindings', 'remediationRecommendation', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('RevokedTokens', 'jti', { type: DataTypes.STRING(64), allowNull: false, unique: true });
    await ensureColumn('RevokedTokens', 'expiresAt', { type: DataTypes.DATE, allowNull: true });

    const ticketSchema = await queryInterface.describeTable('Tickets');
    if (ticketSchema.assigneeId && ticketSchema.assigneeId.type !== 'VARCHAR(14)') {
      // Keep old values available through existing rows; do not attempt destructive type migration.
    }

    await ensureIndex('SecurityFindings', ['status'], 'idx_security_findings_status');
    await ensureIndex('SecurityFindings', ['severity'], 'idx_security_findings_severity');
    await ensureIndex('SecurityFindings', ['category'], 'idx_security_findings_category');
    await ensureIndex('SecurityFindings', ['createdAt'], 'idx_security_findings_created_at');
    await ensureIndex('PatchTasks', ['status'], 'idx_patch_tasks_status');
    await ensureIndex('PatchTasks', ['dueDate'], 'idx_patch_tasks_due_date');
    await ensureIndex('AuditLogs', ['actorRole', 'createdAt'], 'idx_audit_logs_actor_role_created_at');
    await ensureIndex('AuditLogs', ['entityType', 'action', 'createdAt'], 'idx_audit_logs_entity_action_created_at');
    await ensureIndex('NetworkDevices', ['state'], 'idx_network_devices_state');
    await ensureIndex('NetworkDevices', ['idsIpsEnabled'], 'idx_network_devices_ids_ips_enabled');
    await ensureIndex('NetworkDevices', ['passiveScanEnabled'], 'idx_network_devices_passive_scan_enabled');
    await ensureIndex('DatabaseAssets', ['backupStatus'], 'idx_database_assets_backup_status');
    await ensureIndex('DatabaseAssets', ['state'], 'idx_database_assets_state');
    await ensureIndex('ApplicationAssets', ['healthStatus'], 'idx_application_assets_health_status');
  }
  // Return initialized models
  return {
    userModel,
    ticketModel,
    ticketHistoryModel,
    applicationAssetModel,
    securityFindingModel,
    connectorDeadLetterModel,
    connectorReceiptModel,
    ticketResolutionReportModel,
    auditLogModel,
    ticketCommentModel,
    ticketActionItemModel,
    networkDeviceModel,
    databaseAssetModel,
    patchTaskModel,
    revokedTokenModel,
  };
};
