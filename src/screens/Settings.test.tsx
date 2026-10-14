import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
// test doesn't pull in sample-data machinery. Chunk 79's kicker case renders
// the real section (`devSection.real`) with sample-data stubbed instead.
const { devSection } = vi.hoisted(() => ({ devSection: { real: false } }))
vi.mock('@/lib/sample-data', () => ({
  loadSampleData: vi.fn(),
  wipeMyData: vi.fn(),
}))
vi.mock('@/components/DeveloperSection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/DeveloperSection')>()
  const Real = actual.default
  return { default: () => (devSection.real ? <Real /> : null) }
})

// Chunk 51: the write-target row's label test drives the Test-connection
// flow, so discovery is stubbed; everything else in calendarApi stays real.
const { testCredentialsMock } = vi.hoisted(() => ({ testCredentialsMock: vi.fn() }))
vi.mock('@/lib/calendarApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/calendarApi')>()
  return { ...actual, testCredentials: testCredentialsMock }
})

// Chunk 55: the key goes to the proxy, never through the repo. Keep the real
// AiError; stub only the two network calls.
const { saveAiKeyMock, removeAiKeyMock } = vi.hoisted(() => ({
  saveAiKeyMock: vi.fn(),
  removeAiKeyMock: vi.fn(),
}))
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return { ...actual, saveAiKey: saveAiKeyMock, removeAiKey: removeAiKeyMock }
})

// Chunk 62: only the import's network half is stubbed; `validateImport` and
// `previewCounts` stay real so the file picker and the dialog behave as shipped.
const { importDataMock } = vi.hoisted(() => ({ importDataMock: vi.fn() }))
vi.mock('@/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import')>()
  return { ...actual, importData: importDataMock }
})

import { Toaster } from 'sonner'

import Settings from './Settings'
import { AiError } from '@/lib/ai'

