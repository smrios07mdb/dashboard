import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clockText,
  createPomodoro,
  idleSnapshot,
  remainingAt,
  type PomodoroBackend,
  type PomodoroSnapshot,
} from './pomodoro'
import { DEFAULT_POMODORO, POMODORO_KEY } from './pomodoroPrefs'

const T0 = Date.UTC(2026, 10, 10, 15, 0, 0)

function snap(over: Partial<PomodoroSnapshot> = {}): PomodoroSnapshot {
  return { ...idleSnapshot(DEFAULT_POMODORO), ...over }
}

const FOCUS = snap({
  phase: 'focus',
  endsAt: T0 + 25 * 60_000,
  phaseLenMs: 25 * 60_000,
  remainingMs: 25 * 60_000,
})

/** A stand-in for the shell: `current` is what `pomodoro_state` returns. */
function backend(initial: PomodoroSnapshot | null = snap()) {
  const b = {
    current: initial,
    emit: (() => {}) as (s: PomodoroSnapshot) => void,
    watching: 0,
    state: vi.fn(async () => b.current),
    configure: vi.fn(async () => b.current),
    start: vi.fn(async () => b.current),
    pause: vi.fn(async () => b.current),
    resume: vi.fn(async () => b.current),
    extend: vi.fn(async () => b.current),
    skip: vi.fn(async () => b.current),
    stop: vi.fn(async () => b.current),
    watch: vi.fn((on: (s: PomodoroSnapshot) => void) => {
      b.emit = on
      b.watching++
      return () => {
        b.watching--
      }
    }),
  }
  return b satisfies PomodoroBackend & Record<string, unknown>
}

describe('pomodoro view helpers', () => {
  it('formats like the tray: mm:ss, h:mm:ss, seconds rounded up', () => {
    expect(clockText(25 * 60_000)).toBe('25:00')
    expect(clockText(25 * 60_000 - 1)).toBe('25:00')
    expect(clockText(24 * 60_000 + 59_000)).toBe('24:59')
    expect(clockText(1)).toBe('00:01')
    expect(clockText(0)).toBe('00:00')
    expect(clockText(90 * 60_000)).toBe('1:30:00')
    expect(clockText(60 * 60_000)).toBe('1:00:00')
    expect(clockText(60 * 60_000 - 1000)).toBe('59:59')
  })

  it('takes the time left from endsAt, frozen while paused', () => {
    expect(remainingAt(FOCUS, T0 + 60_000)).toBe(24 * 60_000)
    expect(remainingAt(FOCUS, T0 + 99 * 60_000)).toBe(0)
    const paused = snap({ ...FOCUS, paused: true, endsAt: null, remainingMs: 7000 })
    expect(remainingAt(paused, T0 + 60_000)).toBe(7000)
    expect(remainingAt(snap(), T0)).toBe(0)
  })
})

describe('pomodoro controller', () => {
  beforeEach(() => localStorage.clear())

  it('starts idle with the stored config, before the shell answers', () => {
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ focus: 50 }))
    const p = createPomodoro(backend(null))
    expect(p.getState().snapshot).toEqual(
      idleSnapshot({ ...DEFAULT_POMODORO, focus: 50 }),
    )
  })

  it('start reads the state and follows pomodoro events until stopped', async () => {
    const b = backend(FOCUS)
    const p = createPomodoro(b, () => T0 + 5)
    const listener = vi.fn()
    p.subscribe(listener)
    const stop = p.start()
    await vi.waitFor(() => expect(p.getState().snapshot).toEqual(FOCUS))
    expect(p.getState().at).toBe(T0 + 5)
    const paused = snap({ ...FOCUS, paused: true, endsAt: null })
    b.emit(paused)
    expect(p.getState().snapshot).toEqual(paused)
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    expect(b.watching).toBe(0)
  })

  it('signed in sends the stored config; signed out stops the session', async () => {
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ focus: 1, short: 1 }))
    const b = backend()
    const p = createPomodoro(b)
    await p.signedIn()
    expect(b.configure).toHaveBeenCalledWith({ ...DEFAULT_POMODORO, focus: 1, short: 1 })
    expect(b.stop).not.toHaveBeenCalled()
    await p.signedOut()
    expect(b.stop).toHaveBeenCalledTimes(1)
  })

  it('saveConfig stores the prefs and sends them', async () => {
    const b = backend(null)
    const p = createPomodoro(b)
    const next = { ...DEFAULT_POMODORO, focus: 45, compact: true }
    await p.saveConfig(next)
    expect(JSON.parse(localStorage.getItem(POMODORO_KEY)!)).toEqual(next)
    expect(b.configure).toHaveBeenCalledWith(next)
    // No shell (a browser): the idle row still shows the new length.
    expect(p.getState().snapshot.config).toEqual(next)
  })

  it('commands go to the shell and its answer becomes the state', async () => {
    const b = backend()
    const p = createPomodoro(b)
    b.current = FOCUS
    await p.startFocus({ id: 't1', title: 'Draft' })
    expect(b.start).toHaveBeenCalledWith({ id: 't1', title: 'Draft' })
    expect(p.getState().snapshot).toEqual(FOCUS)
    await p.pause()
    await p.resume()
    await p.extend()
    await p.skip()
    await p.stop()
    for (const f of [b.pause, b.resume, b.extend, b.skip, b.stop]) {
      expect(f).toHaveBeenCalledTimes(1)
    }
  })

  it('a rejected command re-reads the state', async () => {
    const b = backend()
    const p = createPomodoro(b)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.start.mockRejectedValueOnce('focus is already running')
    b.current = FOCUS
    await p.startFocus(null)
    expect(b.state).toHaveBeenCalledTimes(1)
    expect(p.getState().snapshot).toEqual(FOCUS)
    error.mockRestore()
  })

  describe('the hotkey (toggle)', () => {
    async function toggled(current: PomodoroSnapshot) {
      const b = backend(current)
      const p = createPomodoro(b)
      await p.signedIn()
      await p.toggle()
      return b
    }

    it('idle → a bare focus', async () => {
      const b = await toggled(snap())
      expect(b.start).toHaveBeenCalledWith(null)
    })

    it('a break → a bare focus', async () => {
      const b = await toggled(snap({ phase: 'short_break', endsAt: T0 }))
      expect(b.start).toHaveBeenCalledWith(null)
    })

    it('running focus → pause', async () => {
      const b = await toggled(FOCUS)
      expect(b.pause).toHaveBeenCalledTimes(1)
      expect(b.start).not.toHaveBeenCalled()
    })

    it('paused → resume, in focus and in a break', async () => {
      const b = await toggled(snap({ ...FOCUS, paused: true, endsAt: null }))
      expect(b.resume).toHaveBeenCalledTimes(1)
      const c = await toggled(snap({ phase: 'long_break', paused: true }))
      expect(c.resume).toHaveBeenCalledTimes(1)
      expect(c.start).not.toHaveBeenCalled()
    })

    it('acts on the shell’s state, not a stale one', async () => {
      const b = backend(snap())
      const p = createPomodoro(b)
      await p.signedIn()
      b.current = FOCUS // changed while the web view was suspended
      await p.toggle()
      expect(b.pause).toHaveBeenCalledTimes(1)
    })

    it('does nothing signed out', async () => {
      const b = backend(snap())
      const p = createPomodoro(b)
      await p.toggle()
      await p.signedIn()
      await p.signedOut()
      await p.toggle()
      expect(b.start).not.toHaveBeenCalled()
    })
  })
})
