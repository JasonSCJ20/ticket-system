import { useState } from 'react'

/**
 * SettingsPanel Component
 * Displays user settings for theme, notifications, password, and preferences
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether panel is visible
 * @param {Function} props.onClose - Callback when user clicks close
 * @param {Object} props.currentUser - Current user object with name, email, etc.
 * @param {string} props.currentRole - User's role (admin, analyst, viewer)
 * @param {string} props.userTheme - Current theme (light or dark)
 * @param {Function} props.onThemeChange - Callback when theme changes
 * @param {boolean} props.userNotifications - Whether notifications enabled
 * @param {Function} props.onNotificationToggle - Callback to toggle notifications
 * @returns {JSX.Element|null}
 */
function SettingsPanel({
  isOpen,
  onClose,
  currentUser,
  currentRole,
  userTheme,
  onThemeChange,
  userNotifications,
  onNotificationToggle,
  isLoggedIn,
  mfaEnabled,
  mfaSetupSecret,
  mfaSetupUri,
  mfaManageCode,
  onMfaManageCodeChange,
  onSetupMfa,
  onEnableMfa,
  onDisableMfa,
}) {
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const handlePasswordUpdate = () => {
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters')
      return
    }
    // In a real app, call API to update password
    alert('Password updated successfully')
    setShowPasswordChange(false)
    setNewPassword('')
    setConfirmPassword('')
  }

  const displayedJobTitle = currentUser?.jobTitle || currentUser?.job_title || 'N/A'

  if (!isOpen || !isLoggedIn) return null

  return (
    <div className="settings-panel panel">
      <div className="settings-header">
        <h2>⚙️ Settings</h2>
        <button className="ghost-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="settings-section">
        <h3>Personal Details</h3>
        <p className="muted-copy">Your profile information (read-only on this dashboard)</p>
        <div className="info-box">
          <p>
            <strong>Name:</strong> {currentUser?.name || 'N/A'}
          </p>
          <p>
            <strong>Surname:</strong> {currentUser?.surname || 'N/A'}
          </p>
          <p>
            <strong>Job Title:</strong> {displayedJobTitle}
          </p>
          <p>
            <strong>Department:</strong> {currentUser?.department || 'N/A'}
          </p>
          <p>
            <strong>Email:</strong> {currentUser?.email || 'N/A'}
          </p>
          <p>
            <strong>Role:</strong> {currentRole.toUpperCase()}
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="field-with-hint">
          <label className="setting-option">
            <input
              type="radio"
              name="theme"
              value="light"
              checked={userTheme === 'light'}
              onChange={() => onThemeChange('light')}
            />
            <span>Light Theme</span>
          </label>
          <p className="field-hint">
            Choose the dashboard appearance that is easiest for you to read during long monitoring sessions.
          </p>
        </div>
        <div className="field-with-hint">
          <label className="setting-option">
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={userTheme === 'dark'}
              onChange={() => onThemeChange('dark')}
            />
            <span>Dark Theme</span>
          </label>
          <p className="field-hint">
            Dark mode reduces glare and is useful for low-light monitoring environments.
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h3>Notifications</h3>
        <div className="field-with-hint">
          <label className="setting-option">
            <input
              type="checkbox"
              checked={userNotifications}
              onChange={onNotificationToggle}
            />
            <span>Enable In-App Notifications</span>
          </label>
          <p className="field-hint">
            Turn this on if you want the dashboard to surface urgent tickets and security findings while you
            work.
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h3>Security</h3>
        {!showPasswordChange ? (
          <button className="ghost-btn" onClick={() => setShowPasswordChange(true)}>
            Change Password
          </button>
        ) : (
          <div className="password-form">
            <input
              type="password"
              placeholder="New Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <div className="button-row">
              <button className="ghost-btn" onClick={handlePasswordUpdate}>
                Update
              </button>
              <button
                className="ghost-btn secondary"
                onClick={() => {
                  setShowPasswordChange(false)
                  setNewPassword('')
                  setConfirmPassword('')
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="field-with-hint" style={{ marginTop: '0.75rem' }}>
          <p className="muted-copy"><strong>MFA Status:</strong> {mfaEnabled ? 'Enabled' : 'Disabled'}</p>
          {!mfaEnabled && (
            <button className="ghost-btn" onClick={onSetupMfa}>
              Start MFA Setup
            </button>
          )}
          {!!mfaSetupSecret && (
            <div className="info-box" style={{ marginTop: '0.5rem' }}>
              <p><strong>Authenticator Secret:</strong> {mfaSetupSecret}</p>
              {mfaSetupUri && <p className="muted-copy">otpauth URL generated. Add this account in your authenticator app.</p>}
            </div>
          )}
          <input
            type="text"
            placeholder="MFA code"
            value={mfaManageCode}
            onChange={(e) => onMfaManageCodeChange(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            style={{ marginTop: '0.5rem' }}
          />
          <div className="button-row" style={{ marginTop: '0.5rem' }}>
            {!mfaEnabled ? (
              <button className="ghost-btn" onClick={onEnableMfa}>
                Enable MFA
              </button>
            ) : (
              <button className="ghost-btn secondary" onClick={onDisableMfa}>
                Disable MFA
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Preferences</h3>
        <p className="muted-copy">Data refresh interval: Auto</p>
        <p className="muted-copy">Severity sort: Critical First</p>
        <p className="muted-copy">Timezone: Local System</p>
      </div>
    </div>
  )
}

export default SettingsPanel
