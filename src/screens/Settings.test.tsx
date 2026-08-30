import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { settingsGetMock, settingsUpdateMock } = vi.hoisted(() => ({
  settingsGetMock: vi.fn(),
  settingsUpdateMock: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: { settings: { get: settingsGetMock, update: settingsUpdateMock } },
}))

vi.mock('@/lib/auth', () => ({
  useSession: () => ({
    user: { id: 'u1', email: 'sam@hupo.app' },
    session: null,
    loading: false,
  }),
}))

// The Developer section is lazy-loaded behind a dev gate; stub it so the
// test doesn't pull in sample-data machinery.
vi.mock('@/components/DeveloperSection', () => ({ default: () => null }))

import Settings from './Settings'

describe('Settings — AI key', () => {
  beforeEach(() => {
    settingsGetMock.mockResolvedValue({
      userId: 'u1',
      aiApiKey: 'sk-ant-existing',
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
    })
    settingsUpdateMock.mockImplementation(async (_id, changes) => ({
      userId: 'u1',
      aiApiKey: null,
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
      ...changes,
    }))
  })
  afterEach(() => vi.clearAllMocks())

  it('loads the existing key into the field', async () => {
    render(<Settings />)
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/anthropic api key/i) as HTMLInputElement).value,
      ).toBe('sk-ant-existing'),
    )
  })

  it('discloses what triage sends to Anthropic — titles, not notes (PRIV-04)', async () => {
    render(<Settings />)
    expect(await screen.findByText(/task titles/i)).toBeInTheDocument()
    expect(screen.getByText(/never your notes/i)).toBeInTheDocument()
  })

  it('saves a new key via repo.settings.update', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('sk-ant-existing'),
    )
    await user.clear(input)
    await user.type(input, 'sk-ant-new')
    await user.click(screen.getByRole('button', { name: /save key/i }))
    await waitFor(() =>
      expect(settingsUpdateMock).toHaveBeenCalledWith('u1', {
        aiApiKey: 'sk-ant-new',
      }),
    )
  })

  it('stores null (not an empty string) when the key is cleared', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('sk-ant-existing'),
    )
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: /save key/i }))
    await waitFor(() =>
      expect(settingsUpdateMock).toHaveBeenCalledWith('u1', { aiApiKey: null }),
    )
  })

  it('reveals the key when the show toggle is pressed', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    expect(input).toHaveAttribute('type', 'password')
    // Specific to the AI-key toggle — the Calendar section (chunk 13) adds its
    // own "Show password" toggle, so a bare /show/ query would now be ambiguous.
    await user.click(screen.getByRole('button', { name: /show api key/i }))
    expect(input).toHaveAttribute('type', 'text')
  })
})

/**
 * Chunk 30 — Daylight re-skin guard. Behavioral only (text/roles, not colors):
 * the new Account section is present and wired; the dropped dark/Appearance
 * toggle never returns (Decision A); and every real section still renders its
 * serif SettingsSection heading.
 */
describe('Settings — re-skin (chunk 30)', () => {
  beforeEach(() => {
    settingsGetMock.mockResolvedValue({
      userId: 'u1',
      aiApiKey: null,
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
    })
    settingsUpdateMock.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('renders the Account section with the email and a Sign out button', async () => {
    render(<Settings />)
    // Let the async settings loads settle before asserting.
    expect(
      await screen.findByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()
    // Email shows in the header `.label` and again in the Account row.
    expect(screen.getAllByText('sam@hupo.app').length).toBeGreaterThanOrEqual(2)
  })

  it('has no dark-mode / Appearance control (Decision A regression guard)', async () => {
    render(<Settings />)
    await screen.findByRole('button', { name: /sign out/i })
    expect(screen.queryByText(/appearance/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^dark$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^light$/i })).toBeNull()
  })

  it('renders the Outlook rows inside the Calendars section', async () => {
    render(<Settings />)
    await screen.findByRole('button', { name: /sign out/i })
    expect(screen.getByText('Outlook (work)')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /verify & save/i }),
    ).toBeInTheDocument()
  })

  it('renders each real section heading', async () => {
    render(<Settings />)
    await screen.findByRole('button', { name: /sign out/i })
    expect(
      screen.getByRole('heading', { name: /account/i }),
    ).toBeInTheDocument()
    // Chunk 35: section 02 renamed "Apple Calendar" → "Calendars" (it now
    // holds the Apple rows + the Outlook feed rows).
    expect(
      screen.getByRole('heading', { name: /calendars/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /ai assist/i })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /notifications/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^data$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /about/i })).toBeInTheDocument()
  })
})

/**
 * Chunk 35 — Outlook feed badge states. Mocked repo only; the three
 * `outlookStatus` values drive the badge copy (DESIGN_NOTES § stale feed:
 * unreachable is amber/stale, never destructive/lost).
 */
