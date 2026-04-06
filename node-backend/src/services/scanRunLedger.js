export async function recordScanRun({
  ScanRunRecord,
  AuditLog,
  toolId,
  toolName,
  engine,
  mode,
  status = 'completed',
  triggerSource = 'system',
  actor = 'system',
  actorRole = null,
  assetType = 'command_centre',
  assetId = null,
  assetName = 'Command Centre',
  assetRef = null,
  findings = [],
  newFindingsCount = null,
  detail = '',
  startedAt = null,
  completedAt = null,
  metadata = {},
  ipAddress = null,
}) {
  if (!ScanRunRecord) return null;

  const findingRows = Array.isArray(findings) ? findings.filter(Boolean) : [];
  const findingIds = findingRows
    .map((item) => Number(item?.id))
    .filter((value) => Number.isInteger(value));
  const safeStartedAt = startedAt ? new Date(startedAt) : null;
  const safeCompletedAt = completedAt ? new Date(completedAt) : null;
  const durationMs = safeStartedAt && safeCompletedAt
    ? Math.max(0, safeCompletedAt.getTime() - safeStartedAt.getTime())
    : null;

  const record = await ScanRunRecord.create({
    toolId,
    toolName,
    engine,
    mode,
    status,
    triggerSource,
    actor,
    actorRole,
    assetType,
    assetId,
    assetName,
    assetRef,
    findingIds,
    findingsCount: findingIds.length,
    newFindingsCount: Number.isInteger(newFindingsCount) ? newFindingsCount : findingIds.length,
    detail,
    startedAt: safeStartedAt,
    completedAt: safeCompletedAt,
    durationMs,
    metadata,
  });

  if (AuditLog) {
    await AuditLog.create({
      entityType: 'scan_run_record',
      entityId: String(record.id),
      actor,
      actorRole,
      action: 'security.scan_run_recorded',
      ipAddress,
      details: JSON.stringify({
        toolId,
        toolName,
        engine,
        mode,
        status,
        triggerSource,
        assetType,
        assetId,
        assetName,
        findingIds,
      }),
    });
  }

  return record;
}
