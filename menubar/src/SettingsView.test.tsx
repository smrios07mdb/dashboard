import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./native', () => ({
  soundConfigure: vi.fn(async () => {}),
  loginItemState: vi.fn(async () => null),
  loginItemSet: vi.fn(async () => null),
}))

import { createHotkeys, HOTKEYS_KEY, type HotkeyBackend } from './hotkeys'
import type { Meditation } from './meditation'
import { MEDITATION_KEY, readMeditationPrefs } from './meditationPrefs'
import type { LoginItemState } from './native'
import type { Pomodoro } from './pomodoro'
import { DEFAULT_POMODORO, POMODORO_KEY } from './pomodoroPrefs'
import type { BlockGroup } from '@/db/types'

import { BLOCKER_KEY } from './blockerPrefs'
import type { BlockerState } from './blocker'
import SettingsView, { type BlockingBackend, type SettingsBackend } from './SettingsView'
import { readSoundPrefs, SOUND_KEY } from './soundPrefs'

const ID = '37i9dQZF1DWZeKCadgRdKQ'
const MINE = `spotify:playlist:${ID}`

function keyBackend(fail: string[] = []) {
  const presses = new Map<string, () => void>()
  const b: HotkeyBackend & { presses: typeof presses } = {
    presses,
    register: vi.fn(async (accel: string, onPress: () => void) => {
      if (fail.includes(accel)) throw new Error('taken')
      presses.set(accel, onPress)
    }),
    unregister: vi.fn(async (accel: string) => {
      presses.delete(accel)
    }),
  }
  return b
}

