import React from 'react'
import FieldWithHint from '../FieldWithHint'

/**
 * DatabaseRegistrationForm Component
 * Allows administrators to register critical databases in the system
 * 
 * @param {Object} props - Component props
 * @param {string} props.dbName - Database name/service name
 * @param {Function} props.onDbNameChange - Callback for name changes
 * @param {string} props.dbEngine - Database engine type
 * @param {Function} props.onDbEngineChange - Callback for engine changes
 * @param {string} props.dbEnvironment - Deployment environment (on_prem, cloud, hybrid)
 * @param {Function} props.onDbEnvironmentChange - Callback for environment changes
 * @param {string} props.dbHost - Database host/IP address
 * @param {Function} props.onDbHostChange - Callback for host changes
 * @param {string} props.dbPort - Database port number
 * @param {Function} props.onDbPortChange - Callback for port changes
 * @param {string} props.dbOwner - Owner email address
 * @param {Function} props.onDbOwnerChange - Callback for owner changes
 * @param {string} props.dbCriticality - Database criticality level
 * @param {Function} props.onDbCriticalityChange - Callback for criticality changes
 * @param {string} props.dbPatchLevel - Current patch level
 * @param {Function} props.onDbPatchLevelChange - Callback for patch level changes
 * @param {boolean} props.dbEncryptionAtRest - Whether encryption at rest is enabled
 * @param {Function} props.onDbEncryptionAtRestChange - Callback for encryption at rest toggle
 * @param {boolean} props.dbTlsInTransit - Whether TLS in transit is enabled
 * @param {Function} props.onDbTlsInTransitChange - Callback for TLS in transit toggle
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {boolean} props.isSubmitting - Whether submission is in progress
 * @returns {JSX.Element}
 */
function DatabaseRegistrationForm({
  dbName,
  onDbNameChange,
  dbEngine,
  onDbEngineChange,
  dbEnvironment,
  onDbEnvironmentChange,
  dbHost,
  onDbHostChange,
  dbPort,
  onDbPortChange,
  dbOwner,
  onDbOwnerChange,
  dbCriticality,
  onDbCriticalityChange,
  dbPatchLevel,
  onDbPatchLevelChange,
  dbEncryptionAtRest,
  onDbEncryptionAtRestChange,
  dbTlsInTransit,
  onDbTlsInTransitChange,
  onSubmit,
  isSubmitting = false,
}) {
  return (
    <form onSubmit={onSubmit} className="ticket-form staff-form">
      <div className="staff-grid">
        <FieldWithHint help="Use a recognizable service name so business and infrastructure teams can align on which database is affected.">
          <input
            placeholder="Database name"
            value={dbName}
            onChange={(e) => onDbNameChange(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Database engine matters because patch cycles and security controls differ by platform.">
          <select
            value={dbEngine}
            onChange={(e) => onDbEngineChange(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="postgresql">postgresql</option>
            <option value="mysql">mysql</option>
            <option value="mssql">mssql</option>
            <option value="oracle">oracle</option>
            <option value="mongodb">mongodb</option>
            <option value="redis">redis</option>
            <option value="other">other</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="Use the hosting model to distinguish local infrastructure from cloud or hybrid dependencies.">
          <select
            value={dbEnvironment}
            onChange={(e) => onDbEnvironmentChange(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="on_prem">on_prem</option>
            <option value="cloud">cloud</option>
            <option value="hybrid">hybrid</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="Host name or IP is used to identify the exact database asset during investigations.">
          <input
            placeholder="Host"
            value={dbHost}
            onChange={(e) => onDbHostChange(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Port helps analysts validate exposure and service reachability.">
          <input
            type="number"
            min="1"
            max="65535"
            placeholder="Port"
            value={dbPort}
            onChange={(e) => onDbPortChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Owner email is the accountable contact for remediation, approvals, and risk sign-off.">
          <input
            type="email"
            placeholder="Owner email"
            value={dbOwner}
            onChange={(e) => onDbOwnerChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Criticality tells the platform how damaging downtime or compromise would be to the business.">
          <select
            value={dbCriticality}
            onChange={(e) => onDbCriticalityChange(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="Patch level helps identify whether this database is behind vendor-supported security updates.">
          <input
            placeholder="Patch level (e.g. PostgreSQL 16.2)"
            value={dbPatchLevel}
            onChange={(e) => onDbPatchLevelChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>
      </div>

      <div className="staff-actions">
        <div className="field-with-hint compact-hint">
          <label>
            <input
              type="checkbox"
              checked={dbEncryptionAtRest}
              onChange={(e) => onDbEncryptionAtRestChange(e.target.checked)}
              disabled={isSubmitting}
            />
            {' '}Encryption at rest
          </label>
          <p className="field-hint">Enable this if stored data is encrypted on disk or underlying storage.</p>
        </div>

        <div className="field-with-hint compact-hint">
          <label>
            <input
              type="checkbox"
              checked={dbTlsInTransit}
              onChange={(e) => onDbTlsInTransitChange(e.target.checked)}
              disabled={isSubmitting}
            />
            {' '}TLS in transit
          </label>
          <p className="field-hint">Enable this if database traffic is protected while moving across the network.</p>
        </div>
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Registering...' : 'Register Database'}
      </button>
    </form>
  )
}

export default DatabaseRegistrationForm
