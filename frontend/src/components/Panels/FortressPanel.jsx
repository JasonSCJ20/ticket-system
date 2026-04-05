function FortressPanel({
  isOpen,
  onClose,
  isLoggedIn,
  lastRefreshAt,
  fortressPosture,
  securitySummary,
  executiveImpact,
  threatIntelOverview,
  networkVisibilityOverview,
  patchOverview,
  securityFindings,
  networkDevices,
  databaseOverview,
  onRunPassiveScan,
  onRunActiveScan,
  onRunRecoveryDrill,
  isPassiveScanBusy,
  isActiveScanBusy,
  isRecoveryDrillBusy,
  onUpdatePatchStatus,
  patchActionId,
  recoveryDrillResult,
}) {
  if (!isOpen || !isLoggedIn) return null

  const activeIntrusions = networkVisibilityOverview?.summary?.activeThreats || 0
  const criticalIntrusions = networkVisibilityOverview?.summary?.criticalThreats || 0
  const unresolvedPatches = patchOverview?.summary?.pending || 0
  const overduePatches = patchOverview?.summary?.overdue || 0
  const criticalFindings = securityFindings.filter((item) => item?.severity === 'critical' && ['new', 'investigating'].includes(item?.status)).length
  const highFindings = securityFindings.filter((item) => item?.severity === 'high' && ['new', 'investigating'].includes(item?.status)).length
  const onlineSensors = (networkVisibilityOverview?.sensors || []).filter((sensor) => sensor?.status === 'online').length
  const totalSensors = (networkVisibilityOverview?.sensors || []).length
  const hardenedDatabases = (databaseOverview?.assets || []).filter((asset) => asset?.encryptionAtRest && asset?.tlsInTransit).length
  const totalDatabases = (databaseOverview?.assets || []).length

  const fallbackFortressRiskScore = Math.min(
    100,
    (criticalIntrusions * 20)
      + (activeIntrusions * 8)
      + (criticalFindings * 15)
      + (highFindings * 7)
      + (overduePatches * 10)
      + (unresolvedPatches * 4),
  )

  const fortressRiskScore = fortressPosture?.fortressScore ?? fallbackFortressRiskScore
  const fortressState = fortressPosture?.postureBand || (fortressRiskScore >= 75
    ? 'critical'
    : fortressRiskScore >= 45
      ? 'elevated'
      : 'hardened')

  const recommendations = fortressPosture?.recommendations || [
    criticalIntrusions > 0 ? 'Trigger command centre incident lockdown: isolate suspect segments and enforce privileged session review.' : null,
    unresolvedPatches > 0 ? 'Run emergency patch sprint for exposed assets and verify rollback plans are tested.' : null,
    criticalFindings > 0 ? 'Assign all critical findings to named owners with strict closure deadlines and executive tracking.' : null,
    onlineSensors < totalSensors ? 'Restore offline sensors immediately so monitoring coverage remains complete.' : null,
    hardenedDatabases < totalDatabases ? 'Enforce encryption-at-rest and TLS-in-transit across all command centre data stores.' : null,
    (threatIntelOverview?.summary?.bountyCandidates || 0) > 0 ? 'Investigate high-value threat intel candidates before they can chain into command-centre compromise.' : null,
  ].filter(Boolean)

  const topPatchTasks = (patchOverview?.items || [])
    .filter((task) => task?.status !== 'completed')
    .slice()
    .sort((a, b) => {
      const aDue = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      const bDue = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      return aDue - bDue
    })
    .slice(0, 3)

  const securityTooling = Array.isArray(fortressPosture?.securityTooling)
    ? fortressPosture.securityTooling
    : []

  return (
    <div className="fortress-panel panel">
      <div className="fortress-header">
        <h2>Command Centre Fortress Dashboard</h2>
        <button className="ghost-btn" onClick={onClose}>Close</button>
      </div>

      <p className="onboarding-hint">
        This dashboard hardens the command centre itself. Track defensive health, patch posture, intrusion pressure,
        and sensor coverage so the command centre stays resilient while protecting every downstream asset.
      </p>

      <div className="fortress-state-row">
        <div className={`fortress-state-chip ${fortressState}`}>
          Fortress Status: <strong>{fortressState.toUpperCase()}</strong>
        </div>
        <div className="fortress-risk">Fortress Risk Score: <strong>{fortressRiskScore}</strong>/100</div>
        <div className="fortress-refreshed">Last refresh: <strong>{lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : 'n/a'}</strong></div>
      </div>

      <div className="fortress-actions">
        <button className="ghost-btn" onClick={() => onRunPassiveScan?.()} disabled={isPassiveScanBusy}>
          {isPassiveScanBusy ? 'Running Passive Scan...' : 'Run Passive Fortress Scan'}
        </button>
        <button className="ghost-btn active-toggle" onClick={() => onRunActiveScan?.()} disabled={isActiveScanBusy}>
          {isActiveScanBusy ? 'Running Active Scan...' : 'Run Active Fortress Scan'}
        </button>
        <button className="ghost-btn" onClick={() => onRunRecoveryDrill?.()} disabled={isRecoveryDrillBusy}>
          {isRecoveryDrillBusy ? 'Running Recovery Drill...' : 'Run Recovery Drill'}
        </button>
      </div>

      {recoveryDrillResult && (
        <div className={`fortress-drill-result ${recoveryDrillResult.exerciseStatus || 'warning'}`}>
          <strong>Recovery Drill: {(recoveryDrillResult.exerciseStatus || 'warning').toUpperCase()}</strong>
          <p>{recoveryDrillResult.message}</p>
          <span>
            Databases reviewed: {recoveryDrillResult.databasesReviewed || 0} | Remediation tasks created: {recoveryDrillResult.remediationTasksCreated || 0}
          </span>
        </div>
      )}

      <div className="fortress-grid">
        <article className="fortress-card">
          <h3>Intrusion Watch</h3>
          <p>Active intrusion signals</p>
          <strong>{activeIntrusions}</strong>
          <span>Critical: {criticalIntrusions}</span>
        </article>
        <article className="fortress-card">
          <h3>Patch Readiness</h3>
          <p>Pending hardening patches</p>
          <strong>{fortressPosture?.summary?.pendingPatches ?? unresolvedPatches}</strong>
          <span>Overdue: {fortressPosture?.summary?.overduePatches ?? overduePatches}</span>
        </article>
        <article className="fortress-card">
          <h3>Exposure Pressure</h3>
          <p>Critical and high unresolved findings</p>
          <strong>{(fortressPosture?.summary?.criticalFindings ?? criticalFindings) + highFindings}</strong>
          <span>Critical: {fortressPosture?.summary?.criticalFindings ?? criticalFindings} | High: {highFindings}</span>
        </article>
        <article className="fortress-card">
          <h3>Sensors and Eyes</h3>
          <p>Online defensive sensors</p>
          <strong>{fortressPosture?.summary?.idsEnabledDevices ?? onlineSensors}/{fortressPosture?.summary?.totalDevices ?? totalSensors}</strong>
          <span>Instrumented network devices with defensive visibility</span>
        </article>
        <article className="fortress-card">
          <h3>Data Vault Integrity</h3>
          <p>Databases hardened (encryption + TLS)</p>
          <strong>{fortressPosture?.summary?.hardenedDatabases ?? hardenedDatabases}/{fortressPosture?.summary?.totalDatabases ?? totalDatabases}</strong>
          <span>Command-centre datastore trust baseline</span>
        </article>
        <article className="fortress-card">
          <h3>Executive Threat Signal</h3>
          <p>Business-aligned pressure indicator</p>
          <strong>{executiveImpact?.riskIndex || 0}</strong>
          <span>Active findings: {securitySummary?.activeFindings || 0}</span>
        </article>
        <article className="fortress-card">
          <h3>Privileged Control</h3>
          <p>Admin path concentration</p>
          <strong>{fortressPosture?.summary?.adminCount ?? 0}</strong>
          <span>Configured admin identities in command centre</span>
        </article>
        <article className="fortress-card">
          <h3>Recovery Readiness</h3>
          <p>Backup and restore confidence</p>
          <strong>{fortressPosture?.summary?.recoveryReadinessScore ?? 0}</strong>
          <span>Healthy backups: {fortressPosture?.summary?.healthyBackups ?? 0} | Critical: {fortressPosture?.summary?.criticalBackups ?? 0}</span>
        </article>
        <article className="fortress-card fortress-card-tooling">
          <h3>Background Tool Stack</h3>
          <p>Live defensive systems feeding command centre alerts</p>
          <ul className="fortress-tooling-list">
            {securityTooling.map((tool) => (
              <li key={tool.id || tool.tool}>
                <div className="fortress-tooling-head">
                  <strong>{tool.engine ? `${tool.engine}: ${tool.tool}` : tool.tool}</strong>
                  <span className={`fortress-tooling-badge ${tool.status || 'offline'}`}>
                    {(tool.status || 'offline').toUpperCase()}
                  </span>
                </div>
                <div className="fortress-tooling-meta">
                  <span className={`fortress-tooling-scan ${tool.scanState || 'not_scanning'}`}>
                    {(tool.scanState || 'not_scanning') === 'scanning' ? 'SCANNING' : 'NOT SCANNING'}
                  </span>
                  <span>{tool.detail || 'No detail available'}</span>
                </div>
                <div className="fortress-tooling-footprint">
                  {tool.telemetryHealth?.state && (
                    <span className={`fortress-tooling-telemetry ${tool.telemetryHealth.state}`}>
                      Telemetry: {String(tool.telemetryHealth.state).toUpperCase()}
                      {typeof tool.telemetryHealth.lagMinutes === 'number' ? ` (${tool.telemetryHealth.lagMinutes}m lag)` : ''}
                    </span>
                  )}
                  <span>
                    Last seen: {tool.lastSeenAt ? new Date(tool.lastSeenAt).toLocaleString() : 'n/a'}
                  </span>
                  <span>
                    Coverage: {tool.protectedAssetCoverage?.protectedAssets ?? 0}/{tool.protectedAssetCoverage?.totalAssets ?? 0} assets ({tool.protectedAssetCoverage?.coveragePct ?? 0}%)
                  </span>
                  <span>
                    Command centre: {(tool.protectsCommandCentre ?? true) ? 'protected' : 'not protected'}
                  </span>
                  {tool.telemetryHealth?.reason && (
                    <span>
                      Signal: {tool.telemetryHealth.reason}
                    </span>
                  )}
                </div>
              </li>
            ))}
            {securityTooling.length === 0 && <li><span>No tooling telemetry available yet.</span></li>}
          </ul>
        </article>
      </div>

      <div className="fortress-recommendations">
        <h3>Fortress Hardening Orders</h3>
        <ul>
          {recommendations.map((item, index) => (
            <li key={`fortress-order-${index}`}>{item}</li>
          ))}
          {recommendations.length === 0 && <li>Defensive posture is stable. Keep monitoring cadence and patch hygiene active.</li>}
        </ul>
      </div>

      <div className="fortress-patch-queue">
        <h3>Immediate Remediation Queue</h3>
        <div className="fortress-patch-list">
          {topPatchTasks.map((task) => (
            <article key={task.id} className="fortress-patch-item">
              <div>
                <strong>{task.title}</strong>
                <p>{task.assetName || task.assetType} | Severity: {task.severity || 'n/a'} | Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}</p>
              </div>
              <div className="fortress-patch-actions">
                <button className="ghost-btn" onClick={() => onUpdatePatchStatus?.(task.id, 'in_progress')} disabled={patchActionId === task.id}>
                  {patchActionId === task.id ? 'Working...' : 'Start'}
                </button>
                <button className="ghost-btn" onClick={() => onUpdatePatchStatus?.(task.id, 'completed')} disabled={patchActionId === task.id}>
                  Complete
                </button>
              </div>
            </article>
          ))}
          {topPatchTasks.length === 0 && <p className="muted-copy">No open patch tasks are queued for immediate remediation.</p>}
        </div>
      </div>

      <div className="fortress-telemetry">
        <article>
          <h4>Threat Intel Pressure</h4>
          <p>High-value unresolved threat candidates: <strong>{threatIntelOverview?.summary?.bountyCandidates || 0}</strong></p>
          <p>Total active findings: <strong>{threatIntelOverview?.summary?.activeFindings || 0}</strong></p>
        </article>
        <article>
          <h4>Network Hunt Signals</h4>
          <p>East-west anomalies: <strong>{networkVisibilityOverview?.trafficAnalytics?.eastWestAnomalies || 0}</strong></p>
          <p>External exposure signals: <strong>{networkVisibilityOverview?.trafficAnalytics?.externalExposureSignals || 0}</strong></p>
        </article>
      </div>

      <div className="fortress-telemetry fortress-telemetry-privileged">
        <article>
          <h4>Privileged Activity Feed</h4>
          <ul className="fortress-activity-list">
            {(fortressPosture?.recentPrivilegedActions || []).map((entry) => (
              <li key={entry.id}>
                <strong>{entry.actor}</strong>
                <span>{entry.action}</span>
                <em>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'n/a'}</em>
              </li>
            ))}
            {(fortressPosture?.recentPrivilegedActions || []).length === 0 && <li><span>No recent privileged activity recorded.</span></li>}
          </ul>
        </article>
      </div>
    </div>
  )
}

export default FortressPanel
