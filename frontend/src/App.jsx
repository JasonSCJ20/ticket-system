import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchTickets,
  createTicket,
  fetchTicketHistory,
  fetchTicketResolutionReport,
  fetchCurrentUser,
  fetchExecutiveTicketMetrics,
  transitionTicketLifecycle,
  fetchTicketComments,
  addTicketComment,
  fetchTicketActionItems,
  createTicketActionItem,
  updateTicketActionItem,
  login,
  logoutSession,
  createAccount,
  forgotUsername,
  requestPasswordReset,
  resetPassword,
  fetchMfaSetup,
  enableMfa,
  disableMfa,
  updateTicket,
  fetchUsers,
  createUser,
  preloadUsers,
  fetchSecurityHealthSummary,
  fetchFortressPosture,
  runFortressRecoveryDrill,
  fetchExecutiveImpact,
  fetchSecurityApplications,
  fetchThreatIntelOverview,
  fetchNetworkVisibilityOverview,
  fetchNetworkDevices,
  registerNetworkDevice,
  runDevicePassiveScan,
  runDeviceIdsIpsCheck,
  fetchDatabaseOverview,
  registerDatabaseAsset,
  runDatabaseSecurityScan,
  fetchPatchTasks,
  createPatchTask,
  updatePatchTaskStatus,
  registerSecurityApplication,
  runPassiveSecurityScan,
  runActiveSecurityScan,
  fetchSecurityFindings,
  updateFindingStatus,
  confirmSecurityFinding,
  createTicketFromFinding,
  fetchExecutiveReport,
  fetchTechnicalReport,
  fetchAuditLogs,
  generateAssistantTriage,
  fetchAssistantCommandCentre,
  analyzeAssistantTicket,
  analyzeAssistantAlert,
  tendAssistantTicket,
  tendAssistantAlert,
} from './api'
import SettingsPanel from './components/Panels/SettingsPanel'
import AuditPanel from './components/Panels/AuditPanel'
import FortressPanel from './components/Panels/FortressPanel'
import TicketForm from './components/Forms/TicketForm'
import DeviceRegistrationForm from './components/Forms/DeviceRegistrationForm'
import DatabaseRegistrationForm from './components/Forms/DatabaseRegistrationForm'
import ApplicationRegistrationForm from './components/Forms/ApplicationRegistrationForm'
import PatchManagementForm from './components/Forms/PatchManagementForm'
import SituationTile from './components/Tiles/SituationTile'

const SCJ_ID_REGEX = /^\d{8}-\d{5}$/
const SCJ_ID_EXAMPLE = '00000000-00000'
const NHNE_EMAIL_DOMAIN = '@nhne.org.za'
const LIFECYCLE_STAGES = ['identified', 'triaged', 'contained', 'eradicated', 'recovered', 'postmortem', 'closed']
const APP_NAME = 'Cybersecurity Command Centre'

function normalizePersonName(value) {
  return value.trim().replace(/\s+/g, ' ')
}

function buildDerivedUsername(name, surname) {
  return `${normalizePersonName(name)} ${normalizePersonName(surname)}`.trim()
}

function validateRegistrationPassword(password) {
  if (password.length < 12) return 'Password must be at least 12 characters'
  if (!/[a-z]/.test(password)) return 'Password must contain lowercase letters'
  if (!/[A-Z]/.test(password)) return 'Password must contain uppercase letters'
  if (!/[0-9]/.test(password)) return 'Password must contain numbers'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain special characters'
  return ''
}

function decodeRoleFromToken(token) {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.role || null
  } catch {
    return null
  }
}

