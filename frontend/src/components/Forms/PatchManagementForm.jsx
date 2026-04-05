import React from 'react'
import FieldWithHint from '../FieldWithHint'

/**
 * PatchManagementForm Component
 * Allows administrators to create patch management tasks
 * 
 * @param {Object} props - Component props
 * @param {string} props.patchAssetType - Asset type (application, network_device, database_asset)
 * @param {Function} props.onPatchAssetTypeChange - Callback for asset type changes
 * @param {string} props.patchAssetId - Selected asset ID
 * @param {Function} props.onPatchAssetIdChange - Callback for asset ID changes
 * @param {Array} props.patchAssets - Available assets for current asset type
 * @param {string} props.patchTitle - Patch task title
 * @param {Function} props.onPatchTitleChange - Callback for title changes
 * @param {string} props.patchSeverity - Severity level
 * @param {Function} props.onPatchSeverityChange - Callback for severity changes
 * @param {string} props.patchCurrentVersion - Current version
 * @param {Function} props.onPatchCurrentVersionChange - Callback for current version changes
 * @param {string} props.patchTargetVersion - Target version
 * @param {Function} props.onPatchTargetVersionChange - Callback for target version changes
 * @param {string} props.patchOwnerEmail - Owner email
 * @param {Function} props.onPatchOwnerEmailChange - Callback for owner email changes
 * @param {string} props.patchDueDate - Due date
 * @param {Function} props.onPatchDueDateChange - Callback for due date changes
 * @param {string} props.patchDescription - Description/notes
 * @param {Function} props.onPatchDescriptionChange - Callback for description changes
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {boolean} props.isSubmitting - Whether submission is in progress
 * @returns {JSX.Element}
 */
function PatchManagementForm({
  patchAssetType,
  onPatchAssetTypeChange,
  patchAssetId,
  onPatchAssetIdChange,
  patchAssets = [],
  patchTitle,
  onPatchTitleChange,
  patchSeverity,
  onPatchSeverityChange,
  patchCurrentVersion,
  onPatchCurrentVersionChange,
  patchTargetVersion,
  onPatchTargetVersionChange,
  patchOwnerEmail,
  onPatchOwnerEmailChange,
  patchDueDate,
  onPatchDueDateChange,
  patchDescription,
  onPatchDescriptionChange,
  onSubmit,
  isSubmitting = false,
}) {
  return (
    <form onSubmit={onSubmit} className="ticket-form staff-form">
      <div className="staff-grid">
        <FieldWithHint help="Select the asset class this patch work belongs to.">
          <select
            value={patchAssetType}
            onChange={(e) => onPatchAssetTypeChange(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="application">Application</option>
            <option value="network_device">Network Device</option>
            <option value="database_asset">Database Asset</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="Choose the specific asset to patch.">
          <select
            value={patchAssetId}
            onChange={(e) => onPatchAssetIdChange(e.target.value)}
            required
            disabled={isSubmitting}
          >
            {patchAssets.length === 0 && <option value="">No assets available</option>}
            {patchAssets.map((asset) => (
              <option key={`patch-asset-${asset.id}`} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </FieldWithHint>

        <FieldWithHint help="Clear title helps teams triage and prioritize quickly.">
          <input
            placeholder="Patch task title"
            value={patchTitle}
            onChange={(e) => onPatchTitleChange(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Set severity to align patch urgency with operational risk.">
          <select
            value={patchSeverity}
            onChange={(e) => onPatchSeverityChange(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="Track current version to understand patch delta.">
          <input
            placeholder="Current version"
            value={patchCurrentVersion}
            onChange={(e) => onPatchCurrentVersionChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Record target secure version for verification.">
          <input
            placeholder="Target version"
            value={patchTargetVersion}
            onChange={(e) => onPatchTargetVersionChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Owner receives accountability for closure and verification.">
          <input
            type="email"
            placeholder="Owner email"
            value={patchOwnerEmail}
            onChange={(e) => onPatchOwnerEmailChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Due date is used for overdue tracking and escalation.">
          <input
            type="date"
            value={patchDueDate}
            onChange={(e) => onPatchDueDateChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Capture enough context for implementation and rollback planning.">
          <textarea
            placeholder="Patch scope / notes"
            value={patchDescription}
            onChange={(e) => onPatchDescriptionChange(e.target.value)}
            rows={2}
            disabled={isSubmitting}
          />
        </FieldWithHint>
      </div>

      <button type="submit" disabled={!patchAssetId || isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Patch Task'}
      </button>
    </form>
  )
}

export default PatchManagementForm
