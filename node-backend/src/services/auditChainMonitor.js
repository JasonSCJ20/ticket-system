import { verifyAuditChain } from './auditChain.js';

// verifyAuditChain has always existed, but until now the only thing that
// ever called it was a human clicking "verify" on the Governance page — if
// a row were ever tampered with, nothing would notice on its own. Called on
// a schedule (see app.js): runs the same real verification, and if it ever
// comes back invalid, alerts immediately instead of waiting for someone to
// think to check.
export async function monitorAuditChain({ models, alert }) {
  const { AuditLog } = models;
  const result = await verifyAuditChain(AuditLog);

  if (!result.valid) {
    await alert(result);
    await AuditLog.create({
      entityType: 'audit_log',
      entityId: 'chain',
      actor: 'scheduler',
      actorRole: 'system',
      action: 'audit_chain.tamper_detected',
      ipAddress: null,
      details: JSON.stringify(result),
    });
  }

  return result;
}