function FieldWithHint({ help, children }) {
  return (
    <div className="field-with-hint">
      {children}
      {help && <p className="field-hint">{help}</p>}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState('board-snapshot')
  const [error, setError] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('access_token'))
  const [currentRole, setCurrentRole] = useState(decodeRoleFromToken(localStorage.getItem('access_token')) || 'analyst')
  const isAdmin = currentRole === 'admin'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [authMessage, setAuthMessage] = useState('')

  const [registerName, setRegisterName] = useState('')
  const [registerSurname, setRegisterSurname] = useState('')
  const [registerScjId, setRegisterScjId] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('')

  const [forgotUsernameEmail, setForgotUsernameEmail] = useState('')
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')

  const [users, setUsers] = useState([])
  const [tickets, setTickets] = useState([])
  const [securitySummary, setSecuritySummary] = useState(null)
  const [fortressPosture, setFortressPosture] = useState(null)
  const [fortressDrillResult, setFortressDrillResult] = useState(null)
  const [executiveImpact, setExecutiveImpact] = useState(null)
  const [executiveMetrics, setExecutiveMetrics] = useState(null)
  const [securityApplications, setSecurityApplications] = useState([])
  const [securityFindings, setSecurityFindings] = useState([])
  const [threatIntelOverview, setThreatIntelOverview] = useState(null)
  const [networkVisibilityOverview, setNetworkVisibilityOverview] = useState(null)
  const [networkDevices, setNetworkDevices] = useState([])
  const [databaseOverview, setDatabaseOverview] = useState(null)
  const [patchOverview, setPatchOverview] = useState({ summary: null, grouped: null, items: [] })
  const [currentUser, setCurrentUser] = useState(null)
  const derivedRegisterUsername = useMemo(
    () => buildDerivedUsername(registerName, registerSurname),
    [registerName, registerSurname],
  )
  const [executiveReportData, setExecutiveReportData] = useState(null)
  const [technicalReportData, setTechnicalReportData] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assigneeId, setAssigneeId] = useState('')
  const [businessImpactScore, setBusinessImpactScore] = useState(50)
  const [impactedServices, setImpactedServices] = useState('')
  const [executiveSummary, setExecutiveSummary] = useState('')

  const [staffName, setStaffName] = useState('')
  const [staffSurname, setStaffSurname] = useState('')
  const [staffDepartment, setStaffDepartment] = useState('Networks')
  const [staffJobTitle, setStaffJobTitle] = useState('Security Analyst')
  const [staffTelegramNumber, setStaffTelegramNumber] = useState('')
  const [staffEmail, setStaffEmail] = useState('')
  const [staffScjId, setStaffScjId] = useState('')

  const [appName, setAppName] = useState('')
  const [appBaseUrl, setAppBaseUrl] = useState('')
  const [appEnvironment, setAppEnvironment] = useState('production')
  const [appOwnerEmail, setAppOwnerEmail] = useState('')

  const [deviceName, setDeviceName] = useState('')
  const [deviceType, setDeviceType] = useState('router')
  const [deviceIp, setDeviceIp] = useState('')
  const [deviceLocation, setDeviceLocation] = useState('Server Room')
  const [deviceVendor, setDeviceVendor] = useState('')
  const [deviceModel, setDeviceModel] = useState('')
  const [deviceFirmware, setDeviceFirmware] = useState('')

  const [dbName, setDbName] = useState('')
  const [dbEngine, setDbEngine] = useState('postgresql')
  const [dbEnvironment, setDbEnvironment] = useState('on_prem')
  const [dbHost, setDbHost] = useState('')
  const [dbPort, setDbPort] = useState('5432')
  const [dbOwner, setDbOwner] = useState('')
  const [dbCriticality, setDbCriticality] = useState('high')
  const [dbPatchLevel, setDbPatchLevel] = useState('')
  const [dbEncryptionAtRest, setDbEncryptionAtRest] = useState(true)
  const [dbTlsInTransit, setDbTlsInTransit] = useState(true)

  const [patchAssetType, setPatchAssetType] = useState('application')
  const [patchAssetId, setPatchAssetId] = useState('')
  const [patchTitle, setPatchTitle] = useState('')
  const [patchDescription, setPatchDescription] = useState('')
  const [patchSeverity, setPatchSeverity] = useState('high')
  const [patchCurrentVersion, setPatchCurrentVersion] = useState('')
  const [patchTargetVersion, setPatchTargetVersion] = useState('')
  const [patchOwnerEmail, setPatchOwnerEmail] = useState('')
  const [patchDueDate, setPatchDueDate] = useState('')
  const [patchActionId, setPatchActionId] = useState(null)

  const [selectedTicket, setSelectedTicket] = useState(null)
  const [historyItems, setHistoryItems] = useState([])
  const [resolutionReport, setResolutionReport] = useState(null)
  const [ticketComments, setTicketComments] = useState([])
  const [ticketActionItems, setTicketActionItems] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [commentVisibility, setCommentVisibility] = useState('internal')
  const [actionTitle, setActionTitle] = useState('')
  const [actionOwnerScjId, setActionOwnerScjId] = useState('')
  const [actionDueAt, setActionDueAt] = useState('')

  const [findingActionId, setFindingActionId] = useState(null)
  const [findingAssigneeMap, setFindingAssigneeMap] = useState({})

  const [assistantTitle, setAssistantTitle] = useState('')
  const [assistantDescription, setAssistantDescription] = useState('')
  const [assistantPriority, setAssistantPriority] = useState('medium')
  const [assistantImpact, setAssistantImpact] = useState(50)
  const [assistantOutput, setAssistantOutput] = useState(null)
  const [assistantCommand, setAssistantCommand] = useState(null)
  const [assistantTicketOutput, setAssistantTicketOutput] = useState(null)
  const [assistantAlertOutput, setAssistantAlertOutput] = useState(null)
  const [assistantNote, setAssistantNote] = useState('')
  const [assistantSidecarOpen, setAssistantSidecarOpen] = useState(false)
  const [assistantQuickTicketId, setAssistantQuickTicketId] = useState('')
  const [assistantQuickAlertId, setAssistantQuickAlertId] = useState('')
  const [assistantQuickBusy, setAssistantQuickBusy] = useState(false)
  const [presentationMode, setPresentationMode] = useState('executive')
  const [showAllIntrusions, setShowAllIntrusions] = useState(false)
  const [lastRefreshAt, setLastRefreshAt] = useState(null)
  const [situationExpanded, setSituationExpanded] = useState(false)
  const [situationPosition, setSituationPosition] = useState({ x: null, y: 14 })
  const [isDraggingSituation, setIsDraggingSituation] = useState(false)
  const [snapSituationToCorner, setSnapSituationToCorner] = useState(localStorage.getItem('ccc_situation_snap_default') !== 'false')
  const [criticalPulse, setCriticalPulse] = useState(false)
  const previousCriticalCountRef = useRef(null)
  const loadAllPromiseRef = useRef(null)

  const situationPositionStorageKey = useMemo(() => {
    const identity = currentUser?.id || currentUser?.username || currentRole || 'guest'
    return `ccc_situation_position_${identity}`
  }, [currentUser?.id, currentUser?.username, currentRole])

  const situationSnapStorageKey = useMemo(() => {
    const identity = currentUser?.id || currentUser?.username || currentRole || 'guest'
    return `ccc_situation_snap_${identity}`
  }, [currentUser?.id, currentUser?.username, currentRole])

  // Top Navigation Bar State
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [auditPanelOpen, setAuditPanelOpen] = useState(false)
  const [fortressPanelOpen, setFortressPanelOpen] = useState(false)
  const [userTheme, setUserTheme] = useState(localStorage.getItem('user_theme') || 'light')
  const [userNotifications, setUserNotifications] = useState(localStorage.getItem('user_notifications') !== 'false')
  const [currentDateTime, setCurrentDateTime] = useState(new Date())
  const [auditLogFilter, setAuditLogFilter] = useState('all')
  const [auditLogSearchTerm, setAuditLogSearchTerm] = useState('')
  const [healthViewFilter, setHealthViewFilter] = useState('all')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaSetupSecret, setMfaSetupSecret] = useState('')
  const [mfaSetupUri, setMfaSetupUri] = useState('')
  const [mfaManageCode, setMfaManageCode] = useState('')
  const [busyActions, setBusyActions] = useState({})
  const [activityMessage, setActivityMessage] = useState('')
  const [scanMode, setScanMode] = useState(null)
  const [flippedPatchCards, setFlippedPatchCards] = useState({})
  const [patchLaneOrder, setPatchLaneOrder] = useState({})
  const [patchDragState, setPatchDragState] = useState({ sourceLaneKey: '', sourceTaskId: null, overLaneKey: '', overTaskId: null })

  const handleUnauthorized = () => {
    setIsLoggedIn(false)
    localStorage.removeItem('access_token')
  }

  const setActionBusy = (actionKey, isBusy) => {
    setBusyActions((current) => ({ ...current, [actionKey]: isBusy }))
  }

  const isActionBusy = (actionKey) => Boolean(busyActions[actionKey])

  const hasBusyActions = useMemo(
    () => Object.values(busyActions).some(Boolean),
    [busyActions],
  )

  const runBusyAction = async (actionKey, message, operation) => {
    setActionBusy(actionKey, true)
    setActivityMessage(message)
    try {
      return await operation()
    } finally {
      setActionBusy(actionKey, false)
    }
  }

  const loadAll = async () => {
    if (loadAllPromiseRef.current) {
      return loadAllPromiseRef.current
    }

    const run = (async () => {
      try {
      const [
        usersData,
        ticketsData,
        summary,
        fortress,
        impact,
        metrics,
        apps,
        findings,
        threatIntel,
        networkVisibility,
        devices,
        dbOverview,
        patchData,
        assistantCommandData,
        me,
        technical,
      ] = await Promise.all([
        fetchUsers(),
        fetchTickets(),
        fetchSecurityHealthSummary(),
        fetchFortressPosture(),
        fetchExecutiveImpact(),
        fetchExecutiveTicketMetrics(),
        fetchSecurityApplications(),
        fetchSecurityFindings(),
        fetchThreatIntelOverview(),
        fetchNetworkVisibilityOverview(),
        fetchNetworkDevices(),
        fetchDatabaseOverview(),
        fetchPatchTasks(),
        fetchAssistantCommandCentre(),
        fetchCurrentUser(),
        fetchTechnicalReport(),
      ])

      if ([usersData, ticketsData, summary, fortress, impact, metrics, apps, findings, threatIntel, networkVisibility, devices, dbOverview, patchData, assistantCommandData, me, technical].some((v) => v === null)) return handleUnauthorized()

      setUsers(usersData)
      setTickets(ticketsData)
      setSecuritySummary(summary)
      setFortressPosture(fortress)
      setExecutiveImpact(impact)
      setExecutiveMetrics(metrics)
      setSecurityApplications(apps)
      setSecurityFindings(findings)
      setThreatIntelOverview(threatIntel)
      setNetworkVisibilityOverview(networkVisibility)
      setNetworkDevices(Array.isArray(devices) ? devices : [])
      setDatabaseOverview(dbOverview)
      setPatchOverview({
        summary: patchData?.summary || null,
        grouped: patchData?.grouped || null,
        items: Array.isArray(patchData?.items) ? patchData.items : [],
      })
      setAssistantCommand(assistantCommandData)
      setCurrentUser(me)
      setTechnicalReportData(technical)
      setLastRefreshAt(new Date().toISOString())

      if (isAdmin) {
        const [executive, logs] = await Promise.all([fetchExecutiveReport(), fetchAuditLogs()])
        if (executive === null || logs === null) return handleUnauthorized()
        setExecutiveReportData(executive)
        setAuditLogs(Array.isArray(logs) ? logs : [])
      } else {
        setExecutiveReportData({ forbidden: true })
        setAuditLogs([])
      }
      } catch (err) {
        setError(err.message || 'Failed to refresh dashboard data.')
      }
    })()

    loadAllPromiseRef.current = run
    try {
      return await run
    } finally {
      if (loadAllPromiseRef.current === run) {
        loadAllPromiseRef.current = null
      }
    }
  }

  useEffect(() => {
    if (isLoggedIn) loadAll()
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return
    const refreshTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      loadAll()
    }, 45000)
    return () => clearInterval(refreshTimer)
  }, [isLoggedIn])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedPositionRaw = localStorage.getItem(situationPositionStorageKey)
    const savedSnapRaw = localStorage.getItem(situationSnapStorageKey)

    if (savedSnapRaw !== null) {
      setSnapSituationToCorner(savedSnapRaw !== 'false')
    }

    if (!savedPositionRaw) {
      const defaultX = Math.max(12, window.innerWidth - 300)
      setSituationPosition({ x: defaultX, y: 14 })
      return
    }

    try {
      const parsed = JSON.parse(savedPositionRaw)
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        setSituationPosition({ x: parsed.x, y: parsed.y })
        return
      }
    } catch {
      // Fall back to default when storage value is invalid.
    }

    const defaultX = Math.max(12, window.innerWidth - 300)
    setSituationPosition({ x: defaultX, y: 14 })
  }, [situationPositionStorageKey, situationSnapStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (situationPosition.x === null || situationPosition.y === null) return
    localStorage.setItem(situationPositionStorageKey, JSON.stringify(situationPosition))
  }, [situationPosition, situationPositionStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('ccc_situation_snap_default', snapSituationToCorner ? 'true' : 'false')
    localStorage.setItem(situationSnapStorageKey, snapSituationToCorner ? 'true' : 'false')
  }, [snapSituationToCorner, situationSnapStorageKey])

  // Update current date/time on a light cadence to avoid full-app re-render churn.
  useEffect(() => {
    const timer = setInterval(() => setCurrentDateTime(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  // Apply user theme preference
  useEffect(() => {
    if (userTheme === 'dark') {
      document.body.classList.add('dark-theme')
      document.body.classList.remove('light-theme')
    } else {
      document.body.classList.add('light-theme')
      document.body.classList.remove('dark-theme')
    }
    localStorage.setItem('user_theme', userTheme)
  }, [userTheme])

  // Handle notification preference change
  const handleNotificationToggle = () => {
    const newValue = !userNotifications
    setUserNotifications(newValue)
    localStorage.setItem('user_notifications', newValue)
  }

  // Handle theme change
  const handleThemeChange = (theme) => {
    setUserTheme(theme)
  }

  const onLogin = async (e) => {
    e.preventDefault()
    setError('')
    setAuthMessage('')
    const normalizedUsername = username.trim()
    if (!normalizedUsername || !password) {
      setError('Username and password are required')
      return
    }
    try {
      const result = await login(normalizedUsername, password, mfaCode)
      if (result?.mfaRequired) {
        setMfaRequired(true)
        setAuthMessage('MFA is enabled for this account. Enter your authenticator code to continue.')
        return
      }
      setCurrentRole(decodeRoleFromToken(localStorage.getItem('access_token')) || 'analyst')
      setPassword('')
      setMfaCode('')
      setMfaRequired(false)
      setIsLoggedIn(true)
    } catch (err) {
      setError(err.message || 'Login failed')
    }
  }

  const switchAuthMode = (mode, clearMessage = true) => {
    setAuthMode(mode)
    setError('')
    setMfaRequired(false)
    setMfaCode('')
    if (clearMessage) setAuthMessage('')
  }

  const onCreateAccount = async (e) => {
    e.preventDefault()
    setError('')
    setAuthMessage('')

    const normalizedEmail = registerEmail.trim().toLowerCase()
    const normalizedScjId = registerScjId.trim()
    const passwordError = validateRegistrationPassword(registerPassword)

    if (!registerName.trim() || !registerSurname.trim()) {
      setError('Name and surname are required')
      return
    }
    if (!SCJ_ID_REGEX.test(normalizedScjId)) {
      setError(`SCJ ID must be format ${SCJ_ID_EXAMPLE}`)
      return
    }
    if (!normalizedEmail.endsWith(NHNE_EMAIL_DOMAIN)) {
      setError('Email address must use the @nhne.org.za domain')
      return
    }
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (registerPassword !== registerPasswordConfirm) {
      setError('Passwords do not match')
      return
    }

    try {
      await createAccount({
        username: derivedRegisterUsername,
        name: normalizePersonName(registerName),
        surname: normalizePersonName(registerSurname),
        scjId: normalizedScjId,
        email: normalizedEmail,
        password: registerPassword,
      })
      setAuthMessage('Account created successfully. You can now log in.')
      setUsername(derivedRegisterUsername)
      setRegisterName('')
      setRegisterSurname('')
      setRegisterScjId('')
      setRegisterEmail('')
      setRegisterPassword('')
      setRegisterPasswordConfirm('')
      switchAuthMode('login', false)
    } catch (err) {
      setError(err.message || 'Failed to create account. Please verify name/surname, SCJ ID, and @nhne.org.za email requirements.')
    }
  }

  const onForgotUsername = async (e) => {
    e.preventDefault()
    setError('')
    setAuthMessage('')
    try {
      const result = await forgotUsername(forgotUsernameEmail)
      setAuthMessage(result?.username ? `Your username is: ${result.username}` : result?.message || 'If account exists, recovery details were generated.')
    } catch (err) {
      setError(err.message || 'Failed to recover username')
    }
  }

  const onRequestPasswordReset = async (e) => {
    e.preventDefault()
    setError('')
    setAuthMessage('')
    try {
      const result = await requestPasswordReset(resetIdentifier)
      setAuthMessage(result?.message || 'If account exists, reset code issued by email.')
      switchAuthMode('reset-password', false)
    } catch (err) {
      setError(err.message || 'Failed to request password reset')
    }
  }

  const onResetPassword = async (e) => {
    e.preventDefault()
    setError('')
    setAuthMessage('')
    if (resetNewPassword !== resetConfirmPassword) {
      setError('Passwords do not match')
      return
    }
    try {
      await resetPassword({
        email: resetIdentifier,
        resetCode,
        newPassword: resetNewPassword,
      })
      setAuthMessage('Password reset successful. Please log in with your new password.')
      setPassword('')
      switchAuthMode('login', false)
    } catch (err) {
      setError(err.message || 'Failed to reset password')
    }
  }

  const onLogout = async (reason = '') => {
    await logoutSession().catch(() => {})
    localStorage.removeItem('access_token')
    setIsLoggedIn(false)
    setCurrentUser(null)
    setSettingsPanelOpen(false)
    setAuditPanelOpen(false)
    setFortressPanelOpen(false)
    setAssistantSidecarOpen(false)
    setSelectedTicket(null)
    setBusyActions({})
    setActivityMessage('')
    setMfaCode('')
    setMfaRequired(false)
    setMfaSetupSecret('')
    setMfaSetupUri('')
    setMfaManageCode('')
    if (reason) setAuthMessage(reason)
  }

  const onSetupMfa = async () => {
    setError('')
    try {
      const setup = await fetchMfaSetup()
      if (setup === null) return handleUnauthorized()
      setMfaSetupSecret(setup.secret || '')
      setMfaSetupUri(setup.otpauthUrl || '')
      setAuthMessage('MFA secret generated. Add it to your authenticator app, then enter a code to enable MFA.')
    } catch (err) {
      setError(err.message || 'Failed to initialize MFA setup')
    }
  }

  const onEnableMfa = async () => {
    setError('')
    try {
      const result = await enableMfa(mfaManageCode)
      if (result === null) return handleUnauthorized()
      setMfaManageCode('')
      setMfaSetupSecret('')
      setMfaSetupUri('')
      setAuthMessage('MFA enabled successfully. Future logins will require a code.')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to enable MFA')
    }
  }

  const onDisableMfa = async () => {
    setError('')
    try {
      const result = await disableMfa(mfaManageCode)
      if (result === null) return handleUnauthorized()
      setMfaManageCode('')
      setMfaSetupSecret('')
      setMfaSetupUri('')
      setAuthMessage('MFA disabled successfully.')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to disable MFA')
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return

    const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000
    let timeoutId

    const resetTimer = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        onLogout('You were logged out after 5 minutes of inactivity. Please sign in again.')
      }, INACTIVITY_TIMEOUT_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }))
    resetTimer()

    return () => {
      clearTimeout(timeoutId)
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer))
    }
  }, [isLoggedIn])

  const displayedFullName = [currentUser?.name, currentUser?.surname].filter(Boolean).join(' ') || 'Logged-in User'
  const displayedJobTitle = currentUser?.jobTitle || (currentRole === 'admin' ? 'Cybersecurity Command Centre Manager' : 'Security Analyst')

  const onCreateTicket = async (e) => {
    e.preventDefault()
    setError('')
    await runBusyAction('create-ticket', 'Creating incident ticket...', async () => {
      try {
        if (assigneeId && !SCJ_ID_REGEX.test(assigneeId)) throw new Error('Assignee ID must be in SCJ format.')
        await createTicket({
          title,
          description,
          priority,
          assigneeId: assigneeId || null,
          businessImpactScore: Number(businessImpactScore),
          impactedServices: impactedServices || undefined,
          executiveSummary: executiveSummary || undefined,
        })
        setTitle('')
        setDescription('')
        setPriority('medium')
        setAssigneeId('')
        setBusinessImpactScore(50)
        setImpactedServices('')
        setExecutiveSummary('')
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to create ticket')
      }
    })
  }

  const onUpdateStatus = async (ticketId, status) => {
    setError('')
    try {
      const payload = {
        status,
        resolutionNotes: status === 'resolved' || status === 'closed' ? 'Issue remediated and validated by assignee.' : undefined,
        rootCause: status === 'resolved' || status === 'closed' ? 'Service/control failure investigated and addressed.' : undefined,
        actionsTaken: status === 'resolved' || status === 'closed' ? 'Containment, remediation, verification, and service checks completed.' : undefined,
        preventiveActions: status === 'resolved' || status === 'closed' ? 'Added monitoring and preventive controls for recurrence reduction.' : undefined,
      }
      const updated = await updateTicket(ticketId, payload)
      if (updated === null) return handleUnauthorized()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to update status')
    }
  }

  const onTransitionStage = async (ticketId, stage) => {
    setError('')
    try {
      const moved = await transitionTicketLifecycle(ticketId, { stage, note: `Moved to ${stage} from workspace` })
      if (moved === null) return handleUnauthorized()
      await loadAll()
      await openTicketWorkspace(moved)
    } catch (err) {
      setError(err.message || 'Failed to transition lifecycle stage')
    }
  }

  const onRegisterStaff = async (e) => {
    e.preventDefault()
    setError('')
    try {
      if (!SCJ_ID_REGEX.test(staffScjId.trim())) throw new Error(`SCJ ID must be format ${SCJ_ID_EXAMPLE}`)
      const created = await createUser({
        name: staffName.trim(),
        surname: staffSurname.trim(),
        department: staffDepartment,
        jobTitle: staffJobTitle.trim(),
        telegramNumber: staffTelegramNumber.trim(),
        email: staffEmail.trim(),
        scjId: staffScjId.trim(),
      })
      if (created === null) return handleUnauthorized()
      setStaffName('')
      setStaffSurname('')
      setStaffDepartment('Networks')
      setStaffJobTitle('Security Analyst')
      setStaffTelegramNumber('')
      setStaffEmail('')
      setStaffScjId('')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to register staff')
    }
  }

  const onPreloadStaff = async () => {
    setError('')
    try {
      const loaded = await preloadUsers()
      if (loaded === null) return handleUnauthorized()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to preload staff')
    }
  }

  const onRegisterApplication = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const created = await registerSecurityApplication({
        name: appName.trim(),
        baseUrl: appBaseUrl.trim(),
        environment: appEnvironment,
        ownerEmail: appOwnerEmail.trim() || undefined,
      })
      if (created === null) return handleUnauthorized()
      setAppName('')
      setAppBaseUrl('')
      setAppEnvironment('production')
      setAppOwnerEmail('')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to register application')
    }
  }

  const onRegisterDevice = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const created = await registerNetworkDevice({
        name: deviceName.trim(),
        deviceType,
        ipAddress: deviceIp.trim() || undefined,
        location: deviceLocation.trim() || undefined,
        vendor: deviceVendor.trim() || undefined,
        model: deviceModel.trim() || undefined,
        firmwareVersion: deviceFirmware.trim() || undefined,
        idsIpsEnabled: true,
        passiveScanEnabled: true,
      })
      if (created === null) return handleUnauthorized()
      setDeviceName('')
      setDeviceType('router')
      setDeviceIp('')
      setDeviceLocation('Server Room')
      setDeviceVendor('')
      setDeviceModel('')
      setDeviceFirmware('')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to register network device')
    }
  }

  const onRunDevicePassive = async (id) => {
    setError('')
    await runBusyAction(`device-passive-${id}`, `Running passive scan for device #${id}...`, async () => {
      try {
        const result = await runDevicePassiveScan(id)
        if (result === null) return handleUnauthorized()
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to run passive scan')
      }
    })
  }

  const onRunDeviceIds = async (id) => {
    setError('')
    await runBusyAction(`device-ids-${id}`, `Running IDS/IPS check for device #${id}...`, async () => {
      try {
        const result = await runDeviceIdsIpsCheck(id)
        if (result === null) return handleUnauthorized()
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to run IDS/IPS check')
      }
    })
  }

  const onRegisterDatabase = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const created = await registerDatabaseAsset({
        name: dbName.trim(),
        engine: dbEngine,
        environment: dbEnvironment,
        host: dbHost.trim(),
        port: Number(dbPort) || undefined,
        ownerEmail: dbOwner.trim() || undefined,
        criticality: dbCriticality,
        patchLevel: dbPatchLevel.trim() || undefined,
        encryptionAtRest: dbEncryptionAtRest,
        tlsInTransit: dbTlsInTransit,
      })
      if (created === null) return handleUnauthorized()
      setDbName('')
      setDbEngine('postgresql')
      setDbEnvironment('on_prem')
      setDbHost('')
      setDbPort('5432')
      setDbOwner('')
      setDbCriticality('high')
      setDbPatchLevel('')
      setDbEncryptionAtRest(true)
      setDbTlsInTransit(true)
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to register database')
    }
  }

  const onRunDatabaseScan = async (id) => {
    setError('')
    await runBusyAction(`db-scan-${id}`, `Running security scan for database asset #${id}...`, async () => {
      try {
        const result = await runDatabaseSecurityScan(id)
        if (result === null) return handleUnauthorized()
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to run database security scan')
      }
    })
  }

  const patchAssetsByType = useMemo(() => ({
    application: securityApplications.map((asset) => ({ id: asset.id, name: asset.name, ownerEmail: asset.ownerEmail || '' })),
    network_device: (networkDevices || []).map((asset) => ({ id: asset.id, name: asset.name, ownerEmail: asset.ownerEmail || '' })),
    database_asset: (databaseOverview?.assets || []).map((asset) => ({ id: asset.id, name: asset.name, ownerEmail: asset.ownerEmail || '' })),
  }), [securityApplications, networkDevices, databaseOverview])

  const selectedPatchAssets = patchAssetsByType[patchAssetType] || []

  useEffect(() => {
    if (selectedPatchAssets.length === 0) {
      setPatchAssetId('')
      return
    }
    const currentExists = selectedPatchAssets.some((asset) => String(asset.id) === String(patchAssetId))
    if (!currentExists) {
      setPatchAssetId(String(selectedPatchAssets[0].id))
      setPatchOwnerEmail((prev) => prev || selectedPatchAssets[0].ownerEmail || '')
    }
  }, [selectedPatchAssets, patchAssetId])

  const onCreatePatchTask = async (e) => {
    e.preventDefault()
    setError('')
    await runBusyAction('create-patch-task', 'Creating patch task...', async () => {
      try {
        if (!patchAssetId) throw new Error('Select an asset before creating a patch task.')
        const created = await createPatchTask({
          assetType: patchAssetType,
          assetId: Number(patchAssetId),
          title: patchTitle.trim(),
          description: patchDescription.trim() || undefined,
          severity: patchSeverity,
          currentVersion: patchCurrentVersion.trim() || undefined,
          targetVersion: patchTargetVersion.trim() || undefined,
          ownerEmail: patchOwnerEmail.trim() || undefined,
          dueDate: patchDueDate ? new Date(patchDueDate).toISOString() : undefined,
        })
        if (created === null) return handleUnauthorized()
        setPatchTitle('')
        setPatchDescription('')
        setPatchSeverity('high')
        setPatchCurrentVersion('')
        setPatchTargetVersion('')
        setPatchDueDate('')
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to create patch task')
      }
    })
  }

  const onUpdatePatchStatus = async (taskId, status) => {
    setPatchActionId(taskId)
    setError('')
    await runBusyAction(`patch-status-${taskId}`, `Updating patch task #${taskId} to ${status}...`, async () => {
      try {
        const updated = await updatePatchTaskStatus(taskId, { status })
        if (updated === null) return handleUnauthorized()
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to update patch task status')
      } finally {
        setPatchActionId(null)
      }
    })
  }

  const onRunScan = async (mode) => {
    setError('')
    const modeLabel = mode === 'active' ? 'active' : 'passive'
    setScanMode(modeLabel)
    await runBusyAction(`scan-${modeLabel}`, `Running ${modeLabel} scan across monitored assets...`, async () => {
      try {
        const result = mode === 'active' ? await runActiveSecurityScan() : await runPassiveSecurityScan()
        if (result === null) return handleUnauthorized()
        if (result?.message) {
          setActivityMessage(result.message)
        }
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to run scan')
      } finally {
        setScanMode(null)
      }
    })
  }

  const onRunFortressRecoveryDrill = async () => {
    setError('')
    await runBusyAction('fortress-recovery-drill', 'Running fortress recovery drill and validating recovery readiness...', async () => {
      try {
        const result = await runFortressRecoveryDrill()
        if (result === null) return handleUnauthorized()
        setFortressDrillResult(result)
        await loadAll()
      } catch (err) {
        setError(err.message || 'Failed to run fortress recovery drill')
      }
    })
  }

  const onConfirmFinding = async (findingId) => {
    setFindingActionId(findingId)
    setError('')
    try {
      const updated = await confirmSecurityFinding(findingId)
      if (updated === null) return handleUnauthorized()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to confirm finding')
    } finally {
      setFindingActionId(null)
    }
  }

  const onCreateFindingTicket = async (findingId) => {
    setFindingActionId(findingId)
    setError('')
    try {
      const created = await createTicketFromFinding(findingId, { assigneeId: findingAssigneeMap[findingId] || null })
      if (created === null) return handleUnauthorized()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to create ticket from finding')
    } finally {
      setFindingActionId(null)
    }
  }

  const onUpdateFindingStatus = async (findingId, status) => {
    setFindingActionId(findingId)
    setError('')
    try {
      const updated = await updateFindingStatus(findingId, {
        status,
        reason: `Updated by ${displayedFullName} from dashboard workflow`,
      })
      if (updated === null) return handleUnauthorized()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to update finding status')
    } finally {
      setFindingActionId(null)
    }
  }

  const openTicketWorkspace = async (ticket) => {
    setSelectedTicket(ticket)
    setHistoryItems([])
    setResolutionReport(null)
    setTicketComments([])
    setTicketActionItems([])
    try {
      const [history, report, comments, actions] = await Promise.all([
        fetchTicketHistory(ticket.id),
        fetchTicketResolutionReport(ticket.id),
        fetchTicketComments(ticket.id),
        fetchTicketActionItems(ticket.id),
      ])
      if ([history, report, comments, actions].some((v) => v === null)) return handleUnauthorized()
      setHistoryItems(history)
      setResolutionReport(report)
      setTicketComments(Array.isArray(comments) ? comments : [])
      setTicketActionItems(Array.isArray(actions) ? actions : [])
    } catch (err) {
      setError(err.message || 'Failed to load ticket details')
    }
  }

  const refreshSelectedWorkspace = async () => {
    if (!selectedTicket) return
    await openTicketWorkspace(selectedTicket)
  }

  const onAddComment = async (e) => {
    e.preventDefault()
    if (!selectedTicket) return
    setError('')
    try {
      const added = await addTicketComment(selectedTicket.id, {
        message: commentDraft.trim(),
        visibility: commentVisibility,
      })
      if (added === null) return handleUnauthorized()
      setCommentDraft('')
      await refreshSelectedWorkspace()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to add collaboration note')
    }
  }

  const onAddActionItem = async (e) => {
    e.preventDefault()
    if (!selectedTicket) return
    setError('')
    try {
      const created = await createTicketActionItem(selectedTicket.id, {
        title: actionTitle.trim(),
        ownerScjId: actionOwnerScjId || undefined,
        dueAt: actionDueAt || undefined,
      })
      if (created === null) return handleUnauthorized()
      setActionTitle('')
      setActionOwnerScjId('')
      setActionDueAt('')
      await refreshSelectedWorkspace()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to create action item')
    }
  }

  const onSetActionItemStatus = async (actionItem, status) => {
    if (!selectedTicket) return
    setError('')
    try {
      const updated = await updateTicketActionItem(selectedTicket.id, actionItem.id, { status })
      if (updated === null) return handleUnauthorized()
      await refreshSelectedWorkspace()
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to update action item')
    }
  }

  const onGenerateAssistant = async (e) => {
    e.preventDefault()
    setError('')
    setAssistantOutput(null)
    try {
      const result = await generateAssistantTriage({
        title: assistantTitle.trim(),
        description: assistantDescription.trim(),
        priority: assistantPriority,
        businessImpactScore: Number(assistantImpact),
      })
      if (result === null) return handleUnauthorized()
      setAssistantOutput(result)
    } catch (err) {
      setError(err.message || 'Failed to generate AI triage guidance')
    }
  }

  const onAnalyzeTicketWithAssistant = async (ticketId) => {
    setError('')
    try {
      const result = await analyzeAssistantTicket({
        ticketId,
        notes: assistantNote.trim() || undefined,
      })
      if (result === null) return handleUnauthorized()
      setAssistantTicketOutput(result)
      setAssistantAlertOutput(null)
      setAssistantSidecarOpen(true)
      setActiveTab('assistant')
    } catch (err) {
      setError(err.message || 'Failed to analyze ticket with AI assistant')
    }
  }

  const onAnalyzeAlertWithAssistant = async (findingId) => {
    setError('')
    try {
      const result = await analyzeAssistantAlert({ findingId })
      if (result === null) return handleUnauthorized()
      setAssistantAlertOutput(result)
      setAssistantTicketOutput(null)
      setAssistantSidecarOpen(true)
      setActiveTab('assistant')
    } catch (err) {
      setError(err.message || 'Failed to analyze alert with AI assistant')
    }
  }

  const onTendTicketWithAssistant = async (ticketId) => {
    setError('')
    setAssistantQuickBusy(true)
    try {
      const result = await tendAssistantTicket({
        ticketId,
        notes: assistantNote.trim() || undefined,
      })
      if (result === null) return handleUnauthorized()
      setAssistantTicketOutput(result)
      setAssistantAlertOutput(null)
      setAssistantSidecarOpen(true)
      setActiveTab('assistant')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to auto-tend ticket with AI assistant')
    } finally {
      setAssistantQuickBusy(false)
    }
  }

  const onTendAlertWithAssistant = async (findingId, assignee = '') => {
    setError('')
    setAssistantQuickBusy(true)
    try {
      const result = await tendAssistantAlert({
        findingId,
        assigneeId: assignee || undefined,
      })
      if (result === null) return handleUnauthorized()
      setAssistantAlertOutput(result)
      setAssistantTicketOutput(null)
      setAssistantSidecarOpen(true)
      setActiveTab('assistant')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Failed to auto-tend alert with AI assistant')
    } finally {
      setAssistantQuickBusy(false)
    }
  }

  const onQuickAnalyzeTicket = async () => {
    if (!assistantQuickTicketId) return
    setAssistantQuickBusy(true)
    setError('')
    try {
      const result = await analyzeAssistantTicket({
        ticketId: Number(assistantQuickTicketId),
        notes: assistantNote.trim() || undefined,
      })
      if (result === null) return handleUnauthorized()
      setAssistantTicketOutput(result)
      setAssistantAlertOutput(null)
    } catch (err) {
      setError(err.message || 'Failed to analyze selected ticket')
    } finally {
      setAssistantQuickBusy(false)
    }
  }

  const onQuickAnalyzeAlert = async () => {
    if (!assistantQuickAlertId) return
    setAssistantQuickBusy(true)
    setError('')
    try {
      const result = await analyzeAssistantAlert({ findingId: Number(assistantQuickAlertId) })
      if (result === null) return handleUnauthorized()
      setAssistantAlertOutput(result)
      setAssistantTicketOutput(null)
    } catch (err) {
      setError(err.message || 'Failed to analyze selected alert')
    } finally {
      setAssistantQuickBusy(false)
    }
  }

  const severityRank = (severity) => {
    if (severity === 'critical') return 4
    if (severity === 'high') return 3
    if (severity === 'medium') return 2
    if (severity === 'low') return 1
    return 0
  }

  const networkFindings = useMemo(
    () => securityFindings
      .filter((f) => ['network', 'intrusion', 'availability'].includes(f.category))
      .sort((a, b) => {
        const sev = severityRank(b.severity) - severityRank(a.severity)
        if (sev !== 0) return sev
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      }),
    [securityFindings],
  )

  const applicationTileData = useMemo(() => {
    return securityApplications.map((app) => {
      const findings = securityFindings.filter(
        (f) => f.applicationAssetId === app.id || f.application?.id === app.id,
      )
      const activeFindings = findings.filter((f) => ['new', 'investigating'].includes(f.status))
      const criticalFindings = findings.filter((f) => f.severity === 'critical')
      const highFindings = findings.filter((f) => f.severity === 'high')
      const linkedTicketIds = [...new Set(findings.map((f) => f.ticketId).filter(Boolean))]
      const linkedOpenTickets = tickets.filter((t) => linkedTicketIds.includes(t.id) && ['open', 'in_progress'].includes(t.status))
      const riskScore = Math.min(100, (criticalFindings.length * 25) + (highFindings.length * 12) + (activeFindings.length * 8) + (app.healthStatus === 'critical' ? 18 : app.healthStatus === 'degraded' ? 9 : 0))

      const suggestions = []
      if (app.healthStatus === 'critical') suggestions.push('Execute critical-incident playbook now and assign a dedicated incident commander.')
      if (app.healthStatus === 'degraded') suggestions.push('Stabilize service performance and add short-cycle monitoring alerts for early degradation detection.')
      if (!app.ownerEmail) suggestions.push('Assign a technical owner email to enforce accountability and escalation readiness.')
      if (criticalFindings.length > 0) suggestions.push('Prioritize patching or compensating controls for critical findings within a 24-hour SLA.')
      if (activeFindings.length > 0 && linkedOpenTickets.length === 0) suggestions.push('Create and assign remediation tickets for unresolved findings to ensure tracked closure.')
      if (!app.lastActiveScanAt) suggestions.push('Run an active security scan and schedule recurring validation for this application.')
      if (!app.lastPassiveScanAt) suggestions.push('Enable passive telemetry collection to improve continuous detection coverage.')
      if (suggestions.length === 0) suggestions.push('Maintain current controls and continue weekly verification scans and access reviews.')

      return {
        app,
        findingsCount: findings.length,
        activeFindingsCount: activeFindings.length,
        criticalFindingsCount: criticalFindings.length,
        highFindingsCount: highFindings.length,
        linkedTicketCount: linkedTicketIds.length,
        openLinkedTicketCount: linkedOpenTickets.length,
        riskScore,
        suggestions,
      }
    }).sort((a, b) => b.riskScore - a.riskScore)
  }, [securityApplications, securityFindings, tickets])

  const sortedNetworkDevices = useMemo(
    () => [...networkDevices].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)),
    [networkDevices],
  )

  const sortedDatabaseAssets = useMemo(
    () => [...(databaseOverview?.assets || [])].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)),
    [databaseOverview],
  )

  const patchGroups = useMemo(() => {
    const empty = {
      application: { todo: [], in_progress: [], completed: [] },
      network_device: { todo: [], in_progress: [], completed: [] },
      database_asset: { todo: [], in_progress: [], completed: [] },
    }
    const grouped = patchOverview?.grouped || empty
    return {
      application: {
        todo: grouped.application?.todo || [],
        in_progress: grouped.application?.in_progress || [],
        completed: grouped.application?.completed || [],
      },
      network_device: {
        todo: grouped.network_device?.todo || [],
        in_progress: grouped.network_device?.in_progress || [],
        completed: grouped.network_device?.completed || [],
      },
      database_asset: {
        todo: grouped.database_asset?.todo || [],
        in_progress: grouped.database_asset?.in_progress || [],
        completed: grouped.database_asset?.completed || [],
      },
    }
  }, [patchOverview])

  const getPatchLaneKey = (assetType, statusKey) => `${assetType}:${statusKey}`

  const getOrderedPatchTasks = (assetType, statusKey) => {
    const laneKey = getPatchLaneKey(assetType, statusKey)
    const laneTasks = patchGroups[assetType][statusKey]
    const order = patchLaneOrder[laneKey] || []
    const byId = new Map(laneTasks.map((task) => [task.id, task]))
    const ordered = order
      .map((taskId) => byId.get(taskId))
      .filter(Boolean)
    const remaining = laneTasks.filter((task) => !order.includes(task.id))
    return [...ordered, ...remaining]
  }

  useEffect(() => {
    const laneEntries = [
      ['application', 'todo'],
      ['application', 'in_progress'],
      ['application', 'completed'],
      ['network_device', 'todo'],
      ['network_device', 'in_progress'],
      ['network_device', 'completed'],
      ['database_asset', 'todo'],
      ['database_asset', 'in_progress'],
      ['database_asset', 'completed'],
    ]

    setPatchLaneOrder((current) => {
      const next = { ...current }

      for (const [assetType, statusKey] of laneEntries) {
        const laneKey = getPatchLaneKey(assetType, statusKey)
        const laneTaskIds = patchGroups[assetType][statusKey].map((task) => task.id)
        const existing = current[laneKey] || []
        const existingSet = new Set(existing)
        const laneSet = new Set(laneTaskIds)
        const pruned = existing.filter((taskId) => laneSet.has(taskId))
        const missing = laneTaskIds.filter((taskId) => !existingSet.has(taskId))
        next[laneKey] = [...pruned, ...missing]
      }

      return next
    })
  }, [patchGroups])

  const onPatchCardDragStart = (event, laneKey, taskId) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', JSON.stringify({ laneKey, taskId }))
    setPatchDragState({ sourceLaneKey: laneKey, sourceTaskId: taskId, overLaneKey: laneKey, overTaskId: taskId })
  }

  const onPatchCardDragOver = (event, laneKey, taskId) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setPatchDragState((current) => ({
      ...current,
      overLaneKey: laneKey,
      overTaskId: taskId,
    }))
  }

  const onPatchCardDrop = (event, laneKey, targetTaskId = null) => {
    event.preventDefault()

    let payload = null
    try {
      payload = JSON.parse(event.dataTransfer.getData('text/plain') || '{}')
    } catch {
      payload = null
    }

    if (!payload || !payload.laneKey || !payload.taskId) {
      setPatchDragState({ sourceLaneKey: '', sourceTaskId: null, overLaneKey: '', overTaskId: null })
      return
    }

    if (payload.laneKey !== laneKey) {
      setPatchDragState({ sourceLaneKey: '', sourceTaskId: null, overLaneKey: '', overTaskId: null })
      return
    }

    const sourceTaskId = payload.taskId
    setPatchLaneOrder((current) => {
      const laneOrder = [...(current[laneKey] || [])]
      const sourceIndex = laneOrder.indexOf(sourceTaskId)
      if (sourceIndex === -1) return current

      laneOrder.splice(sourceIndex, 1)
      const targetIndex = targetTaskId == null ? laneOrder.length : laneOrder.indexOf(targetTaskId)
      const insertAt = targetIndex === -1 ? laneOrder.length : targetIndex
      laneOrder.splice(insertAt, 0, sourceTaskId)

      return {
        ...current,
        [laneKey]: laneOrder,
      }
    })

    setPatchDragState({ sourceLaneKey: '', sourceTaskId: null, overLaneKey: '', overTaskId: null })
  }

  const onPatchCardDragEnd = () => {
    setPatchDragState({ sourceLaneKey: '', sourceTaskId: null, overLaneKey: '', overTaskId: null })
  }

  const togglePatchCardFlip = (taskId) => {
    setFlippedPatchCards((current) => ({ ...current, [taskId]: !current[taskId] }))
  }

  const formatPatch5W1H = (task) => {
    const completedAt = task.completedAt || task.updatedAt || task.closedAt || null
    const createdAt = task.createdAt || null
    const how = []
    if (task.currentVersion || task.targetVersion) {
      how.push(`Version uplift: ${task.currentVersion || 'unknown'} -> ${task.targetVersion || 'target pending'}`)
    }
    how.push(`Status moved to completed in patch lane workflow`)
    return {
      what: task.title || 'Patch task completed',
      why: task.description || `Severity ${task.severity || 'medium'} remediation requirement`,
      who: task.ownerEmail || 'Unassigned owner at completion',
      when: completedAt ? new Date(completedAt).toLocaleString() : 'Completion timestamp not available',
      where: `${task.assetType || 'asset'}: ${task.assetName || 'Unknown asset'}`,
      how: how.join(' | '),
      started: createdAt ? new Date(createdAt).toLocaleString() : 'Creation timestamp not available',
      due: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date recorded',
    }
  }

  const intrusionRows = useMemo(
    () => (showAllIntrusions ? networkFindings : networkFindings.slice(0, 5)),
    [networkFindings, showAllIntrusions],
  )

  const dataQuality = useMemo(() => {
    const sensors = networkVisibilityOverview?.sensors || []
    const staleSensors = sensors.filter((s) => {
      if (!s.lastSeenAt) return true
      return (Date.now() - new Date(s.lastSeenAt).getTime()) > (15 * 60 * 1000)
    }).length

    const missingOwners = (applicationTileData.filter((t) => !t.app.ownerEmail).length)
      + (sortedNetworkDevices.filter((d) => !d.ownerEmail).length)
      + (sortedDatabaseAssets.filter((d) => !d.ownerEmail).length)

    const coverageScore = Math.max(0, 100 - (staleSensors * 12) - (missingOwners * 6))
    const confidence = coverageScore >= 80 ? 'High' : coverageScore >= 60 ? 'Medium' : 'Low'
    return { staleSensors, missingOwners, coverageScore, confidence }
  }, [networkVisibilityOverview, applicationTileData, sortedNetworkDevices, sortedDatabaseAssets])

  const topPriorityAction = useMemo(() => {
    if ((executiveImpact?.criticalFindings || 0) > 0) return 'Contain active critical threats and assign incident commander now.'
    if ((executiveMetrics?.slaBreached || 0) > 0) return 'Recover breached incident SLAs and escalate blocked actions.'
    if ((databaseOverview?.summary?.degraded || 0) > 0) return 'Prioritize degraded database hardening and patch validation.'
    return 'Maintain monitoring cadence and complete preventive hunt playbook tasks.'
  }, [executiveImpact, executiveMetrics, databaseOverview])

  const tabInsight = useMemo(() => {
    if (activeTab === 'network') {
      return {
        delta: `Potential attacks detected: ${networkVisibilityOverview?.summary?.activeThreats || 0}`,
        driver: `Main risk driver: ${(networkVisibilityOverview?.summary?.criticalThreats || 0) > 0 ? 'Critical network threat signals' : 'Service stability anomalies and exposure signals'}`,
        next: 'Next action: Validate top 3 intrusion signals and assign owners for unresolved alerts.',
      }
    }
    if (activeTab === 'connected-devices') {
      return {
        delta: `Highest device risk score: ${sortedNetworkDevices[0]?.riskScore || 0}`,
        driver: `Main risk driver: ${sortedNetworkDevices[0]?.name ? `${sortedNetworkDevices[0].name} requires attention` : 'No device risk outliers detected'}`,
        next: 'Next action: Run passive and IDS/IPS checks on highest-risk devices first.',
      }
    }
    if (activeTab === 'database-monitor') {
      return {
        delta: `Critical database assets: ${databaseOverview?.summary?.critical || 0}`,
        driver: `Main risk driver: average database risk ${databaseOverview?.summary?.avgRisk || 0}`,
        next: 'Next action: Close patch and encryption gaps for degraded database assets.',
      }
    }
    if (activeTab === 'threat-intel') {
      return {
        delta: `High-value unresolved threats: ${threatIntelOverview?.summary?.bountyCandidates || 0}`,
        driver: 'Main risk driver: unresolved high-severity threat indicators.',
        next: 'Next action: Convert top unresolved threats into owned investigation tasks.',
      }
    }
    return {
      delta: `Active incidents: ${tickets.filter((t) => ['open', 'in_progress'].includes(t.status)).length}`,
      driver: 'Main risk driver: open incidents and unresolved findings.',
      next: 'Next action: Focus on critical incidents and blocked remediation tasks.',
    }
  }, [activeTab, networkVisibilityOverview, sortedNetworkDevices, databaseOverview, threatIntelOverview, tickets])

  const trendWords = useMemo(() => {
    const riskTrend = (executiveImpact?.riskIndex || 0) >= 45 ? 'Rising risk trend' : 'Stable risk trend'
    const criticalTrend = (executiveImpact?.criticalTickets || 0) > 0 ? 'Escalating critical load' : 'Critical load contained'
    const confidenceTrend = dataQuality.coverageScore < 70 ? 'Coverage declining' : 'Coverage stable'
    const refreshTrend = lastRefreshAt ? 'Fresh data window' : 'Awaiting first refresh'
    return { riskTrend, criticalTrend, confidenceTrend, refreshTrend }
  }, [executiveImpact, dataQuality, lastRefreshAt])

  const highPriorityTickets = useMemo(
    () => tickets
      .filter((t) => ['open', 'in_progress'].includes(t.status))
      .sort((a, b) => {
        const sev = severityRank(b.priority) - severityRank(a.priority)
        if (sev !== 0) return sev
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      })
      .slice(0, 8),
    [tickets],
  )

  const highPriorityAlerts = useMemo(
    () => networkFindings
      .filter((f) => ['new', 'investigating'].includes(f.status))
      .slice(0, 8),
    [networkFindings],
  )

  const criticalAlertCount = useMemo(
    () => securityFindings.filter((f) => f.severity === 'critical' && ['new', 'investigating'].includes(f.status)).length,
    [securityFindings],
  )

  const highAlertCount = useMemo(
    () => securityFindings.filter((f) => f.severity === 'high' && ['new', 'investigating'].includes(f.status)).length,
    [securityFindings],
  )

  const filteredHealthApplications = useMemo(
    () => (healthViewFilter === 'urgent'
      ? securityApplications.filter((app) => ['critical', 'degraded'].includes(app.healthStatus))
      : securityApplications),
    [securityApplications, healthViewFilter],
  )

  const filteredHealthDevices = useMemo(
    () => (healthViewFilter === 'urgent'
      ? sortedNetworkDevices.filter((device) => device.state === 'degraded' || (device.riskScore || 0) >= 75)
      : sortedNetworkDevices),
    [sortedNetworkDevices, healthViewFilter],
  )

  const filteredHealthDatabases = useMemo(
    () => (healthViewFilter === 'urgent'
      ? sortedDatabaseAssets.filter((db) => db.state === 'degraded' || (db.riskScore || 0) >= 75)
      : sortedDatabaseAssets),
    [sortedDatabaseAssets, healthViewFilter],
  )

  useEffect(() => {
    if (previousCriticalCountRef.current === null) {
      previousCriticalCountRef.current = criticalAlertCount
      return
    }

    if (criticalAlertCount > previousCriticalCountRef.current) {
      setCriticalPulse(true)
      const timer = setTimeout(() => setCriticalPulse(false), 900)
      previousCriticalCountRef.current = criticalAlertCount
      return () => clearTimeout(timer)
    }

    previousCriticalCountRef.current = criticalAlertCount
  }, [criticalAlertCount])

  const openActionItems = ticketActionItems.filter((item) => item.status !== 'done')

  const userFocusDomain = useMemo(() => {
    const text = `${currentUser?.department || ''} ${currentUser?.jobTitle || ''}`.toLowerCase()
    if (/network|soc|infra/.test(text)) return 'network'
    if (/dev|application|software|backend|frontend|api/.test(text)) return 'application'
    if (/hardware|endpoint|device|field/.test(text)) return 'hardware'
    if (/database|dba|data/.test(text)) return 'database'
    return 'general'
  }, [currentUser?.department, currentUser?.jobTitle])

  const focusTickets = useMemo(() => {
    const pattern = userFocusDomain === 'network'
      ? /network|switch|router|dns|latency|firewall|vpn/i
      : userFocusDomain === 'application'
        ? /app|api|service|frontend|backend|deploy|code/i
        : userFocusDomain === 'hardware'
          ? /device|endpoint|server|hardware|firmware|disk|cpu/i
          : userFocusDomain === 'database'
            ? /database|sql|schema|backup|query|postgres|mysql/i
            : /.+/

    return tickets
      .filter((t) => ['open', 'in_progress'].includes(t.status))
      .filter((t) => pattern.test(`${t.title || ''} ${t.description || ''}`))
      .slice(0, 6)
  }, [tickets, userFocusDomain])

  const governanceSummary = useMemo(() => {
    const rows = Array.isArray(auditLogs) ? auditLogs : []
    const actionsByType = rows.reduce((acc, row) => {
      const key = row.action || 'unknown'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const entitiesByType = rows.reduce((acc, row) => {
      const key = row.entityType || 'unknown'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const topActions = Object.entries(actionsByType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const topEntities = Object.entries(entitiesByType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    return {
      total: rows.length,
      lastEventAt: rows[0]?.createdAt || null,
      topActions,
      topEntities,
      privilegedActions: rows.filter((r) => (r.actorRole || '').toLowerCase() === 'admin').length,
    }
  }, [auditLogs])

  const tabs = useMemo(() => {
    if (isAdmin) {
      return [
        ['board-snapshot', 'Command Centre'],
        ['health', 'Health Check'],
        ['applications', 'Applications Monitored'],
        ['threat-intel', 'Threat Intel API'],
        ['network', 'Network Monitored'],
        ['connected-devices', 'Connected Devices'],
        ['database-monitor', 'Database Infra Monitor'],
        ['patch-management', 'Patch Management'],
        ['tickets', 'Incident Workspace'],
        ['governance', 'Governance & Audit'],
        ['assistant', 'AI Analyst Assist'],
      ]
    }

    return [
      ['health', 'Health Check'],
      ['applications', 'Applications Monitored'],
      ['network', 'Network Monitored'],
      ['connected-devices', 'Connected Devices'],
      ['database-monitor', 'Database Infra Monitor'],
      ['patch-management', 'Patch Management'],
    ]
  }, [isAdmin])

  const allowedTabIds = useMemo(() => {
    const ids = tabs.map(([id]) => id)
    if (isAdmin) ids.push('staff')
    return ids
  }, [tabs, isAdmin])

  useEffect(() => {
    if (!allowedTabIds.includes(activeTab)) {
      setActiveTab(tabs[0][0])
    }
  }, [tabs, allowedTabIds, activeTab])

  const tabHelp = useMemo(() => ({
    'board-snapshot': 'Use this as the all-in-one executive pulse. It summarizes current exposure and where to act first.',
    health: 'Every tile shows posture at a glance. Look for state, risk score, and latest runtime/check timestamps to detect outages quickly.',
    applications: 'Each application tile combines risk and ownership. Prioritize unresolved high-risk apps and assign owners if missing.',
    'threat-intel': 'This view highlights probable attacker behavior and hunt opportunities. Start with highest opportunity score.',
    network: 'Network view explains sensor coverage, active threats, and per-application network signals.',
    'connected-devices': 'Use this for infrastructure hygiene. Register devices, run scans, and watch risk drift over time.',
    'database-monitor': 'Track database security posture, patch state, and crypto controls. Work top-down by risk.',
    'patch-management': 'Track planned, active, and completed patch operations by asset class with clear ownership and due dates.',
    staff: 'Register staff members so ownership and notifications are accurate during incidents.',
    tickets: 'Incident workspace for lifecycle, collaboration notes, and accountable action items.',
    governance: 'Governance explains operational control effectiveness and auditability, not only raw logs.',
    assistant: 'AI Assistant helps triage and analysis. Use it to accelerate assigned incident handling.',
  }), [])

  const moveSituationToCorner = (corner) => {
    const width = window.innerWidth <= 1100 ? 260 : 280
    const height = window.innerWidth <= 1100 ? 140 : 120
    const leftX = 8
    const rightX = Math.max(8, window.innerWidth - width - 8)
    const topY = 8
    const bottomY = Math.max(8, window.innerHeight - height - 8)

    if (corner === 'top-left') {
      setSituationPosition({ x: leftX, y: topY })
      return
    }
    if (corner === 'top-right') {
      setSituationPosition({ x: rightX, y: topY })
      return
    }
    if (corner === 'bottom-left') {
      setSituationPosition({ x: leftX, y: bottomY })
      return
    }
    setSituationPosition({ x: rightX, y: bottomY })
  }

  return (
    <div className={`app-shell ${!isLoggedIn ? 'no-sidebar' : ''}`}>
      {isLoggedIn && (
        <aside className="sidebar">
          <h1 className="brand">Cybersecurity Command Centre Dashboad</h1>
          <nav>
            {tabs.map(([id, label]) => (
              <button
                key={id}
                className={`nav-btn ${activeTab === id ? 'active' : ''}`}
                onClick={() => setActiveTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className={`role-chip role-${currentRole}`}>{currentRole}</span>
          </div>
        </aside>
      )}

      <main className={`workspace ${assistantSidecarOpen ? 'workspace-with-sidecar' : ''} ${!isLoggedIn ? 'workspace-login' : ''}`}>
        {isLoggedIn && (
          <nav className="top-nav-bar">
            <div className="top-nav-left">
              {isAdmin && (
                <button
                  className={`top-nav-link ${activeTab === 'staff' ? 'active' : ''}`}
                  title="Register or manage CCC staff"
                  onClick={() => setActiveTab('staff')}
                >
                  CCC Staff
                </button>
              )}
              <button
                className="top-nav-icon settings-icon"
                title="Settings"
                onClick={() => setSettingsPanelOpen(!settingsPanelOpen)}
              >
                ⚙️
              </button>
              <button
                className="top-nav-icon audit-icon"
                title="Audit Logs"
                onClick={() => setAuditPanelOpen(!auditPanelOpen)}
              >
                📋
              </button>
              <button
                className="top-nav-icon fortress-icon"
                title="Fortress Dashboard"
                onClick={() => setFortressPanelOpen(!fortressPanelOpen)}
              >
                🛡️
              </button>
              <button
                className="top-nav-link logout-top-btn"
                title="Sign out"
                onClick={() => onLogout()}
              >
                Logout
              </button>
            </div>
            <div className="top-nav-right">
              <div className="user-info">
                <div className="user-details">
                  <span className="user-name">{displayedFullName}</span>
                  <span className="user-title">{displayedJobTitle}</span>
                </div>
                <div className="current-datetime">
                  {currentDateTime.toLocaleDateString()} {currentDateTime.toLocaleTimeString()}
                </div>
              </div>
            </div>
          </nav>
        )}

        <SettingsPanel
          isOpen={settingsPanelOpen}
          onClose={() => setSettingsPanelOpen(false)}
          currentUser={currentUser}
          currentRole={currentRole}
          userTheme={userTheme}
          onThemeChange={handleThemeChange}
          userNotifications={userNotifications}
          onNotificationToggle={handleNotificationToggle}
          isLoggedIn={isLoggedIn}
          mfaEnabled={Boolean(currentUser?.mfaEnabled)}
          mfaSetupSecret={mfaSetupSecret}
          mfaSetupUri={mfaSetupUri}
          mfaManageCode={mfaManageCode}
          onMfaManageCodeChange={setMfaManageCode}
          onSetupMfa={onSetupMfa}
          onEnableMfa={onEnableMfa}
          onDisableMfa={onDisableMfa}
        />

        <AuditPanel
          isOpen={auditPanelOpen}
          onClose={() => setAuditPanelOpen(false)}
          logs={Array.isArray(auditLogs) ? auditLogs.slice(0, 100) : []}
          filterCategory={auditLogFilter}
          onFilterChange={setAuditLogFilter}
          searchTerm={auditLogSearchTerm}
          onSearchChange={setAuditLogSearchTerm}
          isLoggedIn={isLoggedIn}
        />

        <FortressPanel
          isOpen={fortressPanelOpen}
          onClose={() => setFortressPanelOpen(false)}
          isLoggedIn={isLoggedIn}
          lastRefreshAt={lastRefreshAt}
          fortressPosture={fortressPosture}
          securitySummary={securitySummary}
          executiveImpact={executiveImpact}
          threatIntelOverview={threatIntelOverview}
          networkVisibilityOverview={networkVisibilityOverview}
          patchOverview={patchOverview}
          securityFindings={Array.isArray(securityFindings) ? securityFindings : []}
          networkDevices={Array.isArray(networkDevices) ? networkDevices : []}
          databaseOverview={databaseOverview}
          onRunPassiveScan={() => onRunScan('passive')}
          onRunActiveScan={() => onRunScan('active')}
          onRunRecoveryDrill={onRunFortressRecoveryDrill}
          isPassiveScanBusy={isActionBusy('scan-passive')}
          isActiveScanBusy={isActionBusy('scan-active')}
          isRecoveryDrillBusy={isActionBusy('fortress-recovery-drill')}
          onUpdatePatchStatus={onUpdatePatchStatus}
          patchActionId={patchActionId}
          recoveryDrillResult={fortressDrillResult}
        />

        {error && <div className="error-banner">{error}</div>}
        {hasBusyActions && (
          <div className={`activity-banner ${scanMode ? 'scan-live' : ''}`} role="status" aria-live="polite">
            <span className="activity-spinner" aria-hidden="true" />
            <span>
              {scanMode
                ? `Running ${scanMode} scan. Asset checks are in progress...`
                : (activityMessage || 'Working on your request...')}
            </span>
          </div>
        )}

        {!isLoggedIn ? (
          <div className="login-shell">
            <div className="login-welcome">
              <h1 className="login-title">Welcome</h1>
              <p className="login-subtitle">{APP_NAME}</p>
              <p className="login-intro">Security operations, incident response, and asset visibility in one command centre.</p>
            </div>
            {authMessage && <div className="auth-success">{authMessage}</div>}
            {authMode === 'login' && (
              <form onSubmit={onLogin} className="ticket-form ticket-form-login">
                <h2>Login</h2>
                <FieldWithHint help="Use your CCC username. This identifies your role and determines which operational views you can access.">
                  <input value={username} placeholder="Username" onChange={(e) => setUsername(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="Enter your CCC password. Authentication is required before the dashboard can pull tickets, health, and audit data.">
                  <input type="password" value={password} placeholder="Password" onChange={(e) => setPassword(e.target.value)} required />
                </FieldWithHint>
                {mfaRequired && (
                  <FieldWithHint help="Enter the current 6-digit code from your authenticator app.">
                    <input
                      value={mfaCode}
                      placeholder="MFA code"
                      onChange={(e) => setMfaCode(e.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]{6,8}"
                      required
                    />
                  </FieldWithHint>
                )}
                <button type="submit">{mfaRequired ? 'Verify MFA & Login' : 'Login'}</button>
                <div className="auth-links">
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('forgot-username')}>Forgot Username</button>
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('forgot-password-request')}>Forgot Password</button>
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('create-account')}>Create Account</button>
                </div>
              </form>
            )}

            {authMode === 'create-account' && (
              <form onSubmit={onCreateAccount} className="ticket-form ticket-form-login">
                <h2>Create Account</h2>
                <FieldWithHint help="Enter your legal first name. Your username is generated from your name and surname.">
                  <input value={registerName} placeholder="First Name" onChange={(e) => setRegisterName(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="Enter your legal surname. The system derives your username as name plus surname.">
                  <input value={registerSurname} placeholder="Surname" onChange={(e) => setRegisterSurname(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help={`SCJ ID is required and must follow the format ${SCJ_ID_EXAMPLE}.`}>
                  <input value={registerScjId} placeholder={`SCJ ID (${SCJ_ID_EXAMPLE})`} onChange={(e) => setRegisterScjId(e.target.value)} pattern="[0-9]{8}-[0-9]{5}" required />
                </FieldWithHint>
                <FieldWithHint help={`Email is mandatory and must use the ${NHNE_EMAIL_DOMAIN} domain.`}>
                  <input type="email" value={registerEmail} placeholder={`Email (${NHNE_EMAIL_DOMAIN})`} onChange={(e) => setRegisterEmail(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="Password must be at least 12 characters and include uppercase, lowercase, number, and special character.">
                  <input type="password" value={registerPassword} placeholder="Password" onChange={(e) => setRegisterPassword(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="Re-enter password to confirm.">
                  <input type="password" value={registerPasswordConfirm} placeholder="Confirm Password" onChange={(e) => setRegisterPasswordConfirm(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="This is the enforced login username generated from the supplied name and surname.">
                  <input value={derivedRegisterUsername} placeholder="Derived Username" readOnly />
                </FieldWithHint>
                <button type="submit">Create Account</button>
                <div className="auth-links">
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('login')}>Back to Login</button>
                </div>
              </form>
            )}

            {authMode === 'forgot-username' && (
              <form onSubmit={onForgotUsername} className="ticket-form ticket-form-login">
                <h2>Forgot Username</h2>
                <FieldWithHint help="Enter the email linked to your account to recover your username.">
                  <input type="email" value={forgotUsernameEmail} placeholder="Email" onChange={(e) => setForgotUsernameEmail(e.target.value)} required />
                </FieldWithHint>
                <button type="submit">Recover Username</button>
                <div className="auth-links">
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('login')}>Back to Login</button>
                </div>
              </form>
            )}

            {authMode === 'forgot-password-request' && (
              <form onSubmit={onRequestPasswordReset} className="ticket-form ticket-form-login">
                <h2>Forgot Password</h2>
                <FieldWithHint help="Enter the email linked to your account. For security, password reset is email-only.">
                  <input type="email" value={resetIdentifier} placeholder="Email" onChange={(e) => setResetIdentifier(e.target.value)} required />
                </FieldWithHint>
                <button type="submit">Request Reset Code</button>
                <div className="auth-links">
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('reset-password')}>Already have a code?</button>
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('login')}>Back to Login</button>
                </div>
              </form>
            )}

            {authMode === 'reset-password' && (
              <form onSubmit={onResetPassword} className="ticket-form ticket-form-login">
                <h2>Reset Password</h2>
                <FieldWithHint help="Use the same email address used for reset request.">
                  <input type="email" value={resetIdentifier} placeholder="Email" onChange={(e) => setResetIdentifier(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="Enter the reset code that was issued.">
                  <input value={resetCode} placeholder="Reset Code" onChange={(e) => setResetCode(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="Set your new password.">
                  <input type="password" value={resetNewPassword} placeholder="New Password" onChange={(e) => setResetNewPassword(e.target.value)} required />
                </FieldWithHint>
                <FieldWithHint help="Re-enter the new password to confirm.">
                  <input type="password" value={resetConfirmPassword} placeholder="Confirm New Password" onChange={(e) => setResetConfirmPassword(e.target.value)} required />
                </FieldWithHint>
                <button type="submit">Reset Password</button>
                <div className="auth-links">
                  <button type="button" className="text-btn" onClick={() => switchAuthMode('login')}>Back to Login</button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <>
            <button className="ai-sidecar-launcher" onClick={() => setAssistantSidecarOpen((prev) => !prev)}>
              {assistantSidecarOpen ? 'Hide AI Copilot' : 'Open AI Copilot'}
            </button>

            <aside className={`ai-sidecar ${assistantSidecarOpen ? 'open' : ''}`}>
              <div className="ai-sidecar-header">
                <h3>AI Command Copilot</h3>
                <button className="ghost-btn tiny-btn" onClick={() => setAssistantSidecarOpen(false)}>Close</button>
              </div>
              <p className="muted-copy">Live assistant for alerts, assigned tickets, and next-best actions.</p>

              <div className="ai-sidecar-section">
                <strong>Command Snapshot</strong>
                <div className="ai-sidecar-kpis">
                  <span>Open Tickets <strong>{assistantCommand?.summary?.openTickets || 0}</strong></span>
                  <span>Active Alerts <strong>{assistantCommand?.summary?.activeFindings || 0}</strong></span>
                  <span>Assigned to You <strong>{assistantCommand?.summary?.assignedOpenTickets || 0}</strong></span>
                  <span>Blocked Actions <strong>{assistantCommand?.summary?.blockedActions || 0}</strong></span>
                </div>
                <p><strong>Priority:</strong> {assistantCommand?.priorityAction || topPriorityAction}</p>
                <p><strong>Incident Pressure:</strong> {assistantCommand?.fortressContext?.incidentPressureScore || 0}/100</p>
                {(assistantCommand?.performanceContext?.slowRoutes || []).length > 0 && (
                  <p>
                    <strong>Top API Hotspot:</strong>{' '}
                    {assistantCommand.performanceContext.slowRoutes[0].method} {assistantCommand.performanceContext.slowRoutes[0].route} ({assistantCommand.performanceContext.slowRoutes[0].p95Ms}ms p95)
                  </p>
                )}
              </div>

              <div className="ai-sidecar-section">
                <strong>Quick Ticket Analysis</strong>
                <select value={assistantQuickTicketId} onChange={(e) => setAssistantQuickTicketId(e.target.value)}>
                  <option value="">Select assigned/high-priority ticket</option>
                  {highPriorityTickets.map((ticket) => (
                    <option key={ticket.id} value={ticket.id}>#{ticket.id} {ticket.title.slice(0, 55)}</option>
                  ))}
                </select>
                <textarea value={assistantNote} onChange={(e) => setAssistantNote(e.target.value)} placeholder="Optional analyst note" />
                <div className="staff-actions">
                  <button className="ghost-btn" disabled={assistantQuickBusy || !assistantQuickTicketId} onClick={onQuickAnalyzeTicket}>Analyze Ticket</button>
                  <button className="ghost-btn" disabled={assistantQuickBusy || !assistantQuickTicketId} onClick={() => onTendTicketWithAssistant(Number(assistantQuickTicketId))}>Tend Ticket</button>
                </div>
              </div>

              <div className="ai-sidecar-section">
                <strong>Quick Alert Analysis</strong>
                <select value={assistantQuickAlertId} onChange={(e) => setAssistantQuickAlertId(e.target.value)}>
                  <option value="">Select active alert</option>
                  {highPriorityAlerts.map((alert) => (
                    <option key={alert.id} value={alert.id}>#{alert.id} [{alert.severity}] {alert.title.slice(0, 45)}</option>
                  ))}
                </select>
                <div className="staff-actions">
                  <button className="ghost-btn" disabled={assistantQuickBusy || !assistantQuickAlertId} onClick={onQuickAnalyzeAlert}>Analyze Alert</button>
                  <button className="ghost-btn" disabled={assistantQuickBusy || !assistantQuickAlertId} onClick={() => onTendAlertWithAssistant(Number(assistantQuickAlertId), currentUser?.scjId || '')}>Tend Alert</button>
                </div>
              </div>

              {assistantTicketOutput && (
                <div className="ai-sidecar-section">
                  <strong>Ticket Coaching</strong>
                  <p>#{assistantTicketOutput.ticket?.id} | urgency {assistantTicketOutput.urgencyScore}</p>
                  <p>Next: {assistantTicketOutput.nextStage}</p>
                  <ul>
                    {(assistantTicketOutput.productivityPlan || []).slice(0, 3).map((item, idx) => (
                      <li key={`sidecar-ticket-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {assistantAlertOutput && (
                <div className="ai-sidecar-section">
                  <strong>Alert Guidance</strong>
                  <p>#{assistantAlertOutput.finding?.id} | urgency {assistantAlertOutput.urgencyScore}</p>
                  <p>{assistantAlertOutput.interpretation}</p>
                  <ul>
                    {(assistantAlertOutput.recommendedActions || []).slice(0, 3).map((item, idx) => (
                      <li key={`sidecar-alert-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="ai-sidecar-section">
                <button className="ghost-btn" onClick={() => setActiveTab('assistant')}>Open Full AI Workspace</button>
              </div>
            </aside>

            <SituationTile
              position={situationPosition}
              onPositionChange={setSituationPosition}
              isDragging={isDraggingSituation}
              onDraggingChange={setIsDraggingSituation}
              expanded={situationExpanded}
              onExpandChange={setSituationExpanded}
              criticalCount={criticalAlertCount}
              highCount={highAlertCount}
              topAction={topPriorityAction}
              lastUpdated={lastRefreshAt}
              criticalPulse={criticalPulse}
              snapToCorner={snapSituationToCorner}
              onSnapToggle={setSnapSituationToCorner}
              onMoveTo={moveSituationToCorner}
              presentationMode={presentationMode}
              onPresentationModeChange={setPresentationMode}
            />

            {tabHelp[activeTab] && <p className="onboarding-hint">{tabHelp[activeTab]}</p>}

            {activeTab === 'board-snapshot' && (
              <section className="panel board-snapshot-panel">
                <div className="board-snapshot-header">
                  <h2>Command Centre Snapshot</h2>
                  <button className="ghost-btn" onClick={() => window.print()}>Export Print/PDF</button>
                </div>
                <p className="muted-copy">Unified view for board snapshot, executive impact, and operations status.</p>

                <h3>Board Snapshot</h3>
                <div className="stats-grid">
                  <article className="stat-card"><p>Posture</p><strong>{executiveImpact?.postureBand || 'unknown'}</strong></article>
                  <article className="stat-card"><p>Critical Tickets</p><strong>{executiveImpact?.criticalTickets || 0}</strong></article>
                  <article className="stat-card"><p>Active Threats</p><strong>{networkVisibilityOverview?.summary?.activeThreats || 0}</strong></article>
                  <article className="stat-card"><p>Business Risk (DB Avg)</p><strong>{databaseOverview?.summary?.avgRisk || 0}</strong></article>
                </div>
                <div className="workspace-columns">
                  <article className="stat-card">
                    <p>Top 3 Immediate Priorities</p>
                    <ul className="network-hunt-list">
                      <li>{topPriorityAction}</li>
                      <li>Resolve SLA breaches: {executiveMetrics?.slaBreached || 0} pending.</li>
                      <li>Close unresolved high-value threats: {threatIntelOverview?.summary?.bountyCandidates || 0}.</li>
                    </ul>
                  </article>
                  <article className="stat-card">
                    <p>ETA to Containment</p>
                    <strong>{(executiveMetrics?.criticalOpen || 0) > 0 ? '4-8 hrs' : 'Within operating baseline'}</strong>
                    <p className="muted-copy">Estimate based on open critical incident volume and current remediation load.</p>
                  </article>
                </div>

                <h3>Executive Impact</h3>
                <div className="executive-hero">
                  <div>
                    <p className="health-label">Current enterprise cyber risk index</p>
                    <strong className={`risk-index risk-${executiveImpact?.postureBand || 'controlled'}`}>{executiveImpact?.riskIndex ?? 0}</strong>
                    <p className="muted-copy">Posture: {executiveImpact?.postureBand || 'unknown'}</p>
                  </div>
                  <div className="executive-mini-grid">
                    <article><p>Critical Findings</p><strong>{executiveImpact?.criticalFindings || 0}</strong></article>
                    <article><p>Critical Tickets</p><strong>{executiveImpact?.criticalTickets || 0}</strong></article>
                    <article><p>SLA Breached</p><strong>{executiveMetrics?.slaBreached || 0}</strong></article>
                    <article><p>MTTR (hrs)</p><strong>{executiveMetrics?.mttrHours ?? 'n/a'}</strong></article>
                  </div>
                </div>
                {executiveReportData?.headline && (
                  <article className="exec-brief">
                    <h3>Non-Technical Brief</h3>
                    <p>{executiveReportData.headline}</p>
                  </article>
                )}

                <h3>Operations Overview</h3>
                <div className="stats-grid">
                  <article className="stat-card"><p>Open Tickets</p><strong>{tickets.filter((t) => t.status === 'open').length}</strong></article>
                  <article className="stat-card"><p>Critical Tickets</p><strong>{tickets.filter((t) => t.priority === 'critical').length}</strong></article>
                  <article className="stat-card"><p>Monitored Apps</p><strong>{securityApplications.length}</strong></article>
                  <article className="stat-card"><p>Active Findings</p><strong>{securitySummary?.activeFindings || 0}</strong></article>
                </div>
              </section>
            )}

            {activeTab === 'health' && (
              <section className="panel">
                <h2>Application Health Check</h2>
                <p className="health-app-meta">Live refresh: every 30 seconds. Last update: {lastRefreshAt ? new Date(lastRefreshAt).toLocaleTimeString() : 'n/a'}</p>
                {!isAdmin && (
                  <div className="health-check-tile">
                    <p className="health-label">Your operational focus</p>
                    <strong className="health-state">{userFocusDomain}</strong>
                    <p className="health-app-meta">This view prioritizes incidents relevant to your domain so you can react faster.</p>
                    <ul className="history-list">
                      {focusTickets.map((t) => (
                        <li key={`focus-ticket-${t.id}`}>
                          <strong>#{t.id} {t.title}</strong>
                          <span>{t.priority} | {t.lifecycleStage || 'identified'} | {t.status}</span>
                        </li>
                      ))}
                      {focusTickets.length === 0 && <li><span>No open incidents currently matched to your domain.</span></li>}
                    </ul>
                  </div>
                )}
                <div className="health-filter-bar">
                  <span className="health-app-meta">View:</span>
                  <button
                    type="button"
                    className={`ghost-btn tiny-btn ${healthViewFilter === 'all' ? 'active-toggle' : ''}`}
                    onClick={() => setHealthViewFilter('all')}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={`ghost-btn tiny-btn ${healthViewFilter === 'urgent' ? 'active-toggle' : ''}`}
                    onClick={() => setHealthViewFilter('urgent')}
                  >
                    Urgent Only
                  </button>
                </div>
                <div className="health-check-tile">
                  <p className="health-label">Overall posture</p>
                  <strong className={`health-state health-${securitySummary?.overall || 'unknown'}`}>{securitySummary?.overall || 'unknown'}</strong>
                  <div className="health-severity-grid">
                    <span className="sev sev-critical">Critical {securitySummary?.bySeverity?.critical || 0}</span>
                    <span className="sev sev-high">High {securitySummary?.bySeverity?.high || 0}</span>
                    <span className="sev sev-medium">Medium {securitySummary?.bySeverity?.medium || 0}</span>
                    <span className="sev sev-low">Low {securitySummary?.bySeverity?.low || 0}</span>
                  </div>
                  {isAdmin && (
                    <div className="health-actions">
                      <button
                        className={`ghost-btn live-btn ${isActionBusy('scan-passive') ? 'is-busy' : ''}`}
                        disabled={isActionBusy('scan-passive') || isActionBusy('scan-active')}
                        onClick={() => onRunScan('passive')}
                      >
                        {isActionBusy('scan-passive') ? 'Scanning...' : 'Run Passive Scan'}
                      </button>
                      <button
                        className={`ghost-btn live-btn ${isActionBusy('scan-active') ? 'is-busy' : ''}`}
                        disabled={isActionBusy('scan-active') || isActionBusy('scan-passive')}
                        onClick={() => onRunScan('active')}
                      >
                        {isActionBusy('scan-active') ? 'Scanning...' : 'Run Active Scan'}
                      </button>
                    </div>
                  )}
                </div>

                <h3>Connected Devices Health</h3>
                <div className="health-app-grid">
                  {filteredHealthDevices.map((device) => (
                    <article key={`health-device-${device.id}`} className="health-app-tile">
                      <div className="health-app-header">
                        <h3>{device.name}</h3>
                        <span className={`health-app-status status-${device.state === 'online' ? 'healthy' : device.state === 'degraded' ? 'degraded' : 'unknown'}`}>
                          {device.state || 'unknown'}
                        </span>
                      </div>
                      <p className="health-app-meta">Type: {device.deviceType || 'unknown'}</p>
                      <p className="health-app-meta">Location: {device.location || 'Unknown location'}</p>
                      <p className="health-app-meta">Risk score: {device.riskScore ?? 0}</p>
                      <p className="health-app-meta">Last passive scan: {device.lastPassiveScanAt ? new Date(device.lastPassiveScanAt).toLocaleString() : 'Not run yet'}</p>
                    </article>
                  ))}
                  {filteredHealthDevices.length === 0 && (
                    <article className="health-app-tile health-app-empty">
                      <h3>{healthViewFilter === 'urgent' ? 'No urgent devices' : 'No devices registered'}</h3>
                      <p className="health-app-meta">{healthViewFilter === 'urgent' ? 'No degraded or high-risk devices right now.' : 'Register devices in the Connected Devices tab to include their health status here.'}</p>
                    </article>
                  )}
                </div>

                <h3>Database Assets Health</h3>
                <div className="health-app-grid">
                  {filteredHealthDatabases.map((db) => (
                    <article key={`health-db-${db.id}`} className="health-app-tile">
                      <div className="health-app-header">
                        <h3>{db.name}</h3>
                        <span className={`health-app-status status-${db.state === 'online' ? 'healthy' : db.state === 'degraded' ? 'degraded' : 'unknown'}`}>
                          {db.state || 'unknown'}
                        </span>
                      </div>
                      <p className="health-app-meta">Engine: {db.engine || 'unknown'} | {db.environment || 'unknown'}</p>
                      <p className="health-app-meta">Criticality: {db.criticality || 'unknown'}</p>
                      <p className="health-app-meta">Risk score: {db.riskScore ?? 0}</p>
                      <p className="health-app-meta">Patch level: {db.patchLevel || 'unknown'}</p>
                    </article>
                  ))}
                  {filteredHealthDatabases.length === 0 && (
                    <article className="health-app-tile health-app-empty">
                      <h3>{healthViewFilter === 'urgent' ? 'No urgent database assets' : 'No database assets registered'}</h3>
                      <p className="health-app-meta">{healthViewFilter === 'urgent' ? 'No degraded or high-risk database assets right now.' : 'Register databases in the Database Infra Monitor tab to include their health status here.'}</p>
                    </article>
                  )}
                </div>

                <h3>Application Health</h3>
                <div className="health-app-grid">
                  {filteredHealthApplications.map((app) => (
                    <article key={app.id} className="health-app-tile">
                      <div className="health-app-header">
                        <h3>{app.name}</h3>
                        <span className={`health-app-status status-${app.healthStatus || 'unknown'}`}>
                          {app.healthStatus || 'unknown'}
                        </span>
                      </div>
                      <p className="health-app-meta">Environment: {app.environment}</p>
                      <p className="health-app-meta">Power: {app.runtime?.powerState || 'unknown'} | Runtime: {app.runtime?.runtimeState || 'unknown'}</p>
                      <p className="health-app-meta">Runtime check: {app.runtime?.checkedAt ? new Date(app.runtime.checkedAt).toLocaleString() : 'No runtime check yet'}</p>
                      <p className="health-app-meta">Runtime reason: {app.runtime?.runtimeReason || 'No runtime details available'}</p>
                      <p className="health-app-meta">Owner: {app.ownerEmail || 'Not assigned'}</p>
                      <p className="health-app-meta">Passive Scan: {app.lastPassiveScanAt ? new Date(app.lastPassiveScanAt).toLocaleString() : 'Not run yet'}</p>
                      <p className="health-app-meta">Active Scan: {app.lastActiveScanAt ? new Date(app.lastActiveScanAt).toLocaleString() : 'Not run yet'}</p>
                    </article>
                  ))}
                  {filteredHealthApplications.length === 0 && (
                    <article className="health-app-tile health-app-empty">
                      <h3>{healthViewFilter === 'urgent' ? 'No urgent applications' : 'No applications registered'}</h3>
                      <p className="health-app-meta">{healthViewFilter === 'urgent' ? 'No degraded or critical applications right now.' : 'Register applications in the Applications Monitored tab to see one status tile per app.'}</p>
                    </article>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'applications' && (
              <section className="panel">
                <h2>Applications Monitored</h2>
                <p className="onboarding-hint">How to read this: each tile shows business risk, active security issues, and recommended improvements to prioritize by urgency.</p>
                {isAdmin && (
                  <ApplicationRegistrationForm
                    appName={appName}
                    onAppNameChange={setAppName}
                    appBaseUrl={appBaseUrl}
                    onAppBaseUrlChange={setAppBaseUrl}
                    appEnvironment={appEnvironment}
                    onAppEnvironmentChange={setAppEnvironment}
                    appOwnerEmail={appOwnerEmail}
                    onAppOwnerEmailChange={setAppOwnerEmail}
                    onSubmit={onRegisterApplication}
                  />
                )}
                <div className="application-analytics-grid">
                  {applicationTileData.map((tile) => (
                    <article key={tile.app.id} className="application-analytics-tile">
                      <div className="application-analytics-header">
                        <div>
                          <h3>{tile.app.name}</h3>
                          <p>{tile.app.environment} environment</p>
                        </div>
                        <span className={`health-app-status status-${tile.app.healthStatus || 'unknown'}`}>
                          {tile.app.healthStatus || 'unknown'}
                        </span>
                      </div>

                      <div className="application-analytics-stats">
                        <span>Risk Score <strong>{tile.riskScore}</strong></span>
                        <span>Total Findings <strong>{tile.findingsCount}</strong></span>
                        <span>Active Findings <strong>{tile.activeFindingsCount}</strong></span>
                        <span>Critical/High <strong>{tile.criticalFindingsCount}/{tile.highFindingsCount}</strong></span>
                        <span>Linked Tickets <strong>{tile.linkedTicketCount}</strong></span>
                        <span>Open Linked <strong>{tile.openLinkedTicketCount}</strong></span>
                      </div>

                      <div className="application-analytics-meta">
                        <p>Owner: {tile.app.ownerEmail || 'Not assigned'}</p>
                        <p>Passive scan: {tile.app.lastPassiveScanAt ? new Date(tile.app.lastPassiveScanAt).toLocaleString() : 'Not run yet'}</p>
                        <p>Active scan: {tile.app.lastActiveScanAt ? new Date(tile.app.lastActiveScanAt).toLocaleString() : 'Not run yet'}</p>
                      </div>

                      <div className="application-analytics-suggestions">
                        <h4>Suggested Security Improvements</h4>
                        <ul>
                          {tile.suggestions.map((suggestion, idx) => (
                            <li key={`${tile.app.id}-suggestion-${idx}`}>{suggestion}</li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                  {applicationTileData.length === 0 && (
                    <article className="application-analytics-tile">
                      <h3>No applications registered</h3>
                      <p>Register an application to generate analytics and suggested security improvements.</p>
                    </article>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'network' && (
              <section className="panel">
                <h2>Network Monitored</h2>
                <p className="onboarding-hint">How to read this: start with active threats and sensor health, then investigate top signals and assign ownership.</p>
                <div className="network-summary-grid">
                  <article className="stat-card"><p>Routers</p><strong>{networkVisibilityOverview?.inventory?.routers || 0}</strong></article>
                  <article className="stat-card"><p>Access Points</p><strong>{networkVisibilityOverview?.inventory?.accessPoints || 0}</strong></article>
                  <article className="stat-card"><p>Endpoints</p><strong>{networkVisibilityOverview?.inventory?.endpoints || 0}</strong></article>
                  <article className="stat-card"><p>Unknown Devices</p><strong>{networkVisibilityOverview?.inventory?.unknownDevices || 0}</strong></article>
                  <article className="stat-card"><p>Offline Devices</p><strong>{networkVisibilityOverview?.inventory?.offlineDevices || 0}</strong></article>
                  <article className="stat-card"><p>Active Threats</p><strong>{networkVisibilityOverview?.summary?.activeThreats || 0}</strong></article>
                </div>

                {presentationMode === 'analyst' && (
                  <>
                    <h3>Sensor Health and Collection</h3>
                    <div className="network-sensor-grid">
                      {(networkVisibilityOverview?.sensors || []).map((sensor) => (
                        <article key={sensor.name} className="network-sensor-card">
                          <div className="network-sensor-header">
                            <strong>{sensor.name}</strong>
                            <span className={`network-sensor-status sensor-${sensor.status || 'watch'}`}>{sensor.status || 'watch'}</span>
                          </div>
                          <p>{sensor.coverage}</p>
                          <span>Events (24h): {sensor.eventsLast24h}</span>
                          <span>Last seen: {sensor.lastSeenAt ? new Date(sensor.lastSeenAt).toLocaleString() : 'n/a'}</span>
                        </article>
                      ))}
                    </div>
                  </>
                )}

                <h3>Traffic Analytics</h3>
                <div className="network-traffic-grid">
                  <article className="network-traffic-card">
                    <p>East-West Anomalies</p>
                    <strong>{networkVisibilityOverview?.trafficAnalytics?.eastWestAnomalies || 0}</strong>
                  </article>
                  <article className="network-traffic-card">
                    <p>External Exposure Signals</p>
                    <strong>{networkVisibilityOverview?.trafficAnalytics?.externalExposureSignals || 0}</strong>
                  </article>
                  <article className="network-traffic-card network-top-talkers">
                    <p>Top Talkers</p>
                    <ul>
                      {(networkVisibilityOverview?.trafficAnalytics?.topTalkers || []).map((talker) => (
                        <li key={talker.label}><span>{talker.label}</span><strong>{talker.trafficIndex}</strong></li>
                      ))}
                    </ul>
                  </article>
                </div>

                <h3>Per-Application Network Visibility</h3>
                <div className="network-app-grid">
                  {(networkVisibilityOverview?.perApplication || []).map((row) => (
                    <article key={row.applicationId} className="network-app-card">
                      <div className="network-app-header">
                        <div>
                          <h4>{row.applicationName}</h4>
                          <p>{row.environment} environment</p>
                        </div>
                        <span className={`health-app-status status-${row.healthStatus || 'unknown'}`}>{row.healthStatus || 'unknown'}</span>
                      </div>
                      <div className="network-app-metrics">
                        <span>Net Findings <strong>{row.networkFindingsCount}</strong></span>
                        <span>Active Threats <strong>{row.activeFindingsCount}</strong></span>
                        <span>Linked Tickets <strong>{row.ticketLinkedCount}</strong></span>
                        <span>Pending Manual Confirmations <strong>{row.manualConfirmationsPending}</strong></span>
                      </div>
                      <p className="network-app-owner">Owner: {row.ownerEmail || 'Not assigned'}</p>
                      <div className="network-app-signals">
                        <h5>Top Signals</h5>
                        <ul>
                          {(row.topSignals || []).map((signal) => (
                            <li key={signal.id}><strong>{signal.severity}</strong> {signal.title} ({signal.sourceTool})</li>
                          ))}
                          {(row.topSignals || []).length === 0 && <li>No significant network signals.</li>}
                        </ul>
                      </div>
                      <div className="network-app-reco">
                        <h5>Suggested Improvements</h5>
                        <ul>
                          {(row.recommendations || []).map((item, idx) => (
                            <li key={`${row.applicationId}-reco-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>

                <h3>Threat Hunting Playbook</h3>
                <ul className="network-hunt-list">
                  {(networkVisibilityOverview?.huntRecommendations || []).map((item, idx) => (
                    <li key={`hunt-${idx}`}>{item}</li>
                  ))}
                </ul>

                <h3>Potential Attacks Detected</h3>
                <div className="table-wrap">
                  <table className="ticket-table">
                    <thead>
                      <tr><th>ID</th><th>App</th><th>Title</th><th>Status</th><th>Severity</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                      {intrusionRows.map((finding) => (
                        <tr key={finding.id}>
                          <td>{finding.id}</td>
                          <td>{finding.application?.name || 'Unknown'}</td>
                          <td>{finding.title}</td>
                          <td>{finding.status}</td>
                          <td><span className={`badge badge-${finding.severity}`}>{finding.severity}</span></td>
                          <td>
                            {finding.requiresManualConfirmation && !finding.manualConfirmed ? (
                              <button className="ghost-btn tiny-btn" disabled={findingActionId === finding.id} onClick={() => onConfirmFinding(finding.id)}>Confirm</button>
                            ) : finding.ticketId ? (
                              <span className="role-lock">Ticket #{finding.ticketId}</span>
                            ) : (
                              <div className="finding-actions">
                                <select value={findingAssigneeMap[finding.id] || ''} onChange={(e) => setFindingAssigneeMap((prev) => ({ ...prev, [finding.id]: e.target.value }))}>
                                  <option value="">Unassigned</option>
                                  {users.filter((u) => u.scjId).map((u) => (
                                    <option key={u.scjId} value={u.scjId}>{u.scjId} - {u.name} {u.surname}</option>
                                  ))}
                                </select>
                                <button className="ghost-btn tiny-btn" disabled={findingActionId === finding.id} onClick={() => onCreateFindingTicket(finding.id)}>Create Ticket</button>
                                <button className="ghost-btn tiny-btn" onClick={() => onAnalyzeAlertWithAssistant(finding.id)}>Ask AI</button>
                                <button
                                  className="ghost-btn tiny-btn"
                                  disabled={assistantQuickBusy}
                                  onClick={() => onTendAlertWithAssistant(finding.id, findingAssigneeMap[finding.id] || currentUser?.scjId || '')}
                                >
                                  Tend Alert
                                </button>
                                {isAdmin && (
                                  <select defaultValue={finding.status} onChange={(e) => onUpdateFindingStatus(finding.id, e.target.value)}>
                                    <option value="new">new</option>
                                    <option value="investigating">investigating</option>
                                    <option value="remediated">remediated</option>
                                    <option value="dismissed">dismissed</option>
                                  </select>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {intrusionRows.length === 0 && <tr><td colSpan="6" className="empty-state">No potential attack indicators yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {networkFindings.length > 5 && (
                  <button className="ghost-btn" onClick={() => setShowAllIntrusions((prev) => !prev)}>
                    {showAllIntrusions ? 'Show Top 5' : `Show All (${networkFindings.length})`}
                  </button>
                )}
              </section>
            )}

            {activeTab === 'connected-devices' && (
              <section className="panel">
                <h2>Connected Devices Registry & Monitoring</h2>
                <p className="onboarding-hint">How to read this: register physical infrastructure first, then run passive and IDS checks from highest risk to lowest.</p>
                {isAdmin && (
                  <DeviceRegistrationForm
                    deviceName={deviceName}
                    onDeviceNameChange={setDeviceName}
                    deviceType={deviceType}
                    onDeviceTypeChange={setDeviceType}
                    deviceIp={deviceIp}
                    onDeviceIpChange={setDeviceIp}
                    deviceLocation={deviceLocation}
                    onDeviceLocationChange={setDeviceLocation}
                    deviceVendor={deviceVendor}
                    onDeviceVendorChange={setDeviceVendor}
                    deviceModel={deviceModel}
                    onDeviceModelChange={setDeviceModel}
                    deviceFirmware={deviceFirmware}
                    onDeviceFirmwareChange={setDeviceFirmware}
                    onSubmit={onRegisterDevice}
                  />
                )}

                <div className="connected-device-grid">
                  {sortedNetworkDevices.map((device) => (
                    <article key={device.id} className="connected-device-card">
                      <div className="connected-device-header">
                        <div>
                          <h3>{device.name}</h3>
                          <p>{device.deviceType} | {device.location || 'Unknown location'}</p>
                        </div>
                        <span className={`health-app-status status-${device.state === 'online' ? 'healthy' : device.state === 'degraded' ? 'degraded' : 'unknown'}`}>{device.state}</span>
                      </div>
                      <div className="connected-device-metrics">
                        <span>Risk <strong>{device.riskScore}</strong></span>
                        <span>IDS/IPS <strong>{device.idsIpsEnabled ? 'Enabled' : 'Disabled'}</strong></span>
                        <span>Passive Scan <strong>{device.passiveScanEnabled ? 'Enabled' : 'Disabled'}</strong></span>
                        <span>IP <strong>{device.ipAddress || 'n/a'}</strong></span>
                      </div>
                      <p className="connected-device-meta">Vendor/Model: {device.vendor || 'n/a'} {device.model || ''}</p>
                      {presentationMode === 'analyst' && (
                        <>
                          <p className="connected-device-meta">Last passive scan: {device.lastPassiveScanAt ? new Date(device.lastPassiveScanAt).toLocaleString() : 'Not run yet'}</p>
                          <p className="connected-device-meta">Last IDS/IPS event: {device.lastIdsIpsEventAt ? new Date(device.lastIdsIpsEventAt).toLocaleString() : 'No events yet'}</p>
                        </>
                      )}
                      {isAdmin && (
                        <div className="staff-actions">
                          <button
                            className={`ghost-btn tiny-btn live-btn ${isActionBusy(`device-passive-${device.id}`) ? 'is-busy' : ''}`}
                            disabled={isActionBusy(`device-passive-${device.id}`)}
                            onClick={() => onRunDevicePassive(device.id)}
                          >
                            {isActionBusy(`device-passive-${device.id}`) ? 'Running...' : 'Run Passive Scan'}
                          </button>
                          <button
                            className={`ghost-btn tiny-btn live-btn ${isActionBusy(`device-ids-${device.id}`) ? 'is-busy' : ''}`}
                            disabled={isActionBusy(`device-ids-${device.id}`)}
                            onClick={() => onRunDeviceIds(device.id)}
                          >
                            {isActionBusy(`device-ids-${device.id}`) ? 'Checking...' : 'Run IDS/IPS Check'}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                  {networkDevices.length === 0 && (
                    <article className="connected-device-card">
                      <h3>No devices registered</h3>
                      <p className="connected-device-meta">Register routers, switches, access points, and endpoints to monitor live posture and activity.</p>
                    </article>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'database-monitor' && (
              <section className="panel">
                <h2>Database Infrastructure Security Monitor</h2>
                <p className="onboarding-hint">How to read this: register each critical database, run security scans, then close patch and crypto gaps from highest risk downward.</p>
                {isAdmin && (
                  <DatabaseRegistrationForm
                    dbName={dbName}
                    onDbNameChange={setDbName}
                    dbEngine={dbEngine}
                    onDbEngineChange={setDbEngine}
                    dbEnvironment={dbEnvironment}
                    onDbEnvironmentChange={setDbEnvironment}
                    dbHost={dbHost}
                    onDbHostChange={setDbHost}
                    dbPort={dbPort}
                    onDbPortChange={setDbPort}
                    dbOwner={dbOwner}
                    onDbOwnerChange={setDbOwner}
                    dbCriticality={dbCriticality}
                    onDbCriticalityChange={setDbCriticality}
                    dbPatchLevel={dbPatchLevel}
                    onDbPatchLevelChange={setDbPatchLevel}
                    dbEncryptionAtRest={dbEncryptionAtRest}
                    onDbEncryptionAtRestChange={setDbEncryptionAtRest}
                    dbTlsInTransit={dbTlsInTransit}
                    onDbTlsInTransitChange={setDbTlsInTransit}
                    onSubmit={onRegisterDatabase}
                  />
                )}

                <div className="network-summary-grid">
                  <article className="stat-card"><p>Total Databases</p><strong>{databaseOverview?.summary?.totalDatabases || 0}</strong></article>
                  <article className="stat-card"><p>Online</p><strong>{databaseOverview?.summary?.online || 0}</strong></article>
                  <article className="stat-card"><p>Degraded</p><strong>{databaseOverview?.summary?.degraded || 0}</strong></article>
                  <article className="stat-card"><p>Critical Assets</p><strong>{databaseOverview?.summary?.critical || 0}</strong></article>
                  <article className="stat-card"><p>Average Risk</p><strong>{databaseOverview?.summary?.avgRisk || 0}</strong></article>
                </div>

                <div className="connected-device-grid">
                  {sortedDatabaseAssets.map((db) => (
                    <article key={db.id} className="connected-device-card">
                      <div className="connected-device-header">
                        <div>
                          <h3>{db.name}</h3>
                          <p>{db.engine} | {db.environment}</p>
                        </div>
                        <span className={`health-app-status status-${db.state === 'online' ? 'healthy' : db.state === 'degraded' ? 'degraded' : 'unknown'}`}>{db.state}</span>
                      </div>
                      <div className="connected-device-metrics">
                        <span>Risk <strong>{db.riskScore}</strong></span>
                        <span>Criticality <strong>{db.criticality}</strong></span>
                        <span>Patch <strong>{db.patchLevel || 'unknown'}</strong></span>
                        <span>Backup <strong>{db.backupStatus}</strong></span>
                      </div>
                      <p className="connected-device-meta">Host: {db.host}{db.port ? `:${db.port}` : ''}</p>
                      <p className="connected-device-meta">Owner: {db.ownerEmail || 'Not assigned'}</p>
                      {presentationMode === 'analyst' && <p className="connected-device-meta">Crypto: At-rest {db.encryptionAtRest ? 'yes' : 'no'} | TLS {db.tlsInTransit ? 'yes' : 'no'}</p>}
                      {isAdmin && (
                        <div className="staff-actions">
                          <button
                            className={`ghost-btn tiny-btn live-btn ${isActionBusy(`db-scan-${db.id}`) ? 'is-busy' : ''}`}
                            disabled={isActionBusy(`db-scan-${db.id}`)}
                            onClick={() => onRunDatabaseScan(db.id)}
                          >
                            {isActionBusy(`db-scan-${db.id}`) ? 'Scanning...' : 'Run Security Scan'}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>

                <h3>Patch and Hardening Recommendations</h3>
                <ul className="network-hunt-list">
                  {(databaseOverview?.patchRecommendations || []).map((item, idx) => (
                    <li key={`db-reco-${idx}`}>{item}</li>
                  ))}
                </ul>
              </section>
            )}

            {activeTab === 'patch-management' && (
              <section className="panel">
                <h2>Patch Management</h2>
                <p className="onboarding-hint">How to read this: each lane tracks patch lifecycle for one asset class. Drive work left-to-right from to-do to completed.</p>

                <div className="network-summary-grid">
                  <article className="stat-card"><p>Total Patch Tasks</p><strong>{patchOverview?.summary?.total || 0}</strong></article>
                  <article className="stat-card"><p>To Do</p><strong>{patchOverview?.summary?.byStatus?.todo || 0}</strong></article>
                  <article className="stat-card"><p>In Progress</p><strong>{patchOverview?.summary?.byStatus?.in_progress || 0}</strong></article>
                  <article className="stat-card"><p>Completed</p><strong>{patchOverview?.summary?.byStatus?.completed || 0}</strong></article>
                  <article className="stat-card"><p>Overdue</p><strong>{patchOverview?.summary?.overdue || 0}</strong></article>
                  <article className="stat-card"><p>Completion Rate</p><strong>{patchOverview?.summary?.completionRate || 0}%</strong></article>
                </div>

                {isAdmin && (
                  <PatchManagementForm
                    patchAssetType={patchAssetType}
                    onPatchAssetTypeChange={setPatchAssetType}
                    patchAssetId={patchAssetId}
                    onPatchAssetIdChange={setPatchAssetId}
                    patchAssets={selectedPatchAssets}
                    patchTitle={patchTitle}
                    onPatchTitleChange={setPatchTitle}
                    patchSeverity={patchSeverity}
                    onPatchSeverityChange={setPatchSeverity}
                    patchCurrentVersion={patchCurrentVersion}
                    onPatchCurrentVersionChange={setPatchCurrentVersion}
                    patchTargetVersion={patchTargetVersion}
                    onPatchTargetVersionChange={setPatchTargetVersion}
                    patchOwnerEmail={patchOwnerEmail}
                    onPatchOwnerEmailChange={setPatchOwnerEmail}
                    patchDueDate={patchDueDate}
                    onPatchDueDateChange={setPatchDueDate}
                    patchDescription={patchDescription}
                    onPatchDescriptionChange={setPatchDescription}
                    onSubmit={onCreatePatchTask}
                    isSubmitting={isActionBusy('create-patch-task')}
                  />
                )}

                {[
                  ['application', 'Application Patches'],
                  ['network_device', 'Network Device Patches'],
                  ['database_asset', 'Database Asset Patches'],
                ].map(([assetType, title]) => (
                  <div key={`patch-lane-${assetType}`} className="patch-board-section">
                    <h3>{title}</h3>
                    <div className="patch-board-grid">
                      {[
                        ['todo', 'To Do'],
                        ['in_progress', 'In Progress'],
                        ['completed', 'Completed'],
                      ].map(([statusKey, statusLabel]) => (
                        <article key={`${assetType}-${statusKey}`} className="patch-status-column">
                          <div className="patch-status-header">
                            <strong>{statusLabel}</strong>
                            <span>{patchGroups[assetType][statusKey].length}</span>
                          </div>
                          <div
                            className={`patch-card-list ${patchDragState.overLaneKey === getPatchLaneKey(assetType, statusKey) ? 'is-drag-over' : ''}`}
                            onDragOver={(event) => onPatchCardDragOver(event, getPatchLaneKey(assetType, statusKey), null)}
                            onDrop={(event) => onPatchCardDrop(event, getPatchLaneKey(assetType, statusKey), null)}
                          >
                            {getOrderedPatchTasks(assetType, statusKey).map((task) => {
                              const isCompleted = statusKey === 'completed'
                              const isFlipped = Boolean(flippedPatchCards[task.id])
                              const laneKey = getPatchLaneKey(assetType, statusKey)
                              const isDragging = patchDragState.sourceLaneKey === laneKey && patchDragState.sourceTaskId === task.id
                              const isDragTarget = patchDragState.overLaneKey === laneKey && patchDragState.overTaskId === task.id
                              const details = formatPatch5W1H(task)

                              return (
                                <div
                                  key={task.id}
                                  className={`patch-card patch-card-live ${isCompleted ? 'patch-card-flip' : ''} ${isFlipped ? 'is-flipped' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragTarget ? 'is-drop-target' : ''}`}
                                  draggable
                                  onDragStart={(event) => onPatchCardDragStart(event, laneKey, task.id)}
                                  onDragOver={(event) => onPatchCardDragOver(event, laneKey, task.id)}
                                  onDrop={(event) => onPatchCardDrop(event, laneKey, task.id)}
                                  onDragEnd={onPatchCardDragEnd}
                                >
                                  {!isCompleted ? (
                                    <>
                                      <div className="patch-card-head">
                                        <strong>{task.title}</strong>
                                        <span className={`badge badge-${task.severity || 'medium'}`}>{task.severity || 'medium'}</span>
                                      </div>
                                      <p className="connected-device-meta patch-text-wrap">Asset: {task.assetName}</p>
                                      {(task.currentVersion || task.targetVersion) && (
                                        <p className="connected-device-meta patch-text-wrap">Version: {task.currentVersion || 'unknown'}{' -> '}{task.targetVersion || 'target pending'}</p>
                                      )}
                                      <p className="connected-device-meta patch-text-wrap">Owner: {task.ownerEmail || 'Not assigned'}</p>
                                      <p className="connected-device-meta patch-text-wrap">Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}</p>
                                      {task.description && <p className="connected-device-meta patch-text-wrap patch-description">{task.description}</p>}
                                      {isAdmin && (
                                        <div className="staff-actions patch-card-controls">
                                          <select
                                            value={task.status}
                                            disabled={patchActionId === task.id || isActionBusy(`patch-status-${task.id}`)}
                                            onChange={(e) => onUpdatePatchStatus(task.id, e.target.value)}
                                          >
                                            <option value="todo">todo</option>
                                            <option value="in_progress">in_progress</option>
                                            <option value="completed">completed</option>
                                          </select>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <div className="patch-card-face patch-card-front">
                                        <div className="patch-card-head">
                                          <strong>{task.title}</strong>
                                          <span className={`badge badge-${task.severity || 'medium'}`}>{task.severity || 'medium'}</span>
                                        </div>
                                        <p className="connected-device-meta patch-text-wrap">Completed patch for {task.assetName}</p>
                                        <p className="connected-device-meta patch-text-wrap">Click to view 5W1H completion history</p>
                                        <div className="patch-card-action-row">
                                          <button
                                            type="button"
                                            className="ghost-btn tiny-btn live-btn"
                                            onClick={() => togglePatchCardFlip(task.id)}
                                          >
                                            View History
                                          </button>
                                        </div>
                                      </div>
                                      <div className="patch-card-face patch-card-back">
                                        <h4>5W1H Completion History</h4>
                                        <ul className="patch-history-list">
                                          <li><strong>What:</strong> {details.what}</li>
                                          <li><strong>Why:</strong> {details.why}</li>
                                          <li><strong>Who:</strong> {details.who}</li>
                                          <li><strong>When:</strong> {details.when}</li>
                                          <li><strong>Where:</strong> {details.where}</li>
                                          <li><strong>How:</strong> {details.how}</li>
                                        </ul>
                                        <p className="connected-device-meta patch-text-wrap">Started: {details.started}</p>
                                        <p className="connected-device-meta patch-text-wrap">Target due: {details.due}</p>
                                        <div className="patch-card-action-row">
                                          <button
                                            type="button"
                                            className="ghost-btn tiny-btn live-btn"
                                            onClick={() => togglePatchCardFlip(task.id)}
                                          >
                                            Back To Tile
                                          </button>
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )
                            })}
                            {patchGroups[assetType][statusKey].length === 0 && (
                              <div className="patch-card patch-card-empty">
                                <p>No tasks in this lane.</p>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {activeTab === 'threat-intel' && (
              <section className="panel">
                <h2>Threat Intelligence Collection & Hunting</h2>
                <p className="onboarding-hint">How to read this: focus on high-value unresolved threats first, then execute the recommended hunting actions per application.</p>
                <div className="threat-summary-grid">
                  <article className="stat-card">
                    <p>Applications Monitored</p>
                    <strong>{threatIntelOverview?.summary?.applicationsMonitored || 0}</strong>
                  </article>
                  <article className="stat-card">
                    <p>Total Findings</p>
                    <strong>{threatIntelOverview?.summary?.totalFindings || 0}</strong>
                  </article>
                  <article className="stat-card">
                    <p>Active Threats</p>
                    <strong>{threatIntelOverview?.summary?.activeFindings || 0}</strong>
                  </article>
                  <article className="stat-card">
                    <p>High-Value Unresolved Threats</p>
                    <strong>{threatIntelOverview?.summary?.bountyCandidates || 0}</strong>
                  </article>
                </div>

                <div className="threat-app-grid">
                  {(threatIntelOverview?.perApplication || []).map((row) => (
                    <article key={row.applicationId} className="threat-app-tile">
                      <div className="threat-app-header">
                        <div>
                          <h3>{row.applicationName}</h3>
                          <p>{row.environment} environment</p>
                        </div>
                        <span className={`health-app-status status-${row.healthStatus || 'unknown'}`}>{row.healthStatus || 'unknown'}</span>
                      </div>

                      <div className="threat-metrics-grid">
                        <span>Hunting Score <strong>{row.huntingOpportunityScore}</strong></span>
                        <span>Total Findings <strong>{row.findingsCount}</strong></span>
                        <span>Active Findings <strong>{row.activeFindingsCount}</strong></span>
                        <span>Critical/High <strong>{row.criticalFindingsCount}/{row.highFindingsCount}</strong></span>
                        <span>Unresolved Priority Threats <strong>{row.bountyCandidatesCount}</strong></span>
                        <span>Linked Tickets <strong>{row.linkedTicketCount}</strong></span>
                      </div>

                      <p className="threat-owner">Owner: {row.ownerEmail || 'Not assigned'}</p>

                      {presentationMode === 'analyst' && (
                        <div className="threat-top-list">
                          <h4>Top Threats Found</h4>
                          <ul>
                            {(row.topThreats || []).map((threat) => (
                              <li key={threat.id}><strong>{threat.severity}</strong> {threat.title} ({threat.sourceTool})</li>
                            ))}
                            {(row.topThreats || []).length === 0 && <li>No significant threat indicators for this application.</li>}
                          </ul>
                        </div>
                      )}

                      <div className="threat-hunt-list">
                        <h4>Recommended Hunting / Bounty Actions</h4>
                        <ul>
                          {(row.recommendedHunts || []).map((item, idx) => (
                            <li key={`${row.applicationId}-hunt-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'staff' && (
              <section className="panel">
                <h2>Register CCC Staff</h2>
                <p className="onboarding-hint">Use this page to add or review Command Centre users. These details drive assignment, notifications, accountability, and domain-specific work views.</p>
                {isAdmin && (
                  <form onSubmit={onRegisterStaff} className="ticket-form staff-form">
                    <div className="staff-grid">
                      <FieldWithHint help="First name of the CCC team member being added to the platform.">
                        <input placeholder="Name" value={staffName} onChange={(e) => setStaffName(e.target.value)} required />
                      </FieldWithHint>
                      <FieldWithHint help="Surname helps distinguish people with similar names in notifications and audit trails.">
                        <input placeholder="Surname" value={staffSurname} onChange={(e) => setStaffSurname(e.target.value)} required />
                      </FieldWithHint>
                      <FieldWithHint help="Department decides what kind of incidents the user will mostly work on.">
                        <select value={staffDepartment} onChange={(e) => setStaffDepartment(e.target.value)} required>
                          <option value="Networks">Networks</option>
                          <option value="Dev">Dev</option>
                          <option value="Hardware">Hardware</option>
                        </select>
                      </FieldWithHint>
                      <FieldWithHint help="Job title helps the system describe the user clearly in assignments and dashboards.">
                        <input placeholder="Job title" value={staffJobTitle} onChange={(e) => setStaffJobTitle(e.target.value)} required />
                      </FieldWithHint>
                      <FieldWithHint help="Telegram number is used for instant incident notifications and quick mobile response.">
                        <input placeholder="Telegram number" value={staffTelegramNumber} onChange={(e) => setStaffTelegramNumber(e.target.value)} required />
                      </FieldWithHint>
                      <FieldWithHint help="Email is used for structured incident briefings, escalation, and reporting.">
                        <input type="email" placeholder="Email address" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} required />
                      </FieldWithHint>
                      <FieldWithHint help="SCJ ID uniquely identifies the user in tickets, actions, and notifications.">
                        <input placeholder={`SCJ ID (${SCJ_ID_EXAMPLE})`} value={staffScjId} onChange={(e) => setStaffScjId(e.target.value)} pattern="[0-9]{8}-[0-9]{5}" required />
                      </FieldWithHint>
                    </div>
                    <div className="staff-actions">
                      <button type="submit">Register IT Staff</button>
                      <button type="button" className="ghost-btn" onClick={onPreloadStaff}>Load Default IT Staff</button>
                    </div>
                  </form>
                )}
                <div className="table-wrap">
                  <table className="ticket-table">
                    <thead><tr><th>SCJ ID</th><th>Name</th><th>Title</th><th>Department</th><th>Email</th><th>Telegram</th></tr></thead>
                    <tbody>
                      {users.filter((u) => u.scjId).map((u) => (
                        <tr key={u.id}><td>{u.scjId}</td><td>{u.name} {u.surname}</td><td>{u.jobTitle}</td><td>{u.department}</td><td>{u.email}</td><td>{u.telegramNumber}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {activeTab === 'tickets' && (
              <section className="panel">
                <h2>Incident Lifecycle Workspace</h2>
                <TicketForm
                  title={title}
                  onTitleChange={setTitle}
                  description={description}
                  onDescriptionChange={setDescription}
                  priority={priority}
                  onPriorityChange={setPriority}
                  assigneeId={assigneeId}
                  onAssigneeChange={setAssigneeId}
                  businessImpactScore={businessImpactScore}
                  onImpactScoreChange={setBusinessImpactScore}
                  impactedServices={impactedServices}
                  onImpactedServicesChange={setImpactedServices}
                  executiveSummary={executiveSummary}
                  onExecutiveSummaryChange={setExecutiveSummary}
                  users={users}
                  onSubmit={onCreateTicket}
                />

                <div className="table-wrap">
                  <table className="ticket-table">
                    <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Lifecycle</th><th>Priority</th><th>SLA Due</th><th>Assignee</th><th>Actions</th></tr></thead>
                    <tbody>
                      {tickets.map((t) => (
                        <tr key={t.id}>
                          <td>{t.id}</td>
                          <td>{t.title}</td>
                          <td>
                            {isAdmin ? (
                              <select value={t.status} onChange={(e) => onUpdateStatus(t.id, e.target.value)}>
                                <option value="open">open</option>
                                <option value="in_progress">in_progress</option>
                                <option value="resolved">resolved</option>
                                <option value="closed">closed</option>
                              </select>
                            ) : t.status}
                          </td>
                          <td><span className="badge badge-open">{t.lifecycleStage || 'identified'}</span></td>
                          <td><span className={`badge badge-${t.priority}`}>{t.priority}</span></td>
                          <td>{t.slaDueAt ? new Date(t.slaDueAt).toLocaleString() : 'n/a'} {t.breachedSla ? '(breached)' : ''}</td>
                          <td>{t.assignee?.scjId || t.assigneeId || 'Unassigned'}</td>
                              <td>
                                <div className="staff-actions">
                                  <button className="ghost-btn tiny-btn" onClick={() => openTicketWorkspace(t)}>Open Workspace</button>
                                  <button className="ghost-btn tiny-btn" onClick={() => onAnalyzeTicketWithAssistant(t.id)}>Ask AI</button>
                                  <button className="ghost-btn tiny-btn" disabled={assistantQuickBusy} onClick={() => onTendTicketWithAssistant(t.id)}>Tend Ticket</button>
                                </div>
                              </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedTicket && (
                  <div className="ticket-workspace">
                    <h3>Ticket #{selectedTicket.id} Workspace</h3>
                    <div className="lifecycle-controls">
                      <label>Lifecycle stage</label>
                      <select
                        value={selectedTicket.lifecycleStage || 'identified'}
                        onChange={(e) => onTransitionStage(selectedTicket.id, e.target.value)}
                      >
                        {LIFECYCLE_STAGES.map((stage) => (
                          <option key={stage} value={stage}>{stage}</option>
                        ))}
                      </select>
                    </div>
                    <div className="workspace-columns workspace-columns-3">
                      <div>
                        <h4>History</h4>
                        <ul className="history-list">
                          {historyItems.map((h) => (
                            <li key={h.id}><strong>{h.eventType}</strong><span>{h.reason}</span><time>{new Date(h.createdAt).toLocaleString()}</time></li>
                          ))}
                          {historyItems.length === 0 && <li><span>No history yet.</span></li>}
                        </ul>
                      </div>
                      <div>
                        <h4>Collaboration Notes</h4>
                        <form onSubmit={onAddComment} className="ticket-form">
                          <FieldWithHint help="Add investigation notes, decisions, or stakeholder updates so the next analyst understands current context.">
                            <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Add investigation or executive note" required />
                          </FieldWithHint>
                          <FieldWithHint help="Choose internal for technical responder notes, or executive for simplified business-facing notes.">
                            <select value={commentVisibility} onChange={(e) => setCommentVisibility(e.target.value)}>
                              <option value="internal">internal</option>
                              <option value="executive">executive</option>
                            </select>
                          </FieldWithHint>
                          <button type="submit">Add Note</button>
                        </form>
                        <ul className="history-list">
                          {ticketComments.map((c) => (
                            <li key={c.id}><strong>{c.authorName} ({c.visibility})</strong><span>{c.message}</span><time>{new Date(c.createdAt).toLocaleString()}</time></li>
                          ))}
                          {ticketComments.length === 0 && <li><span>No collaboration notes yet.</span></li>}
                        </ul>
                      </div>
                      <div>
                        <h4>Action Items</h4>
                        <form onSubmit={onAddActionItem} className="ticket-form">
                          <FieldWithHint help="Create a concrete next step that can be assigned, tracked, and marked complete.">
                            <input value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} placeholder="Action item title" required />
                          </FieldWithHint>
                          <FieldWithHint help="Choose who is accountable for completing this action.">
                            <select value={actionOwnerScjId} onChange={(e) => setActionOwnerScjId(e.target.value)}>
                              <option value="">Unassigned owner</option>
                              {users.filter((u) => u.scjId).map((u) => (
                                <option key={u.scjId} value={u.scjId}>{u.scjId} - {u.name} {u.surname}</option>
                              ))}
                            </select>
                          </FieldWithHint>
                          <FieldWithHint help="Optional due date to keep remediation work time-bound and auditable.">
                            <input type="datetime-local" value={actionDueAt} onChange={(e) => setActionDueAt(e.target.value)} />
                          </FieldWithHint>
                          <button type="submit">Create Item</button>
                        </form>
                        <ul className="history-list">
                          {ticketActionItems.map((item) => (
                            <li key={item.id}>
                              <strong>{item.title}</strong>
                              <span>Owner: {item.ownerScjId || 'unassigned'} | Due: {item.dueAt ? new Date(item.dueAt).toLocaleString() : 'n/a'}</span>
                              <div className="staff-actions">
                                <button className="ghost-btn tiny-btn" onClick={() => onSetActionItemStatus(item, 'open')}>open</button>
                                <button className="ghost-btn tiny-btn" onClick={() => onSetActionItemStatus(item, 'blocked')}>blocked</button>
                                <button className="ghost-btn tiny-btn" onClick={() => onSetActionItemStatus(item, 'done')}>done</button>
                              </div>
                            </li>
                          ))}
                          {ticketActionItems.length === 0 && <li><span>No action items yet.</span></li>}
                        </ul>
                        <p className="health-label">Open accountability items: {openActionItems.length}</p>
                      </div>
                    </div>
                    <div>
                      <h4>Resolution Report</h4>
                      {resolutionReport?.missing ? (
                        <p className="empty-state">No resolution report available yet. Reports are generated once the ticket is resolved/closed.</p>
                      ) : resolutionReport ? (
                        <pre className="report-box">{resolutionReport.reportText}</pre>
                      ) : (
                        <p className="empty-state">Loading report...</p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'governance' && (
              <section className="panel">
                <h2>Security Governance and Auditability</h2>
                <p className="onboarding-hint">What this tab does: it shows how well operations are controlled, who changed what, and whether accountability is working.</p>

                <div className="network-summary-grid">
                  <article className="stat-card"><p>Total Audit Events</p><strong>{governanceSummary.total}</strong></article>
                  <article className="stat-card"><p>Admin/Privileged Events</p><strong>{governanceSummary.privilegedActions}</strong></article>
                  <article className="stat-card"><p>Last Recorded Event</p><strong>{governanceSummary.lastEventAt ? new Date(governanceSummary.lastEventAt).toLocaleString() : 'n/a'}</strong></article>
                  <article className="stat-card"><p>Purpose</p><strong>Accountability + Compliance Evidence</strong></article>
                </div>

                <div className="workspace-columns">
                  <div>
                    <h4>Top Actions (What teams are doing most)</h4>
                    <ul className="history-list">
                      {governanceSummary.topActions.map(([name, count]) => (
                        <li key={`gov-action-${name}`}><strong>{name}</strong><span>{count} events</span></li>
                      ))}
                      {governanceSummary.topActions.length === 0 && <li><span>No action trends available yet.</span></li>}
                    </ul>
                  </div>
                  <div>
                    <h4>Top Entities (Where most activity happened)</h4>
                    <ul className="history-list">
                      {governanceSummary.topEntities.map(([name, count]) => (
                        <li key={`gov-entity-${name}`}><strong>{name}</strong><span>{count} events</span></li>
                      ))}
                      {governanceSummary.topEntities.length === 0 && <li><span>No entity trends available yet.</span></li>}
                    </ul>
                  </div>
                </div>

                <div className="workspace-columns">
                  <div>
                    <h4>Technical Report</h4>
                    <pre className="report-box">{JSON.stringify(technicalReportData || { message: 'Loading technical report' }, null, 2)}</pre>
                  </div>
                  <div>
                    <h4>Executive Report</h4>
                    {executiveReportData?.forbidden ? (
                      <p className="empty-state">Executive report access is restricted to administrators.</p>
                    ) : (
                      <pre className="report-box">{JSON.stringify(executiveReportData || { message: 'Loading executive report' }, null, 2)}</pre>
                    )}
                  </div>
                </div>
                <h4>Audit Log Stream</h4>
                {isAdmin ? (
                  <div className="table-wrap">
                    <p className="onboarding-hint">How to read audit logs: start with latest privileged actions, confirm actor and entity, then use details for incident timeline evidence.</p>
                    <table className="ticket-table">
                      <thead><tr><th>When</th><th>Actor</th><th>Entity</th><th>Action</th><th>Details</th></tr></thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{new Date(log.createdAt).toLocaleString()}</td>
                            <td>{log.actor} ({log.actorRole || 'n/a'})</td>
                            <td>{log.entityType}#{log.entityId}</td>
                            <td>{log.action}</td>
                            <td>{log.details || 'n/a'}</td>
                          </tr>
                        ))}
                        {auditLogs.length === 0 && <tr><td colSpan="5" className="empty-state">No audit events captured yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-state">Audit log access is restricted to administrators.</p>
                )}
              </section>
            )}

            {activeTab === 'assistant' && (
              <section className="panel">
                <h2>AI-Assisted Analyst Productivity</h2>
                <p className="onboarding-hint">How to read this: use command-centre recommendations for global priorities, then run ticket/alert analysis to accelerate assigned work.</p>

                <div className="workspace-columns">
                  <article className="stat-card">
                    <p>Open Tickets</p>
                    <strong>{assistantCommand?.summary?.openTickets || 0}</strong>
                    <p>Assigned to You: {assistantCommand?.summary?.assignedOpenTickets || 0}</p>
                  </article>
                  <article className="stat-card">
                    <p>Active Findings</p>
                    <strong>{assistantCommand?.summary?.activeFindings || 0}</strong>
                    <p>Blocked Actions: {assistantCommand?.summary?.blockedActions || 0}</p>
                  </article>
                  <article className="stat-card">
                    <p>Priority Action</p>
                    <strong>{assistantCommand?.priorityAction || 'n/a'}</strong>
                  </article>
                </div>

                <div className="workspace-columns">
                  <article className="stat-card">
                    <p>Fortress Incident Pressure</p>
                    <strong>{assistantCommand?.fortressContext?.incidentPressureScore || 0}</strong>
                    <p>Critical: {assistantCommand?.fortressContext?.criticalFindings || 0} | High: {assistantCommand?.fortressContext?.highFindings || 0}</p>
                  </article>
                  <article className="stat-card">
                    <p>Performance Hotspots</p>
                    <strong>{assistantCommand?.performanceContext?.slowRoutes?.length || 0}</strong>
                    <p>Routes tracked: {assistantCommand?.performanceContext?.routesTracked || 0}</p>
                  </article>
                  <article className="stat-card">
                    <p>Worst Route p95</p>
                    <strong>{assistantCommand?.performanceContext?.slowRoutes?.[0] ? `${assistantCommand.performanceContext.slowRoutes[0].p95Ms}ms` : 'n/a'}</strong>
                    <p>{assistantCommand?.performanceContext?.slowRoutes?.[0] ? `${assistantCommand.performanceContext.slowRoutes[0].method} ${assistantCommand.performanceContext.slowRoutes[0].route}` : 'No hotspot sampled'}</p>
                  </article>
                </div>

                <div className="workspace-columns">
                  <div>
                    <h4>Assigned Tickets (AI Focus)</h4>
                    <ul className="history-list">
                      {(assistantCommand?.assignedTickets || []).map((ticket) => (
                        <li key={ticket.id}>
                          <strong>#{ticket.id} {ticket.title}</strong>
                          <span>{ticket.priority} | {ticket.status} | {ticket.lifecycleStage}</span>
                          <div className="staff-actions">
                            <button className="ghost-btn tiny-btn" onClick={() => onAnalyzeTicketWithAssistant(ticket.id)}>Analyze Ticket</button>
                            <button className="ghost-btn tiny-btn" disabled={assistantQuickBusy} onClick={() => onTendTicketWithAssistant(ticket.id)}>Tend Ticket</button>
                          </div>
                        </li>
                      ))}
                      {(assistantCommand?.assignedTickets || []).length === 0 && <li><span>No assigned open tickets found.</span></li>}
                    </ul>
                  </div>
                  <div>
                    <h4>Top Alerts (AI Focus)</h4>
                    <ul className="history-list">
                      {(assistantCommand?.topFindings || []).map((alert) => (
                        <li key={alert.id}>
                          <strong>#{alert.id} {alert.title}</strong>
                          <span>{alert.severity} | {alert.status}</span>
                          <div className="staff-actions">
                            <button className="ghost-btn tiny-btn" onClick={() => onAnalyzeAlertWithAssistant(alert.id)}>Analyze Alert</button>
                            <button className="ghost-btn tiny-btn" disabled={assistantQuickBusy} onClick={() => onTendAlertWithAssistant(alert.id, currentUser?.scjId || '')}>Tend Alert</button>
                          </div>
                        </li>
                      ))}
                      {(assistantCommand?.topFindings || []).length === 0 && <li><span>No active alerts in assistant queue.</span></li>}
                    </ul>
                  </div>
                </div>

                <div className="ticket-form">
                  <textarea value={assistantNote} onChange={(e) => setAssistantNote(e.target.value)} placeholder="Optional analyst note to guide AI recommendations for ticket analysis" />
                </div>

                <form onSubmit={onGenerateAssistant} className="ticket-form">
                  <input value={assistantTitle} onChange={(e) => setAssistantTitle(e.target.value)} placeholder="Incident title" required />
                  <textarea value={assistantDescription} onChange={(e) => setAssistantDescription(e.target.value)} placeholder="Incident narrative, logs, and context" required />
                  <div className="staff-grid">
                    <select value={assistantPriority} onChange={(e) => setAssistantPriority(e.target.value)}>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="critical">critical</option>
                    </select>
                    <input type="number" min="0" max="100" value={assistantImpact} onChange={(e) => setAssistantImpact(e.target.value)} placeholder="Business impact score" />
                  </div>
                  <button type="submit">Generate Triage Guidance</button>
                </form>
                {assistantOutput && (
                  <div className="workspace-columns">
                    <article className="stat-card">
                      <p>Urgency Score</p>
                      <strong>{assistantOutput.urgencyScore}</strong>
                      <p>Confidence: {assistantOutput.confidence}</p>
                    </article>
                    <article className="stat-card">
                      <p>Recommended Stage</p>
                      <strong>{assistantOutput.recommendedStage}</strong>
                      <p>{assistantOutput.plainLanguageBrief}</p>
                    </article>
                  </div>
                )}
                {assistantOutput?.recommendedActions && (
                  <ul className="history-list">
                    {assistantOutput.recommendedActions.map((item, i) => (
                      <li key={`${item}-${i}`}><strong>Action {i + 1}</strong><span>{item}</span></li>
                    ))}
                  </ul>
                )}

                {assistantTicketOutput && (
                  <div className="panel ai-output-panel">
                    <h3>Ticket Coaching Output</h3>
                    <p><strong>Ticket:</strong> #{assistantTicketOutput.ticket?.id} {assistantTicketOutput.ticket?.title}</p>
                    <p>
                      <strong>Urgency:</strong> {assistantTicketOutput.urgencyScore ?? 'n/a'}
                      {' | '}
                      <strong>Next Stage:</strong> {assistantTicketOutput.nextStage || assistantTicketOutput.appliedChanges?.lifecycleStage || 'n/a'}
                    </p>
                    <p>{assistantTicketOutput.coaching || assistantTicketOutput.actionSummary}</p>
                    <ul className="history-list">
                      {(assistantTicketOutput.productivityPlan || assistantTicketOutput.recommendedActions || []).map((step, idx) => (
                        <li key={`ticket-plan-${idx}`}><strong>Plan {idx + 1}</strong><span>{step}</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                {assistantAlertOutput && (
                  <div className="panel ai-output-panel">
                    <h3>Alert Analysis Output</h3>
                    <p><strong>Alert:</strong> #{assistantAlertOutput.finding?.id} {assistantAlertOutput.finding?.title}</p>
                    <p><strong>Urgency:</strong> {assistantAlertOutput.urgencyScore ?? 'n/a'}</p>
                    <p>{assistantAlertOutput.interpretation || assistantAlertOutput.actionSummary}</p>
                    {assistantAlertOutput.linkedTicketId && <p><strong>Linked Ticket:</strong> #{assistantAlertOutput.linkedTicketId}</p>}
                    <ul className="history-list">
                      {(assistantAlertOutput.recommendedActions || []).map((step, idx) => (
                        <li key={`alert-plan-${idx}`}><strong>Action {idx + 1}</strong><span>{step}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App
