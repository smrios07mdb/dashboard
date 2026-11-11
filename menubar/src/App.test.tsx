import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: null as { id: string } | null, loading: false },
  native: {} as Record<string, ReturnType<typeof vi.fn>>,
  /** Every `watchPopover` listener, so a test can show the popover. */
  popover: new Set<(shown: boolean) => void>(),
  /** Every `watchSessions` listener, so a test can send the shell's event. */
  sessions: new Set<() => void>(),
  save: vi.fn(async (row: unknown) => row),
  /** Every `watchPomodoro` listener, so a test can send a snapshot. */
  pomodoro: new Set<() => void>(),
  listGroups: vi.fn(async () => [] as unknown[]),
  signOutUser: vi.fn(async () => {}),
}))

vi.mock('@/lib/auth', () => ({ useSession: () => h.session }))
vi.mock('@/lib/signOutCleanup', () => ({ signOutUser: h.signOutUser }))
vi.mock('@/lib/syncRunner', () => ({
  startSyncRunner: () => ({ stop: () => {} }),
}))
vi.mock('@/lib/taskUndo', () => ({ offerCompleteUndo: vi.fn() }))
vi.mock('@/db/repo', () => ({
  isClientError: (e: unknown) => (e as { status?: number } | null)?.status === 400,
  repo: {
    tasks: {},
    trackedSessions: { save: h.save },
    blockGroups: { list: h.listGroups },
  },
}))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./loadToday', () => ({
  loadToday: async () => ({
    view: { rows: [], done: 0, total: 0, open: 0, trayTitle: '' },
    offline: false,
    lists: { categories: [], subcategories: [], timeZone: 'America/New_York' },
  }),
}))
vi.mock('./native', () => {
  const nothing = async () => null
  const names = [
    'pomodoroState',
    'pomodoroConfigure',
    'pomodoroStart',
    'pomodoroPause',
    'pomodoroResume',
    'pomodoroExtend',
    'pomodoroSkip',
    'pomodoroStop',
    'registerShortcut',
    'unregisterShortcut',
    'showPopover',
    'spotifyState',
    'spotifyPlayPause',
    'spotifyPause',
    'spotifyNext',
    'spotifyPrevious',
    'spotifyPlayPreset',
    'soundConfigure',
    'meditationState',
    'meditationConfigure',
    'meditationStart',
    'meditationSnooze',
    'meditationSkip',
    'meditationEnd',
    'loginItemState',
    'loginItemSet',
    'sessionsPending',
    'sessionsAck',
    'sessionsClear',
    'blockerConfigure',
    'blockerState',
    'blockerCheck',
  ]
  for (const n of names) h.native[n] = vi.fn(nothing)
  for (const n of ['setTrayTitle', 'setPopoverHeight', 'hidePopover', 'openDashboard', 'quitApp', 'openAutomationSettings']) {
    h.native[n] = vi.fn()
  }
  return {
    ...h.native,
    popoverIsShown: async () => false,
    watchPopover: (on: (shown: boolean) => void) => {
      h.popover.add(on)
      return () => h.popover.delete(on)
    },
    watchPomodoro: (on: () => void) => {
      h.pomodoro.add(on)
      return () => h.pomodoro.delete(on)
    },
    watchBlocker: () => () => {},
    watchMeditation: () => () => {},
    watchSessions: (on: () => void) => {
      h.sessions.add(on)
      return () => h.sessions.delete(on)
    },
  }
})

import App from './App'
import { DEFAULT_POMODORO } from './pomodoroPrefs'

const show = () =>
  act(() => {
    for (const on of h.popover) on(true)
  })
const hide = () =>
  act(() => {
    for (const on of h.popover) on(false)
  })

