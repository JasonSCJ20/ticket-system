/**
 * AuditPanel Component
 * Displays audit logs with search and filter functionality
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether panel is visible
 * @param {Function} props.onClose - Callback when user clicks close
 * @param {Array} props.logs - Array of audit log objects
 * @param {string} props.filterCategory - Current filter category
 * @param {Function} props.onFilterChange - Callback when filter changes
 * @param {string} props.searchTerm - Current search term
 * @param {Function} props.onSearchChange - Callback when search changes
 * @param {boolean} props.isLoggedIn - Whether user is logged in
 * @returns {JSX.Element|null}
 */
function AuditPanel({
  isOpen,
  onClose,
  logs,
  filterCategory,
  onFilterChange,
  searchTerm,
  onSearchChange,
  isLoggedIn,
  workforceTelemetry,
  notificationLedger,
}) {
  const telemetrySummary = workforceTelemetry?.summary || {}
  const telemetryUsers = Array.isArray(workforceTelemetry?.users) ? workforceTelemetry.users : []
  const recentUsers = telemetryUsers
    .slice()
    .sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime())
    .slice(0, 8)

  // Filter logs based on category and search term
  const filteredLogs = logs.filter((log) => {
    // Filter by category
    if (filterCategory !== 'all') {
      const categoryMatch = log.category === filterCategory || log.severity === filterCategory
      if (!categoryMatch) return false
    }

    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      return (
        (log.description || '').toLowerCase().includes(searchLower) ||
        (log.userId || '').toLowerCase().includes(searchLower) ||
        (log.userName || '').toLowerCase().includes(searchLower)
      )
    }

    return true
  })

  if (!isOpen || !isLoggedIn) return null

  return (
    <div className="audit-panel panel">
      <div className="audit-header">
        <h2>📋 Audit Logs</h2>
        <button className="ghost-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Workforce Eyes & Ears</h3>
        <p className="muted-copy" style={{ marginTop: 0 }}>
          Command-centre roster visibility with live presence, geo-location, Telegram telemetry, and account risk indicators.
        </p>
        <div className="stats-grid">
          <article className="stat-card">
            <p>Registered Users</p>
            <strong>{telemetrySummary.totalUsers || 0}</strong>
          </article>
          <article className="stat-card">
            <p>Online Now</p>
            <strong>{telemetrySummary.onlineUsers || 0}</strong>
          </article>
          <article className="stat-card">
            <p>Telegram Configured</p>
            <strong>{telemetrySummary.telegramConfiguredUsers || 0}</strong>
          </article>
          <article className="stat-card">
            <p>Delivered (24h)</p>
            <strong>{telemetrySummary.telegramDeliveredRecently || 0}</strong>
          </article>
          <article className="stat-card">
            <p>Read Signal (24h)</p>
            <strong>{telemetrySummary.telegramReadRecently || 0}</strong>
          </article>
          <article className="stat-card">
            <p>New (30d)</p>
            <strong>{telemetrySummary.createdLast30Days || 0}</strong>
          </article>
          <article className="stat-card" style={telemetrySummary.staleAccountCount > 0 ? { borderColor: '#f59e0b' } : {}}>
            <p>Stale Accounts</p>
            <strong style={telemetrySummary.staleAccountCount > 0 ? { color: '#f59e0b' } : {}}>{telemetrySummary.staleAccountCount || 0}</strong>
          </article>
          <article className="stat-card" style={telemetrySummary.highRiskAccountCount > 0 ? { borderColor: '#ef4444' } : {}}>
            <p>High Risk</p>
            <strong style={telemetrySummary.highRiskAccountCount > 0 ? { color: '#ef4444' } : {}}>{telemetrySummary.highRiskAccountCount || 0}</strong>
          </article>
        </div>

        <div className="audit-logs-container" style={{ marginTop: '0.75rem' }}>
          {recentUsers.length > 0 ? (
            <table className="audit-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Audience</th>
                  <th>Teams</th>
                  <th>Presence</th>
                  <th>Last Seen</th>
                  <th>Location</th>
                  <th>Telegram</th>
                  <th>Read Signal</th>
                  <th>Risks</th>
                </tr>
              </thead>
              <tbody>
                {recentUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username || `${user.name || ''} ${user.surname || ''}`.trim() || 'Unknown'}</td>
                    <td>{user.audienceCode || '-'}</td>
                    <td>{Array.isArray(user.operationalTeams) && user.operationalTeams.length ? user.operationalTeams.join(', ') : '-'}</td>
                    <td>
                      <span className={`badge severity-${user.isOnline ? 'low' : 'info'}`}>
                        {user.isOnline ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </td>
                    <td className="mono">{user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : 'never'}</td>
                    <td className="mono" title={user.lastSeenIp || user.lastLoginIp || ''}>
                      {user.lastSeenGeo || user.lastSeenIp || user.lastLoginIp || '-'}
                    </td>
                    <td>{user.telegramDeliveryStatus || 'unknown'}</td>
                    <td className="mono">{user.lastTelegramReadAt ? new Date(user.lastTelegramReadAt).toLocaleString() : 'no signal'}</td>
                    <td>
                      {Array.isArray(user.staleRisks) && user.staleRisks.length > 0 ? (
                        <span className={`badge severity-${user.staleRiskLevel === 'high' ? 'critical' : 'medium'}`} title={user.staleRisks.join(', ')}>
                          {user.staleRiskLevel === 'high' ? '⚠ HIGH' : '⚠ LOW'}
                        </span>
                      ) : (
                        <span className="badge severity-low">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted-copy">No workforce telemetry available yet.</p>
          )}
        </div>
      </section>

      {Array.isArray(notificationLedger) && notificationLedger.length > 0 && (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Notification Delivery Ledger</h3>
          <p className="muted-copy" style={{ marginTop: 0 }}>
            Audit-grade per-message delivery trail for all outbound Telegram notifications.
          </p>
          <div className="audit-logs-container">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Ref Type</th>
                  <th>Message Preview</th>
                  <th>Delivered At</th>
                  <th>Read At</th>
                </tr>
              </thead>
              <tbody>
                {notificationLedger.slice(0, 100).map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '-'}</td>
                    <td>{entry.username || `#${entry.userId}`}</td>
                    <td>{entry.channel || 'telegram'}</td>
                    <td>
                      <span className={`badge severity-${entry.status === 'delivered' || entry.status === 'read' ? 'low' : entry.status === 'not_configured' ? 'info' : 'high'}`}>
                        {(entry.status || 'unknown').toUpperCase()}
                      </span>
                    </td>
                    <td>{entry.referenceType || '-'}</td>
                    <td className="mono" title={entry.subject || ''}>{entry.subject ? entry.subject.slice(0, 60) + (entry.subject.length > 60 ? '...' : '') : '-'}</td>
                    <td className="mono">{entry.deliveredAt ? new Date(entry.deliveredAt).toLocaleString() : '-'}</td>
                    <td className="mono">{entry.readAt ? new Date(entry.readAt).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="audit-controls">
        <div className="field-with-hint">
          <p className="field-hint">
            Search by user, action, event type, or keywords to find a specific activity quickly.
          </p>
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="audit-search"
          />
        </div>

        <div className="field-with-hint">
          <p className="field-hint">
            Filter the audit stream by event category so you can focus on one type of operational evidence at
            a time.
          </p>
          <select
            value={filterCategory}
            onChange={(e) => onFilterChange(e.target.value)}
            className="audit-filter"
          >
            <option value="all">All Events</option>
            <option value="user_activity">User Activity</option>
            <option value="security_event">Security Event</option>
            <option value="data_access">Data Access</option>
            <option value="vulnerability">Vulnerability</option>
            <option value="malicious">Malicious Activity</option>
          </select>
        </div>
      </div>

      <div className="audit-logs-container">
        {filteredLogs && filteredLogs.length > 0 ? (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Event Type</th>
                <th>Description</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, idx) => (
                <tr key={idx} className={`audit-log-row severity-${(log.severity || 'info').toLowerCase()}`}>
                  <td className="mono">{new Date(log.createdAt).toLocaleString()}</td>
                  <td>{log.userName || log.userId || 'System'}</td>
                  <td>{log.category || log.type || 'Activity'}</td>
                  <td>{log.description || log.action || 'N/A'}</td>
                  <td className={`badge severity-${(log.severity || 'info').toLowerCase()}`}>
                    {(log.severity || 'info').toUpperCase()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted-copy">No audit logs match the current filter.</p>
        )}
      </div>
    </div>
  )
}

export default AuditPanel
