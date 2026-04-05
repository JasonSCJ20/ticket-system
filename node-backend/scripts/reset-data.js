import bcrypt from 'bcrypt';
import { sequelize, initModels } from '../src/models/index.js';
import { CONFIG } from '../src/config.js';
import { initAuthRateLimit } from '../src/services/authRateLimit.js';

async function recreateDefaultAdmin(userModel) {
  const passwordHash = bcrypt.hashSync(CONFIG.ADMIN_PASSWORD, 10);
  await userModel.create({
    username: CONFIG.ADMIN_USERNAME,
    name: CONFIG.ADMIN_USERNAME,
    surname: null,
    department: null,
    jobTitle: 'Cybersecurity Command Centre Manager',
    scjId: null,
    email: null,
    role: 'admin',
    password_hash: passwordHash,
  });
}

async function resetData() {
  const models = await initModels();
  await initAuthRateLimit();
  const resetOrder = [
    models.ticketHistoryModel,
    models.ticketResolutionReportModel,
    models.ticketCommentModel,
    models.ticketActionItemModel,
    models.connectorDeadLetterModel,
    models.connectorReceiptModel,
    models.auditLogModel,
    models.securityFindingModel,
    models.patchTaskModel,
    models.ticketModel,
    models.applicationAssetModel,
    models.networkDeviceModel,
    models.databaseAssetModel,
    models.userModel,
  ];

  await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    for (const model of resetOrder) {
      await model.destroy({ where: {} });
    }

    await sequelize.query('DELETE FROM AuthRateLimits');
    await sequelize.query("DELETE FROM sqlite_sequence WHERE name IN ('Users','Tickets','TicketHistories','ApplicationAssets','SecurityFindings','ConnectorDeadLetters','ConnectorReceipts','TicketResolutionReports','AuditLogs','TicketComments','TicketActionItems','NetworkDevices','DatabaseAssets','PatchTasks')");

    await recreateDefaultAdmin(models.userModel);
  } finally {
    await sequelize.query('PRAGMA foreign_keys = ON');
    await sequelize.close();
  }

  console.log('Application data reset complete. Default admin account recreated.');
}

resetData().catch(async (error) => {
  console.error('Reset failed:', error);
  await sequelize.close().catch(() => {});
  process.exit(1);
});