describe('menubar App — pomodoro wiring (chunk 94)', () => {
  beforeEach(() => {
    // theme.ts reads the system appearance; jsdom has no matchMedia.
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    localStorage.clear()
    for (const f of Object.values(h.native)) f.mockClear()
    h.popover.clear()
  })

  it('signed in: sends the settings, shows the focus header, registers ⌥⇧F', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    expect(await screen.findByText('Focus · 25 min')).toBeInTheDocument()
    await waitFor(() =>
      expect(h.native.pomodoroConfigure).toHaveBeenCalledWith(DEFAULT_POMODORO),
    )
    expect(h.native.pomodoroStop).not.toHaveBeenCalled()
    // Sound (chunk 95): the stored choice goes to the shell beside it, and
    // the section sits under the tabs.
    expect(h.native.soundConfigure).toHaveBeenCalledWith(
      true,
      'spotify:playlist:37i9dQZF1DX7EF8wVxBVhG',
    )
    expect(screen.getByText('Sound · Spotify on this Mac')).toBeInTheDocument()
    expect(h.native.registerShortcut).toHaveBeenCalledWith(
      'Alt+Shift+F',
      expect.any(Function),
    )
  })

  it('sign-out stops the session and hides the header', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    const { rerender } = render(<App />)
    await screen.findByText('Focus · 25 min')
    expect(h.native.pomodoroStop).not.toHaveBeenCalled()

    h.session = { user: null, loading: false }
    rerender(<App />)
    await waitFor(() => expect(h.native.pomodoroStop).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Focus · 25 min')).toBeNull()
    expect(screen.queryByText('Sound · Spotify on this Mac')).toBeNull()
    // Sign-out sends Spotify nothing (D13): the session stop is the shell's.
    expect(h.native.spotifyPlayPause).not.toHaveBeenCalled()
    expect(h.native.setTrayTitle).toHaveBeenLastCalledWith('')
  })

  it('meditation: the schedule goes to the shell at sign-in and on every show', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await waitFor(() =>
      expect(h.native.meditationConfigure).toHaveBeenCalledTimes(1),
    )
    const first = h.native.meditationConfigure.mock.calls[0][0]
    expect(first).toMatchObject({ headsUp: 5, length: 5, pauseSpotify: true })
    // Six a day for 14 days, less whatever of today is already past.
    expect(first.due.length).toBeGreaterThanOrEqual(6 * 13)
    expect(first.due.length).toBeLessThanOrEqual(6 * 14)
    expect(first.due.every((t: number) => t > Date.now() - 1000)).toBe(true)
    expect(first.utcOffset).toBe(-new Date().getTimezoneOffset())

    show()
    await waitFor(() =>
      expect(h.native.meditationConfigure).toHaveBeenCalledTimes(2),
    )
    show()
    await waitFor(() =>
      expect(h.native.meditationConfigure).toHaveBeenCalledTimes(3),
    )
    expect(h.native.meditationEnd).not.toHaveBeenCalled()
    expect(h.native.registerShortcut).toHaveBeenCalledWith(
      'Alt+Shift+M',
      expect.any(Function),
    )
  })

  it('meditation: sign-out ends the session and clears the schedule', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    const { rerender } = render(<App />)
    await waitFor(() => expect(h.native.meditationConfigure).toHaveBeenCalled())
    h.native.meditationConfigure.mockClear()

    h.session = { user: null, loading: false }
    rerender(<App />)
    await waitFor(() => expect(h.native.meditationEnd).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(h.native.meditationConfigure).toHaveBeenCalledTimes(1),
    )
    expect(h.native.meditationConfigure.mock.calls[0][0].due).toEqual([])
    // Signed out, showing the popover sends no schedule.
    show()
    expect(h.native.meditationConfigure).toHaveBeenCalledTimes(1)
  })

  it('the reminder panel sits above the focus header', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    h.native.meditationConfigure.mockResolvedValue({
      status: 'due',
      dueAt: Date.now(),
      startedAt: null,
      endsAt: null,
      length: 5,
      pauseSpotify: true,
      nextDueAt: null,
    })
    render(<App />)
    const panel = await screen.findByRole('region', { name: 'Meditation reminder' })
    const focus = screen.getByRole('region', { name: 'Focus' })
    expect(
      panel.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    h.native.meditationConfigure.mockResolvedValue(null)
  })

  it('while the session is loading, nothing is sent', () => {
    h.session = { user: null, loading: true }
    render(<App />)
    expect(h.native.meditationConfigure).not.toHaveBeenCalled()
    expect(h.native.meditationEnd).not.toHaveBeenCalled()
    expect(h.native.pomodoroStop).not.toHaveBeenCalled()
    expect(h.native.pomodoroConfigure).not.toHaveBeenCalled()
    expect(h.native.soundConfigure).not.toHaveBeenCalled()
  })
})

