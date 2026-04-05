import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import {
  createTicket,
  fetchTicketHistory,
  fetchTickets,
  login,
  updateTicket,
} from './api'

vi.mock('./api', () => ({
  login: vi.fn(),
  fetchTickets: vi.fn(),
  createTicket: vi.fn(),
  updateTicket: vi.fn(),
  fetchTicketHistory: vi.fn(),
}))

function makeToken(role = 'admin') {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ sub: 1, username: 'user', role }))
  return `${header}.${payload}.sig`
}

function seedLoggedIn(role = 'admin') {
  localStorage.setItem('access_token', makeToken(role))
}

function makeTicket(overrides = {}) {
  return {
    id: 1,
    title: 'Incident A',
    description: 'A detailed incident description',
    status: 'open',
    priority: 'high',
    assigneeId: 2,
    createdAt: '2026-04-04T07:00:00.000Z',
    updatedAt: '2026-04-04T08:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

test('logs in and loads dashboard', async () => {
  login.mockImplementation(async () => {
    localStorage.setItem('access_token', makeToken('admin'))
    return { access_token: 'ok' }
  })
  fetchTickets.mockResolvedValue([])

  render(<App />)

  await userEvent.type(screen.getByPlaceholderText('Username'), 'admin_test')
  await userEvent.type(screen.getByPlaceholderText('Password'), 'password123')
  await userEvent.click(screen.getByRole('button', { name: 'Login' }))

  await waitFor(() => {
    expect(screen.getByText(/secure session active/i)).toBeInTheDocument()
  })
  expect(login).toHaveBeenCalledWith('admin_test', 'password123')
})

test('creates a ticket and refreshes list', async () => {
  seedLoggedIn('admin')
  fetchTickets
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([makeTicket({ id: 2, title: 'Fresh Incident' })])
  createTicket.mockResolvedValue({ id: 2 })

  render(<App />)

  await userEvent.type(screen.getByPlaceholderText('Title (min 5 chars)'), 'Fresh Incident')
  await userEvent.type(screen.getByPlaceholderText('Description (min 10 chars)'), 'A newly created ticket description')
  await userEvent.click(screen.getByRole('button', { name: 'Create Ticket' }))

  await waitFor(() => {
    expect(createTicket).toHaveBeenCalled()
  })
  await waitFor(() => {
    expect(screen.getByText('Fresh Incident')).toBeInTheDocument()
  })
})

test('filters tickets by status', async () => {
  seedLoggedIn('admin')
  fetchTickets.mockResolvedValue([
    makeTicket({ id: 11, title: 'Open Item', status: 'open' }),
    makeTicket({ id: 12, title: 'Resolved Item', status: 'resolved' }),
  ])

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText('Open Item')).toBeInTheDocument()
    expect(screen.getByText('Resolved Item')).toBeInTheDocument()
  })

  await userEvent.selectOptions(screen.getByDisplayValue('All statuses'), 'resolved')

  await waitFor(() => {
    expect(screen.queryByText('Open Item')).not.toBeInTheDocument()
    expect(screen.getByText('Resolved Item')).toBeInTheDocument()
  })
})

test('admin can update ticket status inline', async () => {
  seedLoggedIn('admin')
  fetchTickets.mockResolvedValue([makeTicket({ id: 21, status: 'open' })])
  updateTicket.mockResolvedValue(makeTicket({ id: 21, status: 'resolved' }))

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText('Incident A')).toBeInTheDocument()
  })

  const statusControls = screen.getAllByDisplayValue('open')
  await userEvent.selectOptions(statusControls[0], 'resolved')

  await waitFor(() => {
    expect(updateTicket).toHaveBeenCalledWith(21, { status: 'resolved' })
  })
})

test('analyst sees read-only status with role lock', async () => {
  seedLoggedIn('analyst')
  fetchTickets.mockResolvedValue([makeTicket({ id: 31 })])

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText(/status updates are admin-only/i)).toBeInTheDocument()
  })
  expect(screen.queryByDisplayValue('open')).not.toBeInTheDocument()
})

test('opens ticket history drawer', async () => {
  seedLoggedIn('admin')
  fetchTickets.mockResolvedValue([makeTicket({ id: 41 })])
  fetchTicketHistory.mockResolvedValue([
    { id: 1, eventType: 'created', reason: 'Created by API', createdAt: '2026-04-04T08:00:00.000Z' },
  ])

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText('Incident A')).toBeInTheDocument()
  })

  await userEvent.click(screen.getByRole('button', { name: 'View' }))

  await waitFor(() => {
    expect(fetchTicketHistory).toHaveBeenCalledWith(41)
    expect(screen.getByRole('dialog', { name: /ticket history drawer/i })).toBeInTheDocument()
    expect(screen.getByText('Created by API')).toBeInTheDocument()
  })
})
