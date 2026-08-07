// Import Sequelize ORM
import { DataTypes, Sequelize } from 'sequelize';
// Import configuration
import { CONFIG } from '../config.js';
import { computeAuditHash } from '../services/auditChain.js';
import { applyTenantScoping } from '../services/tenantScoping.js';
import { runAsPlatformAdmin } from '../services/tenantContext.js';

// The one organization every existing user/asset/finding/etc. belongs to
// until a second real tenant is onboarded — this is what makes turning on
// mandatory tenant scoping a non-event for Scratch Solid Solutions' own
// current usage. See the Phase 1 backfill below.
const DEFAULT_ORGANIZATION_SLUG = 'scratch-solid-solutions';
const DEFAULT_ORGANIZATION_NAME = 'Scratch Solid Solutions';

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
  const organizationModel = (await import('./organization.js')).default(sequelize);
  // Dynamically import and initialize User model
  const userModel = (await import('./user.js')).default(sequelize);
  // Dynamically import and initialize Ticket model
  const ticketModel = (await import('./ticket.js')).default(sequelize);
  // Dynamically import and initialize TicketHistory model
  const ticketHistoryModel = (await import('./ticketHistory.js')).default(sequelize);
  const ticketAssetModel = (await import('./ticketAsset.js')).default(sequelize);
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
  const scanRunRecordModel = (await import('./scanRunRecord.js')).default(sequelize);
  const revokedTokenModel = (await import('./revokedToken.js')).default(sequelize);
  const notificationLedgerModel = (await import('./notificationLedger.js')).default(sequelize);
  const securityStateModel = (await import('./securityState.js')).default(sequelize);
  const agentCommandModel = (await import('./agentCommand.js')).default(sequelize);
  const reportSnapshotModel = (await import('./reportSnapshot.js')).default(sequelize);
  const visitorEventModel = (await import('./visitorEvent.js')).default(sequelize);

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

  ticketModel.hasMany(ticketAssetModel, { foreignKey: 'ticketId', as: 'assets' });
  ticketAssetModel.belongsTo(ticketModel, { foreignKey: 'ticketId', as: 'ticket' });

  // Optional grouping of a database/device under the application it serves —
  // see the comment on each model's applicationAssetId field.
  applicationAssetModel.hasMany(databaseAssetModel, { foreignKey: 'applicationAssetId', as: 'databases' });
  databaseAssetModel.belongsTo(applicationAssetModel, { foreignKey: 'applicationAssetId', as: 'application' });
  applicationAssetModel.hasMany(networkDeviceModel, { foreignKey: 'applicationAssetId', as: 'devices' });
  networkDeviceModel.belongsTo(applicationAssetModel, { foreignKey: 'applicationAssetId', as: 'application' });

  applicationAssetModel.hasMany(visitorEventModel, { foreignKey: 'applicationAssetId', as: 'visitorEvents' });
  visitorEventModel.belongsTo(applicationAssetModel, { foreignKey: 'applicationAssetId', as: 'application' });

  // Fail-closed tenant scoping (see services/tenantScoping.js): every one of
  // these models throws on any find/create/update/destroy that isn't
  // running inside a tenant context, rather than silently running unscoped.
  // Deliberately NOT applied to: Organization itself (the tenant registry —
  // scoping it to a tenant would be circular), and RevokedToken (a global
  // JWT-jti blacklist keyed by a globally-unique token id, not tenant data).
  const tenantScopedModels = [
    userModel, ticketModel, ticketHistoryModel, ticketAssetModel, applicationAssetModel, securityFindingModel,
    connectorDeadLetterModel, ticketResolutionReportModel, auditLogModel, ticketCommentModel,
    ticketActionItemModel, connectorReceiptModel, networkDeviceModel, databaseAssetModel,
    patchTaskModel, scanRunRecordModel, notificationLedgerModel, securityStateModel,
    agentCommandModel, reportSnapshotModel, visitorEventModel,
  ];
  for (const model of tenantScopedModels) applyTenantScoping(model);

  // Rebuild schema in tests; create-only in normal runtime.
  await sequelize.sync({ force: process.env.NODE_ENV === 'test' });

  // The one organization every pre-existing row belongs to (see the
  // module-level comment) — created as a platform-admin operation since
  // Organization itself has no tenant to scope by. Runs in every
  // environment, including test, so test suites always have a real org to
  // work with.
  const defaultOrganization = await runAsPlatformAdmin(() => organizationModel.findOrCreate({
    where: { slug: DEFAULT_ORGANIZATION_SLUG },
    defaults: { name: DEFAULT_ORGANIZATION_NAME, slug: DEFAULT_ORGANIZATION_SLUG },
  })).then(([org]) => org);

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

    // Postgres ENUM types created by sequelize.sync() at table-creation time
    // aren't touched by addColumn-based migrations — adding a new valid value
    // to an already-live enum needs an explicit ALTER TYPE. Safe and additive
    // (Postgres 12+ supports IF NOT EXISTS here; never removes an existing
    // value, never rewrites the table).
    const ensureEnumValue = async (enumTypeName, value) => {
      await sequelize.query(`ALTER TYPE "${enumTypeName}" ADD VALUE IF NOT EXISTS '${value}'`);
    };

    // Loosening a NOT NULL constraint is always safe/additive (no existing
    // row can violate a constraint that no longer exists) — unlike tightening
    // one, which would need a data backfill first.
    const ensureNullable = async (tableName, columnName) => {
      const schema = await queryInterface.describeTable(tableName);
      if (schema[columnName] && !schema[columnName].allowNull) {
        await sequelize.query(`ALTER TABLE "${tableName}" ALTER COLUMN "${columnName}" DROP NOT NULL`);
      }
    };

    // Tightening a NOT NULL constraint is the inverse of ensureNullable, and
    // NOT always safe on its own — every existing row must already satisfy
    // it first. Backfills any NULLs to defaultValue before tightening, so
    // this is always safe to call regardless of how much history exists.
    const ensureNotNullWithBackfill = async (tableName, columnName, defaultValue) => {
      const schema = await queryInterface.describeTable(tableName);
      if (!schema[columnName] || !schema[columnName].allowNull) return; // already NOT NULL, or column doesn't exist
      await sequelize.query(`UPDATE "${tableName}" SET "${columnName}" = ? WHERE "${columnName}" IS NULL`, {
        replacements: [defaultValue],
      });
      await sequelize.query(`ALTER TABLE "${tableName}" ALTER COLUMN "${columnName}" SET NOT NULL`);
    };

    // Phase 1 multi-tenancy migration: every tenant-scoped table gets an
    // organizationId column, backfilled to the one default organization
    // (every row that already existed predates multi-tenancy, so it all
    // belongs there), then tightened to NOT NULL. Additive and safe to run
    // repeatedly — each step is a no-op once already applied. Deliberately
    // runs FIRST, before any other migration step or tenant-scoped query in
    // this function (including the SecurityState/AuditLog work below) — on
    // a database that predates multi-tenancy, anything that queries a
    // tenant-scoped model before this loop adds the column will crash with
    // "column organizationId does not exist", which is exactly what
    // happened in production the one time this ordering was wrong.
    const tenantScopedTables = [
      'Users', 'Tickets', 'TicketHistories', 'TicketAssets', 'ApplicationAssets', 'SecurityFindings',
      'ConnectorDeadLetters', 'TicketResolutionReports', 'AuditLogs', 'TicketComments',
      'TicketActionItems', 'ConnectorReceipts', 'NetworkDevices', 'DatabaseAssets',
      'PatchTasks', 'ScanRunRecords', 'NotificationLedgers', 'SecurityStates', 'AgentCommands',
      'VisitorEvents',
    ];
    for (const tableName of tenantScopedTables) {
      await ensureColumn(tableName, 'organizationId', { type: DataTypes.INTEGER, allowNull: true });
      await ensureNotNullWithBackfill(tableName, 'organizationId', defaultOrganization.id);
    }

    // SecurityState is one row per organization backing that tenant's own
    // Fortress kill-switch tiers — ensure the default org's row always
    // exists so callers never have to null-check it. Must run after the
    // organizationId migration above, not before (see comment there).
    await runAsPlatformAdmin(() => securityStateModel.findOrCreate({
      where: { organizationId: defaultOrganization.id },
      defaults: { organizationId: defaultOrganization.id },
    }));

    await ensureColumn('Users', 'username', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'surname', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'department', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'operationalTeams', { type: DataTypes.JSON, allowNull: false, defaultValue: [] });
    await ensureColumn('Users', 'audienceCode', { type: DataTypes.STRING(8), allowNull: true });
    await ensureColumn('Users', 'jobTitle', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'scjId', { type: DataTypes.STRING(14), allowNull: true });
    await ensureColumn('Users', 'email', { type: DataTypes.STRING, allowNull: true });
    await ensureColumn('Users', 'telegramNumber', { type: DataTypes.STRING(32), allowNull: true });
    await ensureColumn('Users', 'telegramChatId', { type: DataTypes.STRING(32), allowNull: true });
    await ensureColumn('Users', 'notifyEmail', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
    await ensureColumn('Users', 'lastLoginAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Users', 'lastLoginIp', { type: DataTypes.STRING(64), allowNull: true });
    await ensureColumn('Users', 'lastSeenAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Users', 'lastSeenIp', { type: DataTypes.STRING(64), allowNull: true });
    await ensureColumn('Users', 'lastSeenUserAgent', { type: DataTypes.STRING(512), allowNull: true });
    await ensureColumn('Users', 'isOnline', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn('Users', 'lastTelegramDeliveryAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Users', 'lastTelegramDeliveryStatus', { type: DataTypes.STRING(32), allowNull: true });
    await ensureColumn('Users', 'lastTelegramReadAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Users', 'lastSeenGeo', { type: DataTypes.STRING(128), allowNull: true });
    await ensureColumn('Users', 'knownLoginGeos', { type: DataTypes.JSON, allowNull: false, defaultValue: [] });
    await ensureColumn('Users', 'mfaEnabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn('Users', 'mfaSecret', { type: DataTypes.STRING(128), allowNull: true });
    await ensureColumn('Users', 'resetPasswordCode', { type: DataTypes.STRING(16), allowNull: true });
    await ensureColumn('Users', 'resetPasswordCodeExpiresAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('Users', 'mustChangePassword', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
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
    await ensureColumn('ApplicationAssets', 'enforcementModel', { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'none' });
    await ensureColumn('ApplicationAssets', 'enforcementMode', { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'shadow' });
    await ensureColumn('ApplicationAssets', 'verificationStatus', { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'not_configured' });
    await ensureColumn('ApplicationAssets', 'lastVerifiedAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('ApplicationAssets', 'lastHeartbeatAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('ApplicationAssets', 'agentKeyHash', { type: DataTypes.STRING(128), allowNull: true });
    await ensureColumn('ApplicationAssets', 'edgeCredentialSecret', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('ApplicationAssets', 'edgeCredentialMeta', { type: DataTypes.JSON, allowNull: true });
    await ensureColumn('ApplicationAssets', 'assetType', { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'application' });
    await ensureColumn('ApplicationAssets', 'ipAddress', { type: DataTypes.STRING(64), allowNull: true });
    await ensureColumn('ApplicationAssets', 'sentinelKeyHash', { type: DataTypes.STRING(128), allowNull: true });
    await ensureColumn('ApplicationAssets', 'sentinelMode', { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'shadow' });
    await ensureColumn('ApplicationAssets', 'lastSentinelHeartbeatAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('ApplicationAssets', 'lastKnownOpenPorts', { type: DataTypes.JSON, allowNull: true });
    await ensureNullable('ApplicationAssets', 'baseUrl');
    await ensureColumn('DatabaseAssets', 'applicationAssetId', { type: DataTypes.INTEGER, allowNull: true });
    await ensureColumn('NetworkDevices', 'applicationAssetId', { type: DataTypes.INTEGER, allowNull: true });
    await ensureColumn('Tickets', 'resolutionNotes', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('Tickets', 'rootCause', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('Tickets', 'actionsTaken', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('Tickets', 'preventiveActions', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('PatchTasks', 'autoDetected', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn('Organizations', 'connectorSecret', { type: DataTypes.TEXT, allowNull: true });
    await ensureColumn('AgentCommands', 'expiresAt', { type: DataTypes.DATE, allowNull: true });
    await ensureColumn('AgentCommands', 'externalRef', { type: DataTypes.STRING(255), allowNull: true });
    await ensureColumn('AgentCommands', 'failureReason', { type: DataTypes.STRING(500), allowNull: true });
    await ensureEnumValue('enum_AgentCommands_status', 'failed');
    await ensureColumn('AuditLogs', 'prevHash', { type: DataTypes.STRING(64), allowNull: true });
    await ensureColumn('AuditLogs', 'hash', { type: DataTypes.STRING(64), allowNull: true });

    // One-time backfill: give every pre-existing AuditLog row (created
    // before hash-chaining existed) a real hash too, so the chain covers
    // full history rather than only rows created after this deploy. Only
    // does anything the first time it runs — once every row has a hash,
    // this query returns nothing on every subsequent boot. Run as a
    // platform-admin operation (bypasses tenant scoping): every pre-existing
    // row belongs to the one default organization anyway (multi-tenancy
    // didn't exist yet when they were created), so one continuous chain
    // across "all of them" and "the default org's rows" is the same set.
    await runAsPlatformAdmin(async () => {
      const unhashedRows = await auditLogModel.findAll({ where: { hash: null }, order: [['id', 'ASC']] });
      if (unhashedRows.length > 0) {
        const latestHashed = await auditLogModel.findOne({ where: { hash: { [Sequelize.Op.ne]: null } }, order: [['id', 'DESC']] });
        let prevHash = latestHashed ? latestHashed.hash : null;
        for (const row of unhashedRows) {
          const rowPrevHash = prevHash;
          row.prevHash = rowPrevHash;
          row.hash = computeAuditHash(row, rowPrevHash);
          await row.save({ hooks: false });
          prevHash = row.hash;
        }
      }
    });

    // ApplicationAssets/NetworkDevices/DatabaseAssets previously had a
    // globally-unique `name` — two different customer organizations may
    // legitimately both name an asset the same thing, so the old
    // single-column unique constraint has to go. (A per-organization
    // composite unique constraint is a reasonable follow-up, not yet added.)
    for (const [tableName, constraintGuess] of [
      ['ApplicationAssets', 'ApplicationAssets_name_key'],
      ['NetworkDevices', 'NetworkDevices_name_key'],
      ['DatabaseAssets', 'DatabaseAssets_name_key'],
    ]) {
      try {
        await sequelize.query(`ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${constraintGuess}"`);
      } catch {
        // Non-Postgres dialects (or an already-dropped constraint) — safe to ignore.
      }
    }

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
    await ensureIndex('ScanRunRecords', ['toolId', 'completedAt'], 'idx_scan_run_records_tool_completed_at');
    await ensureIndex('ScanRunRecords', ['assetType', 'assetId', 'completedAt'], 'idx_scan_run_records_asset_completed_at');
    await ensureIndex('ScanRunRecords', ['status'], 'idx_scan_run_records_status');
    await ensureIndex('NotificationLedgers', ['userId'], 'idx_notification_ledgers_user_id');
    await ensureIndex('NotificationLedgers', ['status'], 'idx_notification_ledgers_status');
    await ensureIndex('NotificationLedgers', ['createdAt'], 'idx_notification_ledgers_created_at');
    await ensureIndex('AgentCommands', ['applicationAssetId', 'status'], 'idx_agent_commands_asset_status');
    await ensureIndex('TicketAssets', ['ticketId'], 'idx_ticket_assets_ticket_id');
    await ensureIndex('TicketAssets', ['assetType', 'assetId'], 'idx_ticket_assets_asset');
    await ensureIndex('DatabaseAssets', ['applicationAssetId'], 'idx_database_assets_application_asset_id');
    await ensureIndex('NetworkDevices', ['applicationAssetId'], 'idx_network_devices_application_asset_id');
    // Powers both the retention cleanup (delete-by-age, per asset) and the
    // visitor summary query (recent rows for one asset) — the two access
    // patterns this table actually serves.
    await ensureIndex('VisitorEvents', ['applicationAssetId', 'visitedAt'], 'idx_visitor_events_asset_visited_at');

    // Every tenant-scoped query now filters by organizationId — index it on
    // every one of those tables, not just the ones that already had one.
    for (const tableName of tenantScopedTables) {
      await ensureIndex(tableName, ['organizationId'], `idx_${tableName.toLowerCase()}_organization_id`);
    }
  }
  // Return initialized models
  return {
    organizationModel,
    defaultOrganization,
    userModel,
    ticketModel,
    ticketHistoryModel,
    ticketAssetModel,
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
    scanRunRecordModel,
    revokedTokenModel,
    notificationLedgerModel,
    securityStateModel,
    agentCommandModel,
    reportSnapshotModel,
    visitorEventModel,
  };
};
