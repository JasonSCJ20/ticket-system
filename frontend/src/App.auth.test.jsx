import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import {
  createAccount,
  login,
  forgotUsername,
  requestPasswordReset,
  resetPassword,
  fetchCurrentUser,
  fetchTickets,
  createTicket,
  fetchTicketHistory,
  fetchTicketResolutionReport,
  fetchExecutiveTicketMetrics,
  transitionTicketLifecycle,
  fetchTicketComments,
  addTicketComment,
  fetchTicketActionItems,
  createTicketActionItem,
  updateTicketActionItem,
  updateTicket,
  fetchUsers,
  createUser,
  preloadUsers,
  fetchSecurityHealthSummary,
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
} from './api'

vi.mock('./api', () => ({
  login: vi.fn(),
  createAccount: vi.fn(),
  forgotUsername: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchTickets: vi.fn(),
  createTicket: vi.fn(),
  fetchTicketHistory: vi.fn(),
  fetchTicketResolutionReport: vi.fn(),
  fetchExecutiveTicketMetrics: vi.fn(),
  transitionTicketLifecycle: vi.fn(),
  fetchTicketComments: vi.fn(),
  addTicketComment: vi.fn(),
  fetchTicketActionItems: vi.fn(),
  createTicketActionItem: vi.fn(),
  updateTicketActionItem: vi.fn(),
  updateTicket: vi.fn(),
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  preloadUsers: vi.fn(),
  fetchSecurityHealthSummary: vi.fn(),
  fetchExecutiveImpact: vi.fn(),
  fetchSecurityApplications: vi.fn(),
  fetchThreatIntelOverview: vi.fn(),
  fetchNetworkVisibilityOverview: vi.fn(),
  fetchNetworkDevices: vi.fn(),
  registerNetworkDevice: vi.fn(),
  runDevicePassiveScan: vi.fn(),
  runDeviceIdsIpsCheck: vi.fn(),
  fetchDatabaseOverview: vi.fn(),
  registerDatabaseAsset: vi.fn(),
  runDatabaseSecurityScan: vi.fn(),
  fetchPatchTasks: vi.fn(),
  createPatchTask: vi.fn(),
  updatePatchTaskStatus: vi.fn(),
  registerSecurityApplication: vi.fn(),
  runPassiveSecurityScan: vi.fn(),
  runActiveSecurityScan: vi.fn(),
  fetchSecurityFindings: vi.fn(),
  updateFindingStatus: vi.fn(),
  confirmSecurityFinding: vi.fn(),
  createTicketFromFinding: vi.fn(),
  fetchExecutiveReport: vi.fn(),
  fetchTechnicalReport: vi.fn(),
  fetchAuditLogs: vi.fn(),
  generateAssistantTriage: vi.fn(),
  fetchAssistantCommandCentre: vi.fn(),
  analyzeAssistantTicket: vi.fn(),
  analyzeAssistantAlert: vi.fn(),
}))

beforeEach(() => {
  localStorage.clear()
  login.mockReset()
  createAccount.mockReset()
  forgotUsername.mockReset()
  requestPasswordReset.mockReset()
  resetPassword.mockReset()
  fetchCurrentUser.mockReset()
  fetchTickets.mockReset()
  createTicket.mockReset()
  fetchTicketHistory.mockReset()
  fetchTicketResolutionReport.mockReset()
  fetchExecutiveTicketMetrics.mockReset()
  transitionTicketLifecycle.mockReset()
  fetchTicketComments.mockReset()
  addTicketComment.mockReset()
  fetchTicketActionItems.mockReset()
  createTicketActionItem.mockReset()
  updateTicketActionItem.mockReset()
  updateTicket.mockReset()
  fetchUsers.mockReset()
  createUser.mockReset()
  preloadUsers.mockReset()
  fetchSecurityHealthSummary.mockReset()
  fetchExecutiveImpact.mockReset()
  fetchSecurityApplications.mockReset()
  fetchThreatIntelOverview.mockReset()
  fetchNetworkVisibilityOverview.mockReset()
  fetchNetworkDevices.mockReset()
  registerNetworkDevice.mockReset()
  runDevicePassiveScan.mockReset()
  runDeviceIdsIpsCheck.mockReset()
  fetchDatabaseOverview.mockReset()
  registerDatabaseAsset.mockReset()
  runDatabaseSecurityScan.mockReset()
  fetchPatchTasks.mockReset()
  createPatchTask.mockReset()
  updatePatchTaskStatus.mockReset()
  registerSecurityApplication.mockReset()
  runPassiveSecurityScan.mockReset()
  runActiveSecurityScan.mockReset()
  fetchSecurityFindings.mockReset()
  updateFindingStatus.mockReset()
  confirmSecurityFinding.mockReset()
  createTicketFromFinding.mockReset()
  fetchExecutiveReport.mockReset()
  fetchTechnicalReport.mockReset()
  fetchAuditLogs.mockReset()
  generateAssistantTriage.mockReset()
  fetchAssistantCommandCentre.mockReset()
  analyzeAssistantTicket.mockReset()
  analyzeAssistantAlert.mockReset()
})

describe('App account creation policy', () => {
  test('blocks registration when email is outside the nhne domain', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    await user.type(screen.getByPlaceholderText('First Name'), 'Jane')
    await user.type(screen.getByPlaceholderText('Surname'), 'Doe')
    await user.type(screen.getByPlaceholderText('SCJ ID (00000000-00000)'), '00000000-00000')
    await user.type(screen.getByPlaceholderText('Email (@nhne.org.za)'), 'jane@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'StrongPassword1!')
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'StrongPassword1!')
    await user.click(screen.getByRole('button', { name: 'Create Account' }))

    expect(createAccount).not.toHaveBeenCalled()
    expect(screen.getByText('Email address must use the @nhne.org.za domain')).toBeInTheDocument()
  })

  test('submits derived username and required identity fields for valid registration', async () => {
    const user = userEvent.setup()
    createAccount.mockResolvedValue({ ok: true })

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    await user.type(screen.getByPlaceholderText('First Name'), 'Jane')
    await user.type(screen.getByPlaceholderText('Surname'), 'Doe')
    await user.type(screen.getByPlaceholderText('SCJ ID (00000000-00000)'), '00000000-00000')
    await user.type(screen.getByPlaceholderText('Email (@nhne.org.za)'), 'jane@nhne.org.za')
    await user.type(screen.getByPlaceholderText('Password'), 'StrongPassword1!')
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'StrongPassword1!')

    expect(screen.getByPlaceholderText('Derived Username')).toHaveValue('Jane Doe')

    await user.click(screen.getByRole('button', { name: 'Create Account' }))

    expect(createAccount).toHaveBeenCalledWith({
      username: 'Jane Doe',
      name: 'Jane',
      surname: 'Doe',
      scjId: '00000000-00000',
      email: 'jane@nhne.org.za',
      password: 'StrongPassword1!',
    })
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Username')).toHaveValue('Jane Doe')
  })
})
