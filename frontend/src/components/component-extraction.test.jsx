import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TicketForm from './Forms/TicketForm'
import DeviceRegistrationForm from './Forms/DeviceRegistrationForm'
import DatabaseRegistrationForm from './Forms/DatabaseRegistrationForm'
import ApplicationRegistrationForm from './Forms/ApplicationRegistrationForm'
import PatchManagementForm from './Forms/PatchManagementForm'
import AuditPanel from './Panels/AuditPanel'
import FortressPanel from './Panels/FortressPanel'
import SettingsPanel from './Panels/SettingsPanel'
import SituationTile from './Tiles/SituationTile'

describe('Extracted component behavior', () => {
  test('TicketForm updates fields and submits', async () => {
    const user = userEvent.setup()
    const onTitleChange = vi.fn()
    const onSubmit = vi.fn()

    render(
      <TicketForm
        title="Disk outage"
        onTitleChange={onTitleChange}
        description="Storage array became unavailable during backup run"
        onDescriptionChange={vi.fn()}
        priority="medium"
        onPriorityChange={vi.fn()}
        assigneeId=""
        onAssigneeChange={vi.fn()}
        businessImpactScore={50}
        onImpactScoreChange={vi.fn()}
        impactedServices=""
        onImpactedServicesChange={vi.fn()}
        executiveSummary=""
        onExecutiveSummaryChange={vi.fn()}
        users={[{ id: 1, scjId: '12345678-12345', name: 'Alex', surname: 'Lee' }, { id: 2, name: 'No SCJ' }]}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    await user.type(screen.getByPlaceholderText('Title'), ' - urgent')
    expect(onTitleChange).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Create Ticket' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('option', { name: /12345678-12345 - Alex Lee/i })).toBeInTheDocument()
  })

  test('AuditPanel filters rows and triggers close', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    const logs = [
      {
        createdAt: '2026-04-05T10:00:00.000Z',
        category: 'security_event',
        severity: 'high',
        userName: 'analyst1',
        description: 'Breach attempt blocked',
      },
      {
        createdAt: '2026-04-05T10:05:00.000Z',
        category: 'user_activity',
        severity: 'info',
        userName: 'analyst2',
        description: 'Profile update',
      },
    ]

    render(
      <AuditPanel
        isOpen
        onClose={onClose}
        logs={logs}
        filterCategory="security_event"
        onFilterChange={vi.fn()}
        searchTerm="breach"
        onSearchChange={vi.fn()}
        isLoggedIn
      />,
    )

    expect(screen.getByText(/breach attempt blocked/i)).toBeInTheDocument()
    expect(screen.queryByText(/profile update/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('FortressPanel renders backend posture telemetry and recommendations', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onRunPassiveScan = vi.fn()
    const onRunActiveScan = vi.fn()
    const onRunRecoveryDrill = vi.fn()
    const onUpdatePatchStatus = vi.fn()

    render(
      <FortressPanel
        isOpen
        onClose={onClose}
        isLoggedIn
        lastRefreshAt="2026-04-05T10:10:00.000Z"
        fortressPosture={{
          fortressScore: 82,
          postureBand: 'defensible',
          summary: {
            pendingPatches: 2,
            overduePatches: 1,
            criticalFindings: 1,
            idsEnabledDevices: 3,
            totalDevices: 4,
            hardenedDatabases: 1,
            totalDatabases: 2,
            adminCount: 1,
            recoveryReadinessScore: 74,
            healthyBackups: 1,
            criticalBackups: 1,
          },
          recommendations: ['Close overdue command-centre patch tasks immediately.'],
          securityTooling: [
            {
              id: 'ids-ips',
              engine: 'Suricata',
              tool: 'Passive Application Scanner',
              status: 'online',
              scanState: 'scanning',
              detail: 'IDS/IPS enabled on 3/4 devices',
              lastSeenAt: '2026-04-05T10:08:00.000Z',
              protectsCommandCentre: true,
              protectedAssetCoverage: { protectedAssets: 3, totalAssets: 4, coveragePct: 75 },
              telemetryHealth: { state: 'healthy', lagMinutes: 4, reason: 'Recent heartbeat is healthy' },
            },
            {
              id: 'runtime-guardian',
              engine: 'Cilium Tetragon',
              tool: 'Runtime Threat Hunting and Response',
              status: 'online',
              scanState: 'scanning',
              detail: 'eBPF runtime protection scope: command centre and registered assets',
              lastSeenAt: '2026-04-05T10:09:00.000Z',
              protectsCommandCentre: true,
              protectedAssetCoverage: { protectedAssets: 4, totalAssets: 4, coveragePct: 100 },
              telemetryHealth: { state: 'watch', lagMinutes: 22, reason: 'Telemetry is stale and should be checked' },
            },
            {
              id: 'database-security',
              engine: 'Trivy',
              tool: 'Database Security Scanner',
              status: 'offline',
              scanState: 'not_scanning',
              detail: 'Databases monitored: 0',
              lastSeenAt: null,
              protectsCommandCentre: false,
              protectedAssetCoverage: { protectedAssets: 0, totalAssets: 4, coveragePct: 0 },
              telemetryHealth: { state: 'critical', lagMinutes: null, reason: 'No telemetry heartbeat received yet' },
            },
          ],
          recentPrivilegedActions: [{ id: 1, actor: 'Jason Tshaka', action: 'patch.status_updated', createdAt: '2026-04-05T10:00:00.000Z' }],
        }}
        securitySummary={{ activeFindings: 3 }}
        executiveImpact={{ riskIndex: 41 }}
        threatIntelOverview={{ summary: { bountyCandidates: 2, activeFindings: 3 } }}
        networkVisibilityOverview={{ summary: { activeThreats: 2, criticalThreats: 1 }, trafficAnalytics: { eastWestAnomalies: 1, externalExposureSignals: 2 }, sensors: [] }}
        patchOverview={{ summary: { pending: 2, overdue: 1 }, items: [{ id: 7, title: 'Patch CCC Sensor Stack', assetName: 'Sensor Stack', assetType: 'application', severity: 'critical', dueDate: '2026-04-06T00:00:00.000Z', status: 'todo' }] }}
        securityFindings={[]}
        networkDevices={[]}
        databaseOverview={{ assets: [] }}
        onRunPassiveScan={onRunPassiveScan}
        onRunActiveScan={onRunActiveScan}
        onRunRecoveryDrill={onRunRecoveryDrill}
        onUpdatePatchStatus={onUpdatePatchStatus}
        isPassiveScanBusy={false}
        isActiveScanBusy={false}
        isRecoveryDrillBusy={false}
        patchActionId={null}
        recoveryDrillResult={{ exerciseStatus: 'warning', message: 'Recovery drill completed with follow-up actions.', databasesReviewed: 2, remediationTasksCreated: 1 }}
      />,
    )

    expect(screen.getByText(/command centre fortress dashboard/i)).toBeInTheDocument()
    expect(screen.getByText(/fortress risk score/i)).toBeInTheDocument()
    expect(screen.getByText(/close overdue command-centre patch tasks immediately/i)).toBeInTheDocument()
    expect(screen.getByText(/backup and restore confidence/i)).toBeInTheDocument()
    expect(screen.getByText(/jason tshaka/i)).toBeInTheDocument()
    expect(screen.getByText(/background tool stack/i)).toBeInTheDocument()
    expect(screen.getByText(/suricata: passive application scanner/i)).toBeInTheDocument()
    expect(screen.getByText(/cilium tetragon: runtime threat hunting and response/i)).toBeInTheDocument()
    expect(screen.getByText('ONLINE')).toBeInTheDocument()
    expect(screen.getByText('SCANNING')).toBeInTheDocument()
    expect(screen.getByText(/trivy: database security scanner/i)).toBeInTheDocument()
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
    expect(screen.getByText('NOT SCANNING')).toBeInTheDocument()
    expect(screen.getByText(/telemetry: healthy/i)).toBeInTheDocument()
    expect(screen.getByText(/telemetry: watch \(22m lag\)/i)).toBeInTheDocument()
    expect(screen.getByText(/telemetry: critical/i)).toBeInTheDocument()
    expect(screen.getByText(/coverage: 3\/4 assets \(75%\)/i)).toBeInTheDocument()
    expect(screen.getByText(/command centre: protected/i)).toBeInTheDocument()
    expect(screen.getByText(/command centre: not protected/i)).toBeInTheDocument()
    expect(screen.getByText(/signal: telemetry is stale and should be checked/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /run passive fortress scan/i }))
    expect(onRunPassiveScan).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /run active fortress scan/i }))
    expect(onRunActiveScan).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /run recovery drill/i }))
    expect(onRunRecoveryDrill).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(onUpdatePatchStatus).toHaveBeenCalledWith(7, 'in_progress')

    expect(screen.getByText(/recovery drill completed with follow-up actions/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('SituationTile expanded controls fire callbacks', async () => {
    const user = userEvent.setup()
    const onSnapToggle = vi.fn()
    const onMoveTo = vi.fn()
    const onPresentationModeChange = vi.fn()

    render(
      <SituationTile
        position={{ x: 100, y: 40 }}
        onPositionChange={vi.fn()}
        isDragging={false}
        onDraggingChange={vi.fn()}
        expanded
        onExpandChange={vi.fn()}
        criticalCount={3}
        highCount={5}
        topAction="Escalate credential reset incident"
        lastUpdated="2026-04-05T10:10:00.000Z"
        criticalPulse
        snapToCorner
        onSnapToggle={onSnapToggle}
        onMoveTo={onMoveTo}
        presentationMode="executive"
        onPresentationModeChange={onPresentationModeChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /snap to corner: on/i }))
    expect(onSnapToggle).toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Top Left' }))
    expect(onMoveTo).toHaveBeenCalledWith('top-left')

    await user.click(screen.getByRole('button', { name: 'Analyst View' }))
    expect(onPresentationModeChange).toHaveBeenCalledWith('analyst')
  })

  test('SettingsPanel toggles theme, notifications, and validates password update flow', async () => {
    const user = userEvent.setup()
    const onThemeChange = vi.fn()
    const onNotificationToggle = vi.fn()
    const onClose = vi.fn()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    render(
      <SettingsPanel
        isOpen
        onClose={onClose}
        currentUser={{ name: 'Casey', surname: 'Tran', email: 'casey@scj.local', department: 'SOC' }}
        currentRole="admin"
        userTheme="light"
        onThemeChange={onThemeChange}
        userNotifications
        onNotificationToggle={onNotificationToggle}
        isLoggedIn
      />,
    )

    await user.click(screen.getByLabelText('Dark Theme'))
    expect(onThemeChange).toHaveBeenCalledWith('dark')

    await user.click(screen.getByLabelText('Enable In-App Notifications'))
    expect(onNotificationToggle).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Change Password' }))
    await user.type(screen.getByPlaceholderText('New Password'), 'abc123')
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'abc124')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(alertSpy).toHaveBeenCalledWith('Passwords do not match')

    await user.clear(screen.getByPlaceholderText('Confirm Password'))
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'abc123')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(alertSpy).toHaveBeenCalledWith('Password updated successfully')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    alertSpy.mockRestore()
  })

  test('DeviceRegistrationForm emits field changes and submit', async () => {
    const user = userEvent.setup()
    const onDeviceNameChange = vi.fn()
    const onDeviceTypeChange = vi.fn()
    const onDeviceIpChange = vi.fn()
    const onSubmit = vi.fn((e) => e.preventDefault())

    render(
      <DeviceRegistrationForm
        deviceName="Core Router"
        onDeviceNameChange={onDeviceNameChange}
        deviceType="router"
        onDeviceTypeChange={onDeviceTypeChange}
        deviceIp=""
        onDeviceIpChange={onDeviceIpChange}
        deviceLocation="DC-1"
        onDeviceLocationChange={vi.fn()}
        deviceVendor="Cisco"
        onDeviceVendorChange={vi.fn()}
        deviceModel="ISR"
        onDeviceModelChange={vi.fn()}
        deviceFirmware="17.9"
        onDeviceFirmwareChange={vi.fn()}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    await user.type(screen.getByPlaceholderText('Device name'), ' A')
    expect(onDeviceNameChange).toHaveBeenCalled()

    await user.selectOptions(screen.getByRole('combobox'), 'switch')
    expect(onDeviceTypeChange).toHaveBeenCalledWith('switch')

    await user.type(screen.getByPlaceholderText('IP address (optional)'), '10.10.1.10')
    expect(onDeviceIpChange).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Register Device' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('DatabaseRegistrationForm emits select and checkbox changes', async () => {
    const user = userEvent.setup()
    const onDbEngineChange = vi.fn()
    const onDbEnvironmentChange = vi.fn()
    const onDbEncryptionAtRestChange = vi.fn()
    const onDbTlsInTransitChange = vi.fn()
    const onSubmit = vi.fn((e) => e.preventDefault())

    render(
      <DatabaseRegistrationForm
        dbName="Orders"
        onDbNameChange={vi.fn()}
        dbEngine="postgresql"
        onDbEngineChange={onDbEngineChange}
        dbEnvironment="on_prem"
        onDbEnvironmentChange={onDbEnvironmentChange}
        dbHost="10.0.0.12"
        onDbHostChange={vi.fn()}
        dbPort="5432"
        onDbPortChange={vi.fn()}
        dbOwner="db-owner@scj.local"
        onDbOwnerChange={vi.fn()}
        dbCriticality="high"
        onDbCriticalityChange={vi.fn()}
        dbPatchLevel="PostgreSQL 16.2"
        onDbPatchLevelChange={vi.fn()}
        dbEncryptionAtRest={false}
        onDbEncryptionAtRestChange={onDbEncryptionAtRestChange}
        dbTlsInTransit={false}
        onDbTlsInTransitChange={onDbTlsInTransitChange}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0], 'mysql')
    expect(onDbEngineChange).toHaveBeenCalledWith('mysql')

    await user.selectOptions(selects[1], 'cloud')
    expect(onDbEnvironmentChange).toHaveBeenCalledWith('cloud')

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])
    expect(onDbEncryptionAtRestChange).toHaveBeenCalledWith(true)

    await user.click(checkboxes[1])
    expect(onDbTlsInTransitChange).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole('button', { name: 'Register Database' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('ApplicationRegistrationForm emits changes and submit', async () => {
    const user = userEvent.setup()
    const onAppNameChange = vi.fn()
    const onAppEnvironmentChange = vi.fn()
    const onSubmit = vi.fn((e) => e.preventDefault())

    render(
      <ApplicationRegistrationForm
        appName="Portal"
        onAppNameChange={onAppNameChange}
        appBaseUrl="https://portal.scj.local"
        onAppBaseUrlChange={vi.fn()}
        appEnvironment="production"
        onAppEnvironmentChange={onAppEnvironmentChange}
        appOwnerEmail="owner@scj.local"
        onAppOwnerEmailChange={vi.fn()}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    await user.type(screen.getByPlaceholderText('Application name'), ' API')
    expect(onAppNameChange).toHaveBeenCalled()

    await user.selectOptions(screen.getByRole('combobox'), 'staging')
    expect(onAppEnvironmentChange).toHaveBeenCalledWith('staging')

    await user.click(screen.getByRole('button', { name: 'Register Application' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('PatchManagementForm handles asset type and patch details', async () => {
    const user = userEvent.setup()
    const onPatchAssetTypeChange = vi.fn()
    const onPatchAssetIdChange = vi.fn()
    const onPatchDescriptionChange = vi.fn()
    const onSubmit = vi.fn((e) => e.preventDefault())

    render(
      <PatchManagementForm
        patchAssetType="application"
        onPatchAssetTypeChange={onPatchAssetTypeChange}
        patchAssetId="app-1"
        onPatchAssetIdChange={onPatchAssetIdChange}
        patchAssets={[{ id: 'app-1', name: 'HR Portal' }, { id: 'app-2', name: 'Billing API' }]}
        patchTitle="Update runtime"
        onPatchTitleChange={vi.fn()}
        patchSeverity="high"
        onPatchSeverityChange={vi.fn()}
        patchCurrentVersion="1.0.0"
        onPatchCurrentVersionChange={vi.fn()}
        patchTargetVersion="1.0.2"
        onPatchTargetVersionChange={vi.fn()}
        patchOwnerEmail="patch-owner@scj.local"
        onPatchOwnerEmailChange={vi.fn()}
        patchDueDate="2026-04-30"
        onPatchDueDateChange={vi.fn()}
        patchDescription="Window approved"
        onPatchDescriptionChange={onPatchDescriptionChange}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0], 'network_device')
    expect(onPatchAssetTypeChange).toHaveBeenCalledWith('network_device')

    await user.selectOptions(selects[1], 'app-2')
    expect(onPatchAssetIdChange).toHaveBeenCalledWith('app-2')

    await user.type(screen.getByPlaceholderText('Patch scope / notes'), ' and rollback verified')
    expect(onPatchDescriptionChange).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Create Patch Task' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