describe('Settings — Outlook feed (chunk 35)', () => {
  function mockSettings(over: Record<string, unknown> = {}) {
    settingsGetMock.mockResolvedValue({
      userId: 'u1',
      aiApiKey: null,
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      outlookStatus: 'unconfigured',
      outlookFeedName: null,
      outlookFetchedAt: null,
      timezone: 'America/New_York',
      lastDailyReset: null,
      ...over,
    })
  }
  afterEach(() => vi.clearAllMocks())

  it('shows "Not connected" when unconfigured, with no Disconnect button', async () => {
    mockSettings()
    render(<Settings />)
    expect(await screen.findByText('Not connected')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /disconnect$/i }),
    ).toBeNull()
  })

  it('shows the connected badge with feed name and refreshed age when ok', async () => {
    mockSettings({
      outlookStatus: 'ok',
      outlookFeedName: 'Meetings — S. Ríos',
      outlookFetchedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    })
    render(<Settings />)
    expect(
      await screen.findByText(/connected · meetings — s\. ríos/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/last refreshed 12m ago/i)).toBeInTheDocument()
  })

  it('shows the amber unreachable state with the cached-data explanation', async () => {
    mockSettings({
      outlookStatus: 'unreachable',
      outlookFeedName: 'Meetings — S. Ríos',
      outlookFetchedAt: '2026-07-30T09:14:00.000Z',
    })
    render(<Settings />)
    expect(
      await screen.findByText(/feed unreachable since/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/showing busy times cached at/i),
    ).toBeInTheDocument()
  })

  it('never prefills the ICS link input (write-only URL)', async () => {
    mockSettings({
      outlookStatus: 'ok',
      outlookFeedName: 'Meetings — S. Ríos',
      outlookFetchedAt: new Date().toISOString(),
    })
    render(<Settings />)
    await screen.findByText(/connected · meetings/i)
    expect(
      (screen.getByLabelText(/outlook ics link/i) as HTMLInputElement).value,
    ).toBe('')
  })
})

describe('Settings — planner write-out row (chunk 39)', () => {
  function mockSettings(over: Record<string, unknown> = {}) {
    settingsGetMock.mockResolvedValue({
      userId: 'u1',
      aiApiKey: null,
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      outlookStatus: 'unconfigured',
      outlookFeedName: null,
      outlookFetchedAt: null,
      plannerWriteout: false,
      timezone: 'America/New_York',
      lastDailyReset: null,
      ...over,
    })
    settingsUpdateMock.mockImplementation(async (_id, changes) => ({
      userId: 'u1',
      ...changes,
    }))
  }
  afterEach(() => vi.clearAllMocks())

  const group = () =>
    screen.getByRole('group', { name: 'Write planner blocks to Apple Calendar' })
  const onBtn = () => screen.getByRole('button', { name: 'On' })
  const offBtn = () => screen.getByRole('button', { name: 'Off' })

  it('is disabled with a hint when Apple Calendar is not connected', async () => {
    mockSettings()
    render(<Settings />)
    await screen.findByText('Write planner blocks to Apple Calendar')
    expect(group()).toBeInTheDocument()
    expect(onBtn()).toBeDisabled()
    expect(offBtn()).toBeDisabled()
    expect(screen.getByText('Connect Apple Calendar to enable.')).toBeInTheDocument()
    expect(
      screen.getByText(/excluded from busy time so they aren't counted twice/i),
    ).toBeInTheDocument()
  })

  it('stays disabled while the connection is auth_failed', async () => {
    mockSettings({ caldavAppleId: 'me@icloud.com', caldavStatus: 'auth_failed' })
    render(<Settings />)
    await screen.findByText('Write planner blocks to Apple Calendar')
    expect(onBtn()).toBeDisabled()
    expect(offBtn()).toBeDisabled()
  })

  it('turning it on writes plannerWriteout: true and bumps the busy cache', async () => {
    mockSettings({
      caldavAppleId: 'me@icloud.com',
      caldavCalendarUrl: 'https://caldav.icloud.com/1/calendars/home/',
      caldavStatus: 'ok',
    })
    const { useUIStore } = await import('@/state/uiStore')
    const before = useUIStore.getState().busyRefreshKey
    render(<Settings />)
    await screen.findByText('Write planner blocks to Apple Calendar')
    expect(onBtn()).toBeEnabled()
    expect(offBtn()).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(onBtn())
    await waitFor(() =>
      expect(settingsUpdateMock).toHaveBeenCalledWith('u1', { plannerWriteout: true }),
    )
    expect(onBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(useUIStore.getState().busyRefreshKey).toBe(before + 1)
  })

  it('turning it off writes plannerWriteout: false without a busy bump', async () => {
    mockSettings({
      caldavAppleId: 'me@icloud.com',
      caldavCalendarUrl: 'https://caldav.icloud.com/1/calendars/home/',
      caldavStatus: 'ok',
      plannerWriteout: true,
    })
    const { useUIStore } = await import('@/state/uiStore')
    const before = useUIStore.getState().busyRefreshKey
    render(<Settings />)
    await screen.findByText('Write planner blocks to Apple Calendar')
    expect(onBtn()).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(offBtn())
    await waitFor(() =>
      expect(settingsUpdateMock).toHaveBeenCalledWith('u1', { plannerWriteout: false }),
    )
    expect(useUIStore.getState().busyRefreshKey).toBe(before)
  })
})
