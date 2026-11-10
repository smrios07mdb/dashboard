import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: null as { id: string } | null, loading: false },
  native: {} as Record<string, ReturnType<typeof vi.fn>>,
  /** Every `watchPopover` listener, so a test can show the popover. */
  popover: new Set<(shown: boolean) => void>(),
}))

vi.mock('@/lib/auth', () => ({ useSession: () => h.session }))
vi.mock('@/lib/signOutCleanup', () => ({ signOutUser: vi.fn() }))
vi.mock('@/lib/syncRunner', () => ({
  startSyncRunner: () => ({ stop: () => {} }),
}))
vi.mock('@/lib/taskUndo', () => ({ offerCompleteUndo: vi.fn() }))
vi.mock('@/db/repo', () => ({ repo: { tasks: {} } }))
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
    watchPomodoro: () => () => {},
    watchMeditation: () => () => {},
  }
})

import App from './App'
import { DEFAULT_POMODORO } from './pomodoroPrefs'

const show = () =>
  act(() => {
    for (const on of h.popover) on(true)
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