function setup({
  login = { status: 'off', path: null },
  failKeys = [],
  blocking,
}: {
  login?: LoginItemState | null
  failKeys?: string[]
  blocking?: BlockingBackend
} = {}) {
  const pomodoro = { saveConfig: vi.fn(async () => {}) }
  const meditation = { savePrefs: vi.fn(async () => {}) }
  const keys = keyBackend(failKeys)
  const handlers = { scratchpad: vi.fn(), focus: vi.fn(), meditate: vi.fn() }
  const hotkeys = createHotkeys(keys, handlers)
  const backend: SettingsBackend & Record<string, ReturnType<typeof vi.fn>> = {
    soundConfigure: vi.fn(async () => {}),
    loginState: vi.fn(async () => login),
    loginSet: vi.fn(async (on: boolean) => ({
      status: on ? 'on' : 'off',
      path: on ? '/Applications/Hupomnemata.app' : null,
    })) as never,
  }
  const onDone = vi.fn()
  const onTheme = vi.fn()
  const view = render(
    <SettingsView
      pomodoro={pomodoro as unknown as Pomodoro}
      meditation={meditation as unknown as Meditation}
      hotkeys={hotkeys}
      theme="auto"
      onTheme={onTheme}
      onDone={onDone}
      backend={backend}
      blocking={blocking}
    />,
  )
  return { pomodoro, meditation, keys, handlers, hotkeys, backend, onDone, onTheme, view }
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const sw = (name: string) => screen.getByRole('switch', { name })
const settle = () => act(async () => {})

describe('SettingsView (chunk 97)', () => {
  beforeEach(() => localStorage.clear())

  it('renders the five sections in order, with Done', async () => {
    setup()
    await settle()
    const groups = screen
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'))
      .filter((n) => ['Focus', 'Sound', 'Meditation', 'Hotkeys', 'General'].includes(n!))
    expect(groups).toEqual(['Focus', 'Sound', 'Meditation', 'Hotkeys', 'General'])
    expect(btn('Done')).toBeInTheDocument()
    expect(
      screen.getByText('New lengths apply from the next phase. Compact changes the menu bar at once.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Sessions never start on their own. You press Start.'),
    ).toBeInTheDocument()
  })

  it('Done calls onDone', () => {
    const { onDone } = setup()
    fireEvent.click(btn('Done'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('Esc closes the view and is marked handled', () => {
    const { onDone } = setup()
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })

  // ---- Focus (D4) ----

  it('a step saves through saveConfig with the new value', () => {
    const { pomodoro } = setup()
    expect(screen.getByLabelText('Focus', { selector: '.mb-val' })).toHaveTextContent('25 min')
    fireEvent.click(btn('More focus'))
    expect(pomodoro.saveConfig).toHaveBeenLastCalledWith({ ...DEFAULT_POMODORO, focus: 26 })
    fireEvent.click(btn('Less short break'))
    expect(pomodoro.saveConfig).toHaveBeenLastCalledWith({
      ...DEFAULT_POMODORO,
      focus: 26,
      short: 4,
    })
    fireEvent.click(btn('More long break after'))
    expect(pomodoro.saveConfig).toHaveBeenLastCalledWith({
      ...DEFAULT_POMODORO,
      focus: 26,
      short: 4,
      every: 5,
    })
    fireEvent.click(sw('Compact menu bar timer'))
    expect(pomodoro.saveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ compact: true }),
    )
    expect(sw('Compact menu bar timer')).toHaveAttribute('aria-checked', 'true')
  })

  it('steppers disable at each range end', () => {
    localStorage.setItem(
      POMODORO_KEY,
      JSON.stringify({ focus: 180, short: 1, long: 90, every: 1, compact: false }),
    )
    const { pomodoro } = setup()
    expect(btn('More focus')).toBeDisabled()
    expect(btn('Less focus')).toBeEnabled()
    expect(btn('Less short break')).toBeDisabled()
    expect(btn('More long break')).toBeDisabled()
    expect(btn('Less long break after')).toBeDisabled()
    expect(screen.getByLabelText('Long break after', { selector: '.mb-val' })).toHaveTextContent(
      '1 session',
    )
    fireEvent.click(btn('More focus'))
    expect(pomodoro.saveConfig).not.toHaveBeenCalled()
  })

  // ---- Sound (D5) ----

  it('a pasted playlist link is stored as a URI; the playing slot is sent', async () => {
    const { backend } = setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'Binaural playlist link' }), {
      target: { value: `https://open.spotify.com/playlist/${ID}?si=x` },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Binaural name' }), {
      target: { value: 'Mine' },
    })
    expect(readSoundPrefs().playlists).toEqual({ binaural: { label: 'Mine', uri: MINE } })
    // Binaural is the selected preset: the shell hears the new URI once.
    expect(backend.soundConfigure).toHaveBeenCalledTimes(1)
    expect(backend.soundConfigure).toHaveBeenCalledWith(true, MINE)
  })

  it('a slot that is not playing is stored without telling the shell', () => {
    const { backend } = setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'Classical playlist link' }), {
      target: { value: `https://open.spotify.com/intl-de/playlist/${ID}` },
    })
    expect(readSoundPrefs().playlists).toEqual({ classical: { label: 'Classical', uri: MINE } })
    expect(backend.soundConfigure).not.toHaveBeenCalled()
  })

  it('a track or album link is refused and not saved', () => {
    setup()
    const link = screen.getByRole('textbox', { name: 'Binaural playlist link' })
    for (const bad of [
      `https://open.spotify.com/track/${ID}`,
      `https://open.spotify.com/album/${ID}`,
    ]) {
      fireEvent.change(link, { target: { value: bad } })
      expect(screen.getByText('Not a Spotify playlist link')).toBeInTheDocument()
      expect(link).toHaveAttribute('aria-invalid', 'true')
      expect(localStorage.getItem(SOUND_KEY)).toBeNull()
    }
  })

  it('an empty or long label is not saved', () => {
    setup()
    const name = screen.getByRole('textbox', { name: 'Deep work name' })
    for (const bad of ['', '   ', 'x'.repeat(21)]) {
      fireEvent.change(name, { target: { value: bad } })
      expect(name).toHaveAttribute('aria-invalid', 'true')
      expect(localStorage.getItem(SOUND_KEY)).toBeNull()
    }
  })

  it('Reset puts the built-in back', () => {
    localStorage.setItem(
      SOUND_KEY,
      JSON.stringify({ auto: true, preset: 'binaural', playlists: { binaural: { label: 'Mine', uri: MINE } } }),
    )
    const { backend } = setup()
    expect(screen.getByRole('textbox', { name: 'Binaural name' })).toHaveValue('Mine')
    fireEvent.click(btn('Reset Binaural'))
    expect(readSoundPrefs().playlists).toEqual({})
    expect(screen.getByRole('textbox', { name: 'Binaural name' })).toHaveValue('Binaural')
    expect(backend.soundConfigure).toHaveBeenCalledWith(
      true,
      'spotify:playlist:37i9dQZF1DX7EF8wVxBVhG',
    )
  })

  // ---- Meditation (D6, D7) ----

  it('the mode switch dims and disables the other row', () => {
    const { meditation } = setup()
    const every = document.querySelector('[data-row="every"]')!
    const times = document.querySelector('[data-row="times"]')!
    expect(every).not.toHaveClass('mb-dim')
    expect(times).toHaveClass('mb-dim')
    expect(screen.getByLabelText('Time 1')).toBeDisabled()
    expect(screen.getByLabelText('From')).toBeEnabled()
    fireEvent.click(btn('Set times'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'times' }),
    )
    expect(every).toHaveClass('mb-dim')
    expect(times).not.toHaveClass('mb-dim')
    expect(screen.getByLabelText('From')).toBeDisabled()
    expect(screen.getByLabelText('Time 1')).toBeEnabled()
  })

  it('length, every, heads-up and the switches save', () => {
    const { meditation } = setup()
    fireEvent.click(btn('10 min'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(expect.objectContaining({ length: 10 }))
    fireEvent.change(screen.getByLabelText('Every'), { target: { value: '45' } })
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(expect.objectContaining({ every: 45 }))
    fireEvent.change(screen.getByLabelText('Heads-up'), { target: { value: '0' } })
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(expect.objectContaining({ headsUp: 0 }))
    fireEvent.click(sw('Reminders'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
    fireEvent.click(sw('Pause Spotify during a session'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ pauseSpotify: false }),
    )
  })

  it('a stored value outside a list is shown as one more option, unchanged', () => {
    localStorage.setItem(MEDITATION_KEY, JSON.stringify({ every: 75, headsUp: 7 }))
    const { meditation } = setup()
    expect(screen.getByLabelText('Every')).toHaveValue('75')
    expect(screen.getByRole('option', { name: '75 min' })).toBeInTheDocument()
    expect(screen.getByLabelText('Heads-up')).toHaveValue('7')
    expect(meditation.savePrefs).not.toHaveBeenCalled()
  })

  it('from at or after to says so and is not saved', () => {
    const { meditation } = setup()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '18:00' } })
    expect(screen.getByText('Start must be before end')).toBeInTheDocument()
    expect(meditation.savePrefs).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '19:00' } })
    expect(meditation.savePrefs).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '08:00' } })
    expect(screen.queryByText('Start must be before end')).toBeNull()
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '08:00', to: '18:00' }),
    )
  })

  it('times: add is the last + 1 h, capped at 23:00; × removes; never a 13th', () => {
    localStorage.setItem(MEDITATION_KEY, JSON.stringify({ mode: 'times', times: ['22:30'] }))
    const { meditation } = setup()
    // One time: no ×.
    expect(screen.queryByRole('button', { name: 'Remove time 1' })).toBeNull()
    fireEvent.click(btn('+ Add'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ times: ['22:30', '23:00'] }),
    )
    fireEvent.click(btn('Remove time 1'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ times: ['23:00'] }),
    )
  })

  it('adding a 13th time is impossible', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`)
    localStorage.setItem(MEDITATION_KEY, JSON.stringify({ mode: 'times', times: eleven }))
    const { meditation } = setup()
    fireEvent.click(btn('+ Add'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ times: [...eleven, '19:00'] }),
    )
    expect(screen.getAllByLabelText(/^Time \d+$/)).toHaveLength(12)
    expect(btn('+ Add')).toBeDisabled()
    fireEvent.click(btn('+ Add'))
    expect(screen.getAllByLabelText(/^Time \d+$/)).toHaveLength(12)
  })

  it('days: toggles save; the last day on cannot be switched off', () => {
    localStorage.setItem(MEDITATION_KEY, JSON.stringify({ days: [1, 3] }))
    const { meditation } = setup()
    expect(btn('Monday')).toHaveAttribute('aria-pressed', 'true')
    expect(btn('Tuesday')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn('Monday'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(expect.objectContaining({ days: [3] }))
    expect(btn('Wednesday')).toBeDisabled()
    fireEvent.click(btn('Wednesday'))
    expect(meditation.savePrefs).toHaveBeenCalledTimes(1)
    fireEvent.click(btn('Sunday'))
    expect(meditation.savePrefs).toHaveBeenLastCalledWith(expect.objectContaining({ days: [0, 3] }))
    expect(btn('Wednesday')).toBeEnabled()
    // The full names are the accessible names; the faces are letters.
    expect(btn('Sunday')).toHaveTextContent('S')
    expect(readMeditationPrefs().days).toEqual([1, 3]) // savePrefs is mocked
  })

  // ---- Hotkeys (D8–D10) ----

  const keyDown = (init: KeyboardEventInit) => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    act(() => {
      document.activeElement!.dispatchEvent(ev)
    })
    return ev
  }

  it('recording releases every key, and a combo rebinds then restores them', async () => {
    const { hotkeys, keys, onDone } = setup()
    await act(() => hotkeys.start())
    expect(keys.presses.size).toBe(3)
    fireEvent.click(btn('Open scratchpad: ⌥H'))
    expect(btn('Open scratchpad: press keys')).toHaveTextContent('Press keys…')
    expect(btn('Open scratchpad: press keys')).toHaveFocus()
    await waitFor(() => expect(keys.presses.size).toBe(0))
    // Modifiers alone and ⇧ alone keep recording.
    keyDown({ key: 'Alt', code: 'AltLeft', altKey: true })
    keyDown({ key: 'J', code: 'KeyJ', shiftKey: true })
    expect(btn('Open scratchpad: press keys')).toBeInTheDocument()
    // ⌥J: e.key is '∆' on a Mac, e.code is what counts.
    const ev = keyDown({ key: '∆', code: 'KeyJ', altKey: true })
    expect(ev.defaultPrevented).toBe(true)
    await waitFor(() =>
      expect([...keys.presses.keys()].sort()).toEqual(['Alt+J', 'Alt+Shift+F', 'Alt+Shift+M']),
    )
    expect(btn('Open scratchpad: ⌥J')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(HOTKEYS_KEY)!).scratchpad).toBe('Alt+J')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('Esc cancels a recording, keeps the view open, and restores the old key', async () => {
    const { hotkeys, keys, onDone } = setup()
    await act(() => hotkeys.start())
    fireEvent.click(btn('Start or pause focus: ⌥⇧F'))
    await waitFor(() => expect(keys.presses.size).toBe(0))
    const ev = keyDown({ key: 'Escape', code: 'Escape' })
    expect(ev.defaultPrevented).toBe(true)
    expect(onDone).not.toHaveBeenCalled()
    await waitFor(() => expect(keys.presses.size).toBe(3))
    expect(btn('Start or pause focus: ⌥⇧F')).toBeInTheDocument()
    expect(localStorage.getItem(HOTKEYS_KEY)).toBeNull()
  })

  it('a combo bound to another action is refused', async () => {
    const { hotkeys, keys } = setup()
    await act(() => hotkeys.start())
    fireEvent.click(btn('Open scratchpad: ⌥H'))
    await waitFor(() => expect(keys.presses.size).toBe(0))
    keyDown({ key: 'Ï', code: 'KeyF', altKey: true, shiftKey: true })
    expect(screen.getByText('Already used for Start or pause focus')).toBeInTheDocument()
    await waitFor(() => expect(keys.presses.size).toBe(3))
    expect(hotkeys.getState().bound.scratchpad).toBe('Alt+H')
    expect(localStorage.getItem(HOTKEYS_KEY)).toBeNull()
  })

  it('blur ends the recording; unmounting while recording restores the keys', async () => {
    const { hotkeys, keys, view } = setup()
    await act(() => hotkeys.start())
    fireEvent.click(btn('Start meditation: ⌥⇧M'))
    await waitFor(() => expect(keys.presses.size).toBe(0))
    fireEvent.blur(btn('Start meditation: press keys'))
    await waitFor(() => expect(keys.presses.size).toBe(3))

    fireEvent.click(btn('Start meditation: ⌥⇧M'))
    await waitFor(() => expect(keys.presses.size).toBe(0))
    view.unmount()
    await waitFor(() => expect(keys.presses.size).toBe(3))
  })

  it('a taken combo keeps the old key and says so; Reset to defaults', async () => {
    const { hotkeys, keys } = setup({ failKeys: ['Alt+K'] })
    await act(() => hotkeys.start())
    fireEvent.click(btn('Open scratchpad: ⌥H'))
    await waitFor(() => expect(keys.presses.size).toBe(0))
    keyDown({ key: '˚', code: 'KeyK', altKey: true })
    expect(await screen.findByText('⌥K is taken by another app — kept ⌥H')).toBeInTheDocument()
    expect(keys.presses.has('Alt+H')).toBe(true)

    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ focus: 'Alt+G' }))
    await act(() => hotkeys.start())
    expect(btn('Start or pause focus: ⌥G')).toBeInTheDocument()
    fireEvent.click(btn('Reset to defaults'))
    await waitFor(() => expect(btn('Start or pause focus: ⌥⇧F')).toBeInTheDocument())
    expect([...keys.presses.keys()].sort()).toEqual(['Alt+H', 'Alt+Shift+F', 'Alt+Shift+M'])
  })

  // ---- General (D11, D12) ----

  it('theme is a segmented control', () => {
    const { onTheme } = setup()
    expect(btn('Auto')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn('Dark'))
    expect(onTheme).toHaveBeenCalledWith('dark')
  })

  it('login: off → on writes it; on reads on', async () => {
    const { backend } = setup()
    await waitFor(() => expect(sw('Open at login')).toBeEnabled())
    expect(sw('Open at login')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw('Open at login'))
    expect(backend.loginSet).toHaveBeenCalledWith(true)
    await waitFor(() => expect(sw('Open at login')).toHaveAttribute('aria-checked', 'true'))
    fireEvent.click(sw('Open at login'))
    expect(backend.loginSet).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(sw('Open at login')).toHaveAttribute('aria-checked', 'false'))
  })

  it('login: on', async () => {
    setup({ login: { status: 'on', path: '/Applications/Hupomnemata.app' } })
    await waitFor(() => expect(sw('Open at login')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.queryByText(/another copy/)).toBeNull()
  })

  it('login: other shows the path and switching on rewrites it', async () => {
    const { backend } = setup({ login: { status: 'other', path: '/Volumes/X/Hupomnemata.app' } })
    expect(
      await screen.findByText('Set for another copy: /Volumes/X/Hupomnemata.app'),
    ).toBeInTheDocument()
    expect(sw('Open at login')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw('Open at login'))
    expect(backend.loginSet).toHaveBeenCalledWith(true)
    await waitFor(() => expect(screen.queryByText(/another copy/)).toBeNull())
  })

  it('login: unavailable (and no shell) disables the switch', async () => {
    setup({ login: { status: 'unavailable', path: null } })
    expect(await screen.findByText('Only in the installed app')).toBeInTheDocument()
    expect(sw('Open at login')).toBeDisabled()
  })

  it('login: no shell reads as unavailable', async () => {
    setup({ login: null })
    expect(await screen.findByText('Only in the installed app')).toBeInTheDocument()
    expect(sw('Open at login')).toBeDisabled()
    expect(
      screen.getByText(/Takes effect at your next login\. macOS may list it under Login Items/),
    ).toBeInTheDocument()
  })
})

describe('SettingsView — Blocking (chunk 99, D21)', () => {
  beforeEach(() => localStorage.clear())

  function aGroup(over: Partial<BlockGroup> = {}): BlockGroup {
    return {
      id: 'g-1',
      userId: 'u-1',
      name: 'Social',
      domains: ['x.com', 'reddit.com'],
      enabled: true,
      blockInFocus: true,
      blockOnSchedule: true,
      scheduleDays: [1, 2, 3, 4, 5],
      scheduleFrom: '09:00',
      scheduleTo: '17:00',
      dailyLimitOn: false,
      dailyLimitMinutes: 30,
      sortOrder: 0,
      createdAt: 'x',
      updatedAt: 'x',
      ...over,
    }
  }

  function blockingBackend(
    groups: BlockGroup[],
    state: BlockerState | null = null,
  ) {
    let emit: ((s: BlockerState) => void) | null = null
    const b = {
      listGroups: vi.fn(async () => groups),
      setGroupEnabled: vi.fn(async (id: string, enabled: boolean) => ({
        ...groups.find((g) => g.id === id)!,
        enabled,
      })),
      state: vi.fn(async () => state),
      check: vi.fn(async () => state),
      watch: vi.fn((on: (s: BlockerState) => void) => {
        emit = on
        return () => {
          emit = null
        }
      }),
      openAutomation: vi.fn(),
      sync: vi.fn(async () => {}),
    }
    return { b, emit: (s: BlockerState) => emit?.(s) }
  }

  it('sits between Meditation and Hotkeys', async () => {
    const { b } = blockingBackend([])
    setup({ blocking: b })
    await settle()
    const order = screen
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'))
      .filter((n) => ['Meditation', 'Blocking', 'Hotkeys'].includes(n!))
    expect(order).toEqual(['Meditation', 'Blocking', 'Hotkeys'])
    expect(screen.getByText('No groups yet.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add and edit sites on the dashboard, under Settings › Site blocking. Quitting this app lifts every block.',
      ),
    ).toBeInTheDocument()
  })

  it('the Mac switch saves hup:mb:blocker and syncs', async () => {
    const { b } = blockingBackend([])
    setup({ blocking: b })
    await settle()
    expect(sw('Block sites on this Mac')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw('Block sites on this Mac'))
    expect(localStorage.getItem(BLOCKER_KEY)).toBe('{"enabled":false}')
    expect(sw('Block sites on this Mac')).toHaveAttribute('aria-checked', 'false')
    expect(b.sync).toHaveBeenCalledTimes(1)
  })

  it('lists each group with its summary; its switch saves and syncs', async () => {
    const { b } = blockingBackend([aGroup()])
    setup({ blocking: b })
    await settle()
    expect(screen.getByText(/2 sites · Focus · Mon–Fri 9:00 AM – 5:00 PM/)).toBeInTheDocument()
    fireEvent.click(sw('Social'))
    await settle()
    expect(b.setGroupEnabled).toHaveBeenCalledWith('g-1', false)
    expect(sw('Social')).toHaveAttribute('aria-checked', 'false')
    expect(b.sync).toHaveBeenCalledTimes(1)
  })

  describe('the daily allowance (chunk 100, D17)', () => {
    const state = (usage: BlockerState['usage']): BlockerState => ({
      enabled: true,
      active: false,
      browsers: [],
      usage,
      warning: null,
    })
    const usageRow = (view: { container: HTMLElement }, id: string) =>
      view.container.querySelector(`[data-usage="${id}"]`)

    it('a group with an allowance reads its summary and today\'s usage, live', async () => {
      const { b, emit } = blockingBackend(
        [aGroup({ dailyLimitOn: true, dailyLimitMinutes: 30 })],
        state([{ id: 'g-1', usedMinutes: 12, limitMinutes: 30 }]),
      )
      const { view } = setup({ blocking: b })
      await settle()
      expect(
        screen.getByText(/2 sites · Focus · Mon–Fri 9:00 AM – 5:00 PM · 30 min a day/),
      ).toBeInTheDocument()
      expect(usageRow(view, 'g-1')?.textContent).toBe('12 of 30 min today')
      act(() => emit(state([{ id: 'g-1', usedMinutes: 13, limitMinutes: 30 }])))
      expect(usageRow(view, 'g-1')?.textContent).toBe('13 of 30 min today')
    })

    it('once reached it reads "blocked until midnight"', async () => {
      const { b } = blockingBackend(
        [aGroup({ dailyLimitOn: true, dailyLimitMinutes: 30 })],
        state([{ id: 'g-1', usedMinutes: 30, limitMinutes: 30 }]),
      )
      const { view } = setup({ blocking: b })
      await settle()
      expect(usageRow(view, 'g-1')?.textContent).toBe(
        '30 of 30 min today · blocked until midnight',
      )
    })

    it('no usage line for a group without an allowance, or before the shell has it', async () => {
      const { b } = blockingBackend(
        [
          aGroup({ id: 'plain', name: 'Plain' }),
          aGroup({ id: 'fresh', name: 'Fresh', dailyLimitOn: true }),
        ],
        // A stale entry for a group whose allowance was just switched off.
        state([{ id: 'plain', usedMinutes: 3, limitMinutes: 30 }]),
      )
      const { view } = setup({ blocking: b })
      await settle()
      expect(usageRow(view, 'plain')).toBeNull()
      expect(usageRow(view, 'fresh')).toBeNull()
      expect(screen.queryByText(/min today/)).toBeNull()
    })
  })

  it('shows each installed browser\'s status; denied offers the settings button', async () => {
    const { b, emit } = blockingBackend([], {
      enabled: true,
      active: true,
      browsers: [
        { name: 'Google Chrome', status: 'ok' },
        { name: 'Safari', status: 'denied' },
        { name: 'Brave Browser', status: 'not_installed' },
        { name: 'Microsoft Edge', status: 'unknown' },
      ],
      usage: [],
      warning: null,
    })
    const { view } = setup({ blocking: b })
    await settle()
    const row = (name: string) =>
      view.container.querySelector(`[data-browser="${name}"]`) as HTMLElement | null
    expect(row('Google Chrome')?.textContent).toContain('Allowed')
    expect(row('Safari')?.textContent).toContain('Needs permission')
    expect(row('Brave Browser')).toBeNull()
    expect(row('Microsoft Edge')?.textContent).toContain('Checked when a block starts')
    fireEvent.click(btn('Open Automation settings'))
    expect(b.openAutomation).toHaveBeenCalledTimes(1)

    act(() =>
      emit({
        enabled: true,
        active: true,
        browsers: [{ name: 'Safari', status: 'timeout' }],
        usage: [],
        warning: null,
      }),
    )
    expect(row('Safari')?.textContent).toContain("Didn't respond")
  })

  it('Check browsers asks the shell', async () => {
    const { b } = blockingBackend([], {
      enabled: true,
      active: false,
      browsers: [{ name: 'Google Chrome', status: 'not_running' }],
      usage: [],
      warning: null,
    })
    setup({ blocking: b })
    await settle()
    fireEvent.click(btn('Check browsers'))
    await waitFor(() => expect(b.check).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Not running')).toBeInTheDocument()
  })

  it('without a blocking backend there is no Blocking section', async () => {
    setup()
    await settle()
    expect(screen.queryByRole('group', { name: 'Blocking' })).toBeNull()
  })
})