describe('menubar App — Settings (chunk 97)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    localStorage.clear()
    for (const f of Object.values(h.native)) f.mockClear()
    h.popover.clear()
  })

  const footer = () =>
    [...document.querySelectorAll('.mb-foot button')].map((b) => b.textContent)
  const openSettings = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    return screen.getByRole('region', { name: 'Settings' })
  }

  it('signed in: the footer is Open dashboard · Settings · Sign out · Quit', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await screen.findByText('Focus · 25 min')
    expect(footer()).toEqual(['Open dashboard', 'Settings', 'Sign out', 'Quit'])
  })

  it('signed out: no Settings, Theme stays in the footer', () => {
    h.session = { user: null, loading: false }
    render(<App />)
    expect(footer()).toEqual(['Open dashboard', 'Theme: Auto', 'Quit'])
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  })

  it('Settings replaces the focus header, tabs and Sound; the reminder stays', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    h.native.meditationConfigure.mockResolvedValue({
      status: 'due',
      dueAt: Date.now(),
      startedAt: null,
      endsAt: null,
      length: 5,
      pauseSpotify: true,
      nextDueAt: null,
    })
    render(<App />)
    await screen.findByRole('region', { name: 'Meditation reminder' })
    await openSettings()
    expect(screen.getByRole('region', { name: 'Meditation reminder' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Focus' })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText('Sound · Spotify on this Mac')).toBeNull()
    for (const name of ['Focus', 'Sound', 'Meditation', 'Hotkeys', 'General']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
    h.native.meditationConfigure.mockResolvedValue(null)
  })

  it('Done closes it', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await openSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'Settings' })).toBeNull()
    expect(screen.getByText('Focus · 25 min')).toBeInTheDocument()
  })

  it('Esc closes it and does not hide the popover', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await openSettings()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Settings' })).toBeNull()
    expect(h.native.hidePopover).not.toHaveBeenCalled()
    // Closed, Esc hides the popover as before.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(h.native.hidePopover).toHaveBeenCalledTimes(1)
  })

  it('the popover hiding closes it', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await openSettings()
    hide()
    expect(screen.queryByRole('region', { name: 'Settings' })).toBeNull()
  })

  it('⌥H closes it and forces Scratchpad', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await screen.findByText('Focus · 25 min')
    await waitFor(() =>
      expect(h.native.registerShortcut).toHaveBeenCalledWith('Alt+H', expect.any(Function)),
    )
    const press = h.native.registerShortcut.mock.calls.find((c) => c[0] === 'Alt+H')![1]
    await openSettings()
    await act(async () => {
      press()
    })
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Settings' })).toBeNull(),
    )
    expect(screen.getByRole('tab', { name: /Scratchpad/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('Sound rereads its prefs after Settings closes', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await screen.findByText('Focus · 25 min')
    expect(screen.getByRole('button', { name: 'Binaural' })).toBeInTheDocument()
    await openSettings()
    fireEvent.change(screen.getByRole('textbox', { name: 'Binaural name' }), {
      target: { value: 'Mine' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Mine' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Binaural' })).toBeNull()
  })

  it('Theme moved into Settings › General', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await openSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(localStorage.getItem('hupo.menubar.theme')).toBe('dark')
    expect(document.documentElement.dataset.mode).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(localStorage.getItem('hupo.menubar.theme')).toBeNull()
  })

  it('sign-in configures Sound with his own playlist when set', async () => {
    const MINE = 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ'
    localStorage.setItem(
      'hup:mb:sound',
      JSON.stringify({ auto: true, preset: 'binaural', playlists: { binaural: { label: 'Mine', uri: MINE } } }),
    )
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await waitFor(() => expect(h.native.soundConfigure).toHaveBeenCalledWith(true, MINE))
  })
})

