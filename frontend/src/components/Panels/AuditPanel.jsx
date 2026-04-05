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
}) {
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
