/**
 * TicketForm Component
 * Form for creating new incident tickets
 * 
 * @param {Object} props
 * @param {string} props.title - Title input value
 * @param {Function} props.onTitleChange - Callback for title changes
 * @param {string} props.description - Description input value
 * @param {Function} props.onDescriptionChange - Callback for description changes
 * @param {string} props.priority - Selected priority
 * @param {Function} props.onPriorityChange - Callback for priority changes
 * @param {string} props.assigneeId - Selected assignee SCJ ID
 * @param {Function} props.onAssigneeChange - Callback for assignee changes
 * @param {number|string} props.businessImpactScore - Business impact score 0-100
 * @param {Function} props.onImpactScoreChange - Callback for impact score changes
 * @param {string} props.impactedServices - Impacted services text
 * @param {Function} props.onImpactedServicesChange - Callback for impacted services
 * @param {string} props.executiveSummary - Executive summary text
 * @param {Function} props.onExecutiveSummaryChange - Callback for executive summary
 * @param {Array} props.users - List of available users
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {boolean} props.isSubmitting - Whether form is currently submitting
 * @returns {JSX.Element}
 */
function TicketForm({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  priority,
  onPriorityChange,
  assigneeId,
  onAssigneeChange,
  businessImpactScore,
  onImpactScoreChange,
  impactedServices,
  onImpactedServicesChange,
  executiveSummary,
  onExecutiveSummaryChange,
  users,
  onSubmit,
  isSubmitting,
}) {
  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit(e)
  }

  return (
    <form onSubmit={handleSubmit} className="ticket-form">
      <FieldWithHint help="Use a short, specific incident title so assignees can understand the case immediately.">
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          required
          disabled={isSubmitting}
        />
      </FieldWithHint>

      <FieldWithHint help="Describe what happened, what is affected, and the current symptoms. This becomes the basis for triage and 5W1H notifications.">
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          required
          disabled={isSubmitting}
        />
      </FieldWithHint>

      <div className="staff-grid">
        <FieldWithHint help="Priority tells the system how urgently the incident should be handled.">
          <select value={priority} onChange={(e) => onPriorityChange(e.target.value)} disabled={isSubmitting}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="Assign the incident if the responsible CCC owner is already known. This triggers structured notifications.">
          <select value={assigneeId} onChange={(e) => onAssigneeChange(e.target.value)} disabled={isSubmitting}>
            <option value="">Unassigned</option>
            {users.filter((u) => u.scjId).map((u) => (
              <option key={u.scjId} value={u.scjId}>
                {u.scjId} - {u.name} {u.surname}
              </option>
            ))}
          </select>
        </FieldWithHint>

        <FieldWithHint help="Score the business impact from 0 to 100 so leadership can understand seriousness in non-technical terms.">
          <input
            type="number"
            min="0"
            max="100"
            value={businessImpactScore}
            onChange={(e) => onImpactScoreChange(e.target.value)}
            placeholder="Business impact score (0-100)"
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="List the systems, teams, or services that are affected so responders know where to look first.">
          <input
            value={impactedServices}
            onChange={(e) => onImpactedServicesChange(e.target.value)}
            placeholder="Impacted services"
            disabled={isSubmitting}
          />
        </FieldWithHint>
      </div>

      <FieldWithHint help="Explain the incident in simple language for managers and non-technical readers.">
        <textarea
          placeholder="Executive summary (non-technical)"
          value={executiveSummary}
          onChange={(e) => onExecutiveSummaryChange(e.target.value)}
          disabled={isSubmitting}
        />
      </FieldWithHint>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Ticket'}
      </button>
    </form>
  )
}

/**
 * Helper component for form fields with hints
 */
function FieldWithHint({ help, children }) {
  return (
    <div className="field-with-hint">
      {children}
      {help && <p className="field-hint">{help}</p>}
    </div>
  )
}

export default TicketForm
export { FieldWithHint }
