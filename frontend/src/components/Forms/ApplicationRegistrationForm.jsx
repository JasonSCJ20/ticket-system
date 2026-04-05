import React from 'react'
import FieldWithHint from '../FieldWithHint'

/**
 * ApplicationRegistrationForm Component
 * Allows administrators to register applications in the monitoring system
 * 
 * @param {Object} props - Component props
 * @param {string} props.appName - Application name
 * @param {Function} props.onAppNameChange - Callback for name changes
 * @param {string} props.appBaseUrl - Base URL for health checks
 * @param {Function} props.onAppBaseUrlChange - Callback for URL changes
 * @param {string} props.appEnvironment - Deployment environment
 * @param {Function} props.onAppEnvironmentChange - Callback for environment changes
 * @param {string} props.appOwnerEmail - Owner email address
 * @param {Function} props.onAppOwnerEmailChange - Callback for owner email changes
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {boolean} props.isSubmitting - Whether submission is in progress
 * @returns {JSX.Element}
 */
function ApplicationRegistrationForm({
  appName,
  onAppNameChange,
  appBaseUrl,
  onAppBaseUrlChange,
  appEnvironment,
  onAppEnvironmentChange,
  appOwnerEmail,
  onAppOwnerEmailChange,
  onSubmit,
  isSubmitting = false,
}) {
  return (
    <form onSubmit={onSubmit} className="ticket-form staff-form">
      <div className="staff-grid">
        <FieldWithHint help="Give the business or service name of the application you want monitored.">
          <input
            placeholder="Application name"
            value={appName}
            onChange={(e) => onAppNameChange(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="This URL is used for runtime checks so the Health tab can tell if the application is up or down.">
          <input
            placeholder="Base URL"
            value={appBaseUrl}
            onChange={(e) => onAppBaseUrlChange(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Choose the environment so the platform can interpret operational impact correctly.">
          <select
            value={appEnvironment}
            onChange={(e) => onAppEnvironmentChange(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="The owner receives accountability for incidents and should be the first business or technical escalation point.">
          <input
            type="email"
            placeholder="Owner email"
            value={appOwnerEmail}
            onChange={(e) => onAppOwnerEmailChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Registering...' : 'Register Application'}
      </button>
    </form>
  )
}

export default ApplicationRegistrationForm