describe('menubar App — saved sessions (chunk 98)', () => {
  const ENTRY = {
    seq: 7,
    kind: 'focus',
    startedAt: 1_800_000_000_000,
    endedAt: 1_800_000_060_000,
    plannedMs: 60_000,
    activeMs: 60_000,
    outcome: 'completed',
    taskId: null,
    taskTitle: null,
  }

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    localStorage.clear()
    for (const f of Object.values(h.native)) f.mockClear()
    h.native.sessionsPending.mockImplementation(async () => null)
    h.popover.clear()
    h.sessions.clear()
    h.save.mockReset()
    h.save.mockImplementation(async (row: unknown) => row)
    h.signOutUser.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function signedIn() {
    h.session = { user: { id: 'u1' }, loading: false }
    const view = render(<App />)
    await screen.findByText('Focus · 25 min')
    await waitFor(() => expect(h.native.sessionsPending).toHaveBeenCalled())
    // Let the sign-in drain finish before a test counts further ones.
    await act(async () => {})
    return view
  }

  it('signed in: drains what a previous run left, writes it and acknowledges', async () => {
    h.native.sessionsPending.mockImplementationOnce(async () => [ENTRY])
    await signedIn()
    await waitFor(() => expect(h.native.sessionsAck).toHaveBeenCalledWith([7]))
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      kind: 'focus',
      outcome: 'completed',
      plannedSeconds: 60,
      activeSeconds: 60,
      startedAt: '2027-01-15T08:00:00.000Z',
      taskId: null,
    })
    expect(h.native.sessionsClear).not.toHaveBeenCalled()
  })

  it('drains on each `sessions` event and on each show', async () => {
    await signedIn()
    const before = h.native.sessionsPending.mock.calls.length

    await act(async () => {
      for (const on of h.sessions) on()
    })
    await waitFor(() =>
      expect(h.native.sessionsPending.mock.calls.length).toBe(before + 1),
    )

    await show()
    await waitFor(() =>
      expect(h.native.sessionsPending.mock.calls.length).toBe(before + 2),
    )
    // Hiding is not a trigger.
    await hide()
    await act(async () => {})
    expect(h.native.sessionsPending.mock.calls.length).toBe(before + 2)
  })

  it('signed out or loading: nothing is drained', async () => {
    h.session = { user: null, loading: true }
    render(<App />)
    await act(async () => {})
    expect(h.native.sessionsPending).not.toHaveBeenCalled()
    expect(h.native.sessionsClear).not.toHaveBeenCalled()
    expect(h.sessions.size).toBe(0)
  })

  it('Quit drains first, then quits', async () => {
    await signedIn()
    let release: () => void = () => {}
    h.native.sessionsPending.mockImplementationOnce(async () => [ENTRY])
    h.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(h.native.quitApp).not.toHaveBeenCalled()

    await act(async () => release())
    await waitFor(() => expect(h.native.quitApp).toHaveBeenCalledTimes(1))
    expect(h.native.sessionsAck).toHaveBeenCalledWith([7])
    expect(h.native.sessionsAck.mock.invocationCallOrder[0]).toBeLessThan(
      h.native.quitApp.mock.invocationCallOrder[0],
    )
  })

  it('Quit gives up on the drain after 3 s', async () => {
    await signedIn()
    h.native.sessionsPending.mockImplementationOnce(async () => [ENTRY])
    h.save.mockImplementationOnce(() => new Promise<void>(() => {}))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(h.native.quitApp).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(h.native.quitApp).toHaveBeenCalledTimes(1)
    expect(h.native.sessionsAck).not.toHaveBeenCalled()
  })

  it('Sign out drains first, then signs out', async () => {
    await signedIn()
    let release: () => void = () => {}
    h.native.sessionsPending.mockImplementationOnce(async () => [ENTRY])
    h.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(h.signOutUser).not.toHaveBeenCalled()

    await act(async () => release())
    await waitFor(() => expect(h.signOutUser).toHaveBeenCalledTimes(1))
    expect(h.native.sessionsAck).toHaveBeenCalledWith([7])
  })

  it('Sign out gives up on the drain after 3 s', async () => {
    await signedIn()
    h.native.sessionsPending.mockImplementationOnce(async () => [ENTRY])
    h.save.mockImplementationOnce(() => new Promise<void>(() => {}))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(h.signOutUser).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(h.signOutUser).toHaveBeenCalledTimes(1)
  })

  // Chunk 98 gate (F1): a session still running at Quit or Sign out is
  // stopped / ended first, so the shell puts it in the ledger, and the drain
  // that follows writes it.
  function lastCall(f: ReturnType<typeof vi.fn>) {
    const order = f.mock.invocationCallOrder
    return order[order.length - 1]
  }

  it('Quit stops the focus and ends the breathing first, then drains, then quits', async () => {
    await signedIn()
    expect(h.native.pomodoroStop).not.toHaveBeenCalled()
    const before = h.native.sessionsPending.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
    await waitFor(() => expect(h.native.quitApp).toHaveBeenCalledTimes(1))
    expect(h.native.pomodoroStop).toHaveBeenCalledTimes(1)
    expect(h.native.meditationEnd).toHaveBeenCalledTimes(1)
    expect(h.native.sessionsPending.mock.calls.length).toBe(before + 1)
    const drained = lastCall(h.native.sessionsPending)
    expect(lastCall(h.native.pomodoroStop)).toBeLessThan(drained)
    expect(lastCall(h.native.meditationEnd)).toBeLessThan(drained)
    expect(drained).toBeLessThan(lastCall(h.native.quitApp))
  })

  it('Sign out stops the focus and ends the breathing first, then drains, then signs out', async () => {
    await signedIn()
    expect(h.native.pomodoroStop).not.toHaveBeenCalled()
    const before = h.native.sessionsPending.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(h.signOutUser).toHaveBeenCalledTimes(1))
    expect(h.native.pomodoroStop).toHaveBeenCalledTimes(1)
    expect(h.native.meditationEnd).toHaveBeenCalledTimes(1)
    expect(h.native.sessionsPending.mock.calls.length).toBe(before + 1)
    const drained = lastCall(h.native.sessionsPending)
    expect(lastCall(h.native.pomodoroStop)).toBeLessThan(drained)
    expect(lastCall(h.native.meditationEnd)).toBeLessThan(drained)
    expect(drained).toBeLessThan(lastCall(h.signOutUser))
  })

  it('signed out: the ledger is cleared after the stop and the end', async () => {
    const { rerender } = await signedIn()
    expect(h.native.sessionsClear).not.toHaveBeenCalled()

    h.session = { user: null, loading: false }
    rerender(<App />)
    await waitFor(() => expect(h.native.sessionsClear).toHaveBeenCalledTimes(1))
    const cleared = h.native.sessionsClear.mock.invocationCallOrder[0]
    expect(h.native.pomodoroStop.mock.invocationCallOrder[0]).toBeLessThan(cleared)
    expect(h.native.meditationEnd.mock.invocationCallOrder[0]).toBeLessThan(
      cleared,
    )
    // The `sessions` event no longer reaches a drain.
    expect(h.sessions.size).toBe(0)
  })

  it('signed out: Quit quits at once', async () => {
    h.session = { user: null, loading: false }
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
    await waitFor(() => expect(h.native.quitApp).toHaveBeenCalledTimes(1))
    expect(h.native.sessionsPending).not.toHaveBeenCalled()
  })
})

