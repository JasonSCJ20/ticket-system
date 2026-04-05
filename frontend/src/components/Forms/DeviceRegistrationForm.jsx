import React from 'react'
import FieldWithHint from '../FieldWithHint'

/**
 * DeviceRegistrationForm Component
 * Allows administrators to register physical network devices in the system
 * 
 * @param {Object} props - Component props
 * @param {string} props.deviceName - Device name/hostname
 * @param {Function} props.onDeviceNameChange - Callback for device name changes
 * @param {string} props.deviceType - Device type (router, switch, etc.)
 * @param {Function} props.onDeviceTypeChange - Callback for device type changes
 * @param {string} props.deviceIp - Device IP address
 * @param {Function} props.onDeviceIpChange - Callback for IP address changes
 * @param {string} props.deviceLocation - Physical location of device
 * @param {Function} props.onDeviceLocationChange - Callback for location changes
 * @param {string} props.deviceVendor - Device vendor/manufacturer
 * @param {Function} props.onDeviceVendorChange - Callback for vendor changes
 * @param {string} props.deviceModel - Device model number
 * @param {Function} props.onDeviceModelChange - Callback for model changes
 * @param {string} props.deviceFirmware - Firmware version
 * @param {Function} props.onDeviceFirmwareChange - Callback for firmware changes
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {boolean} props.isSubmitting - Whether submission is in progress
 * @returns {JSX.Element}
 */
function DeviceRegistrationForm({
  deviceName,
  onDeviceNameChange,
  deviceType,
  onDeviceTypeChange,
  deviceIp,
  onDeviceIpChange,
  deviceLocation,
  onDeviceLocationChange,
  deviceVendor,
  onDeviceVendorChange,
  deviceModel,
  onDeviceModelChange,
  deviceFirmware,
  onDeviceFirmwareChange,
  onSubmit,
  isSubmitting = false,
}) {
  return (
    <form onSubmit={onSubmit} className="ticket-form staff-form">
      <div className="staff-grid">
        <FieldWithHint help="Use a clear device name so analysts can identify it immediately during an outage or intrusion.">
          <input
            placeholder="Device name"
            value={deviceName}
            onChange={(e) => onDeviceNameChange(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Device type drives how the platform describes the asset and what risk patterns are most relevant.">
          <select
            value={deviceType}
            onChange={(e) => onDeviceTypeChange(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="router">router</option>
            <option value="switch">switch</option>
            <option value="access_point">access_point</option>
            <option value="endpoint">endpoint</option>
            <option value="firewall">firewall</option>
            <option value="server">server</option>
            <option value="other">other</option>
          </select>
        </FieldWithHint>

        <FieldWithHint help="Use the management or service IP if known. This helps analysts map alerts to the right host quickly.">
          <input
            placeholder="IP address (optional)"
            value={deviceIp}
            onChange={(e) => onDeviceIpChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Location helps field and infrastructure teams find the physical asset during troubleshooting.">
          <input
            placeholder="Location"
            value={deviceLocation}
            onChange={(e) => onDeviceLocationChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Vendor is useful when matching advisories, firmware vulnerabilities, and support guidance.">
          <input
            placeholder="Vendor"
            value={deviceVendor}
            onChange={(e) => onDeviceVendorChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Model helps identify device-specific risks and maintenance procedures.">
          <input
            placeholder="Model"
            value={deviceModel}
            onChange={(e) => onDeviceModelChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>

        <FieldWithHint help="Track firmware so you can spot outdated network or hardware components more easily.">
          <input
            placeholder="Firmware version"
            value={deviceFirmware}
            onChange={(e) => onDeviceFirmwareChange(e.target.value)}
            disabled={isSubmitting}
          />
        </FieldWithHint>
      </div>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Registering...' : 'Register Device'}
      </button>
    </form>
  )
}

export default DeviceRegistrationForm