describe('Settings — AI key (chunk 55, write-only)', () => {
  const base = {
    userId: 'u1',
    caldavAppleId: null,
    caldavCalendarUrl: null,
    caldavStatus: 'unconfigured',
    timezone: 'America/New_York',
    lastDailyReset: null,
  }
  const withStatus = (aiStatus: string) => ({ ...base, aiStatus })
  const aiSection = () =>
    screen.getByRole('heading', { name: /ai assist/i }).closest('section')!

  beforeEach(() => {
    settingsGetMock.mockResolvedValue(withStatus('unconfigured'))
    saveAiKeyMock.mockResolvedValue(undefined)
    removeAiKeyMock.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('discloses what triage sends to Anthropic — titles, not notes (PRIV-04)', async () => {
    render(<Settings />)
    expect(await screen.findByText(/task titles/i)).toBeInTheDocument()
    expect(screen.getByText(/never your notes/i)).toBeInTheDocument()
    expect(
      screen.getByText(/encrypted and stored server-side; never sent back/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Uses the latest Claude Haiku')).toBeInTheDocument()
  })

  it('unconfigured: empty password input + Save key, no Replace/Remove, no reveal toggle', async () => {
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'password')
    const section = within(aiSection())
    expect(section.getByRole('button', { name: /save key/i })).toBeDisabled()
    expect(section.queryByRole('button', { name: /replace/i })).toBeNull()
    expect(section.queryByRole('button', { name: /remove/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /show api key/i })).toBeNull()
    expect(section.queryByText(/key saved/i)).toBeNull()
  })

  it('ok: "Key saved" with Replace + Remove and no input or value', async () => {
    settingsGetMock.mockResolvedValue(withStatus('ok'))
    render(<Settings />)
    const section = within(aiSection())
    expect(await section.findByText('Key saved')).toBeInTheDocument()
    expect(section.getByRole('button', { name: /replace/i })).toBeInTheDocument()
    expect(section.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/anthropic api key/i)).toBeNull()
    expect(section.queryByRole('button', { name: /save key/i })).toBeNull()
  })

  it('auth_failed: says Anthropic rejected the saved key, with Replace + Remove', async () => {
    settingsGetMock.mockResolvedValue(withStatus('auth_failed'))
    render(<Settings />)
    const section = within(aiSection())
    expect(
      await section.findByText('Anthropic rejected the saved key'),
    ).toBeInTheDocument()
    expect(section.getByRole('button', { name: /replace/i })).toBeInTheDocument()
    expect(section.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/anthropic api key/i)).toBeNull()
  })

  it('Save posts the trimmed key to the proxy, then refetches settings (never optimistic)', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    await waitFor(() => expect(settingsGetMock).toHaveBeenCalled())
    const getsBefore = settingsGetMock.mock.calls.length
    settingsGetMock.mockResolvedValue(withStatus('ok'))

    await user.type(input, '  sk-ant-new ')
    await user.click(screen.getByRole('button', { name: /save key/i }))

    await waitFor(() => expect(saveAiKeyMock).toHaveBeenCalledWith('sk-ant-new'))
    const section = within(aiSection())
    expect(await section.findByText('Key saved')).toBeInTheDocument()
    expect(settingsGetMock.mock.calls.length).toBeGreaterThan(getsBefore)
    expect(settingsUpdateMock).not.toHaveBeenCalled()
    // Write-only: the field is gone and the key is not retained.
    expect(screen.queryByLabelText(/anthropic api key/i)).toBeNull()
  })

  it('a rejected key stays unconfigured — status comes from the refetch, not the click', async () => {
    saveAiKeyMock.mockRejectedValue(new AiError('auth'))
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    await user.type(input, 'sk-ant-bad')
    await user.click(screen.getByRole('button', { name: /save key/i }))
    await waitFor(() => expect(saveAiKeyMock).toHaveBeenCalled())
    expect(within(aiSection()).queryByText('Key saved')).toBeNull()
    expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument()
  })

  it('Replace reveals an empty input + Save, which posts the new key', async () => {
    settingsGetMock.mockResolvedValue(withStatus('auth_failed'))
    const user = userEvent.setup()
    render(<Settings />)
    const section = within(aiSection())
    await user.click(await section.findByRole('button', { name: /replace/i }))
    const input = screen.getByLabelText(/anthropic api key/i)
    expect(input).toHaveValue('')

    settingsGetMock.mockResolvedValue(withStatus('ok'))
    await user.type(input, 'sk-ant-replacement')
    await user.click(section.getByRole('button', { name: /save key/i }))
    await waitFor(() =>
      expect(saveAiKeyMock).toHaveBeenCalledWith('sk-ant-replacement'),
    )
    expect(await section.findByText('Key saved')).toBeInTheDocument()
  })

  it('Remove calls DELETE on the proxy, then refetches', async () => {
    settingsGetMock.mockResolvedValue(withStatus('ok'))
    const user = userEvent.setup()
    render(<Settings />)
    const section = within(aiSection())
    const removeBtn = await section.findByRole('button', { name: /remove/i })
    const getsBefore = settingsGetMock.mock.calls.length
    settingsGetMock.mockResolvedValue(withStatus('unconfigured'))

    await user.click(removeBtn)

    await waitFor(() => expect(removeAiKeyMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByLabelText(/anthropic api key/i)).toHaveValue('')
    expect(settingsGetMock.mock.calls.length).toBeGreaterThan(getsBefore)
    expect(section.queryByText('Key saved')).toBeNull()
    expect(settingsUpdateMock).not.toHaveBeenCalled()
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
      aiStatus: 'unconfigured',
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
    // Chunk 79: the Account row is the page's one copy of the email (the
    // header `.label` under the h1 is gone).
    expect(screen.getAllByText('sam@hupo.app')).toHaveLength(1)
  })

  // Chunk 79 (D6): main sections numbered in render order; Developer and
  // About take word kickers, like Sync issues. vitest runs with DEV, so the
  // Developer section renders.
  it('numbers the section kickers 01–06, then Developer and About', async () => {
    devSection.real = true
    try {
      const { container } = render(<Settings />)
      await screen.findByRole('heading', { name: 'Developer' })
      const kickers = Array.from(
        container.querySelectorAll('section > header > .label'),
      ).map((el) => el.textContent)
      expect(kickers).toEqual([
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        'Developer',
        'About',
      ])
    } finally {
      devSection.real = false
    }
  })

  // Chunk 79 (D5): rows stack below `sm` and keep today's two columns from
  // `sm` up, as a Tailwind class instead of an inline grid template.
  it('lays SettingsRow out with sm: grid classes, not an inline template', async () => {
    render(<Settings />)
    await screen.findByRole('button', { name: /sign out/i })
    const row = screen.getByText('Email', { selector: 'div' }).parentElement!
      .parentElement!
    expect(row.style.gridTemplateColumns).toBe('')
    expect(row.getAttribute('style') ?? '').not.toMatch(/grid-template-columns/)
    expect(row.className).toMatch(/(^|\s)sm:grid-cols-\[/)
    expect(row.lastElementChild).toHaveClass('min-w-0')
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
      aiStatus: 'unconfigured',
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
      aiStatus: 'unconfigured',
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
  // Scoped inside the write-out group: the Today-list layout pills (merged in
  // from main) also expose a button named "Off" at the screen level.
  const onBtn = () => within(group()).getByRole('button', { name: 'On' })
  const offBtn = () => within(group()).getByRole('button', { name: 'Off' })

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

/**
 * Chunk 51 — the Settings dropdown is the WRITE target only; the READ set
 * lives on the Planner. The label and help text say so, and disconnecting
 * clears the read set with the connection.
 */
describe('Settings — write target vs read set (chunk 51)', () => {
  const base = {
    userId: 'u1',
    aiStatus: 'unconfigured',
    caldavAppleId: null,
    caldavCalendarUrl: null,
    caldavReadCalendars: null,
    caldavStatus: 'unconfigured' as const,
    outlookStatus: 'unconfigured' as const,
    outlookFeedName: null,
    outlookFetchedAt: null,
    plannerWriteout: false,
    timezone: 'America/New_York',
    lastDailyReset: null,
  }
  beforeEach(() => {
    settingsGetMock.mockResolvedValue(base)
    settingsUpdateMock.mockImplementation(async (_id, changes) => ({ ...base, ...changes }))
  })
  afterEach(() => vi.clearAllMocks())

  it('labels the dropdown "Planner writes to" with the read-set help text after Test connection', async () => {
    const user = userEvent.setup()
    testCredentialsMock.mockResolvedValue({
      calendars: [
        { url: 'https://cal/home/', name: 'Home' },
        { url: 'https://cal/work/', name: 'Work' },
      ],
    })
    render(<Settings />)
    await user.type(await screen.findByLabelText('Apple ID'), 'me@icloud.com')
    await user.type(screen.getByLabelText('App-specific password'), 'xxxx-xxxx')
    await user.click(screen.getByRole('button', { name: /test connection/i }))
    const select = await screen.findByRole('combobox', { name: 'Planner writes to' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Home',
      'Work',
    ])
    expect(
      screen.getByText(
        /Blocks you schedule on the Planner are created on this calendar\. Which calendars the Planner reads is set on the Planner itself\./,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Calendar' })).toBeNull()
  })

  it('Disconnect clears the read set along with the connection', async () => {
    const user = userEvent.setup()
    settingsGetMock.mockResolvedValue({
      ...base,
      caldavAppleId: 'me@icloud.com',
      caldavCalendarUrl: 'https://cal/home/',
      caldavReadCalendars: [{ url: 'https://cal/home/', name: 'Home', enabled: true }],
      caldavStatus: 'ok',
    })
    render(<Settings />)
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() =>
      expect(settingsUpdateMock).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          caldavAppleId: null,
          caldavCalendarUrl: null,
          caldavReadCalendars: null,
          caldavStatus: 'unconfigured',
        }),
      ),
    )
  })
})

describe('Settings — Replace failure toast (chunk 62)', () => {
  beforeEach(() => {
    settingsGetMock.mockResolvedValue({
      userId: 'u1',
      aiStatus: 'unconfigured',
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('a confirmed Replace that fails says nothing was changed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    importDataMock.mockRejectedValue(new Error('23503'))
    const file = {
      version: 1,
      categories: [],
      subcategories: [],
      tasks: [{ id: 't1' }],
      routine_items: [],
      routine_logs: [],
      settings: null,
    }
    const user = userEvent.setup()
    const { container } = render(
      <>
        <Settings />
        <Toaster />
      </>,
    )
    await screen.findByRole('button', { name: /import data/i })

    await user.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File([JSON.stringify(file)], 'export.json', {
        type: 'application/json',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Replace all' }))
    await user.type(within(dialog).getByLabelText(/type replace/i), 'REPLACE')
    await user.click(
      within(dialog).getByRole('button', { name: 'Replace everything' }),
    )

    expect(
      await screen.findByText('Replace failed — nothing was changed.'),
    ).toBeInTheDocument()
    expect(importDataMock).toHaveBeenCalledWith(file, 'replace', 'u1')
  })
})

describe('Settings — page margins row (chunk 69)', () => {
  beforeEach(() => {
    settingsGetMock.mockResolvedValue({
      userId: 'u1',
      aiStatus: 'unconfigured',
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
    })
    settingsUpdateMock.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  // UX audit #18: saved margins only apply from `sm` up, so the control is
  // hidden below it. jsdom applies no breakpoints — this asserts the classes.
  it('is hidden below sm', async () => {
    render(<Settings />)
    const button = await screen.findByRole('button', { name: 'Adjust margins' })
    const row = screen.getByTestId('page-margins-row')
    expect(row).toContainElement(button)
    expect(row).toHaveClass('hidden', 'sm:block')
  })
})