describe('menubar App — site blocking (chunk 99, D20)', () => {
  const group = {
    id: 'g1',
    userId: 'u1',
    name: 'Social',
    domains: ['x.com'],
    enabled: true,
    blockInFocus: true,
    blockOnSchedule: false,
    scheduleDays: [1, 2, 3, 4, 5],
    scheduleFrom: '09:00',
    scheduleTo: '17:00',
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  const DISABLED = {
    enabled: false,
    names: [],
    domains: [],
    focus: [],
    starts: [],
    ends: [],
  }

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    localStorage.clear()
    for (const f of Object.values(h.native)) f.mockClear()
    h.popover.clear()
    h.pomodoro.clear()
    h.listGroups.mockReset()
    h.listGroups.mockResolvedValue([group])
  })

  const configured = () =>
    h.native.blockerConfigure.mock.calls.filter(
      (c) => (c[0] as { enabled: boolean }).enabled,
    ).length

  it('sign-in sends the rules', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await waitFor(() =>
      expect(h.native.blockerConfigure).toHaveBeenCalledWith({
        enabled: true,
        names: ['Social'],
        domains: [['x.com']],
        focus: [true],
        starts: [[]],
        ends: [[]],
      }),
    )
  })

  it('each show and each pomodoro event sends them again', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await waitFor(() => expect(configured()).toBeGreaterThan(0))
    await act(async () => {})
    const before = configured()
    // A show is also a refresher tick, so it may send twice.
    show()
    await waitFor(() => expect(configured()).toBeGreaterThan(before))
    await act(async () => {})
    const afterShow = configured()
    await act(async () => {
      for (const on of h.pomodoro) on()
    })
    await waitFor(() => expect(configured()).toBe(afterShow + 1))
  })

  it('signed out sends the disabled configuration', async () => {
    h.session = { user: null, loading: false }
    render(<App />)
    await waitFor(() =>
      expect(h.native.blockerConfigure).toHaveBeenCalledWith(DISABLED),
    )
    expect(h.listGroups).not.toHaveBeenCalled()
  })

  it('Sign out lifts every block', async () => {
    h.session = { user: { id: 'u1' }, loading: false }
    render(<App />)
    await waitFor(() => expect(configured()).toBeGreaterThan(0))
    h.native.blockerConfigure.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() =>
      expect(h.native.blockerConfigure).toHaveBeenCalledWith(DISABLED),
    )
  })
})
