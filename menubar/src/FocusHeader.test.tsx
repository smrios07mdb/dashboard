import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const popover = vi.hoisted(() => ({
  set: (() => {}) as (shown: boolean) => void,
  watchers: 0,
}))

vi.mock('./native', () => ({
  watchPopover: (onChange: (shown: boolean) => void) => {
    popover.set = onChange
    popover.watchers++
    return () => {
      popover.watchers--
    }
  },
}))

import FocusHeader from './FocusHeader'
import {
  createPomodoro,
  idleSnapshot,
  type PomodoroBackend,
  type PomodoroSnapshot,
} from './pomodoro'
import { DEFAULT_POMODORO } from './pomodoroPrefs'

// 10 Nov 2026 14:38:00 UTC — 9:38 AM in New York.
const T0 = Date.UTC(2026, 10, 10, 14, 38, 0)
const MIN = 60_000

function snap(over: Partial<PomodoroSnapshot> = {}): PomodoroSnapshot {
  return { ...idleSnapshot(DEFAULT_POMODORO), ...over }
}

const FOCUS = snap({
  phase: 'focus',
  endsAt: T0 + 25 * MIN,
  phaseLenMs: 25 * MIN,
  remainingMs: 25 * MIN,
  cyclePos: 2,
  task: { id: 't1', title: 'Draft investor Q&A responses' },
})
const SHORT = snap({
  phase: 'short_break',
  endsAt: T0 + 5 * MIN,
  phaseLenMs: 5 * MIN,
  remainingMs: 5 * MIN,
  cyclePos: 2,
})

function setup(current: PomodoroSnapshot, hotkeyError: string | null = null) {
  // What the shell would answer; a test may change it.
  const cell = { current }
  const answer = async (): Promise<PomodoroSnapshot | null> => cell.current
  let emit: (s: PomodoroSnapshot) => void = () => {}
  const b = {
    cell,
    state: vi.fn(answer),
    configure: vi.fn(answer),
    start: vi.fn(answer),
    pause: vi.fn(answer),
    resume: vi.fn(answer),
    extend: vi.fn(answer),
    skip: vi.fn(answer),
    stop: vi.fn(answer),
    watch: (on: (s: PomodoroSnapshot) => void) => {
      emit = on
      return () => {}
    },
  } satisfies PomodoroBackend & Record<string, unknown>
  const pomodoro = createPomodoro(b)
  pomodoro.start()
  act(() => emit(current))
  render(
    <FocusHeader
      pomodoro={pomodoro}
      timeZone="America/New_York"
      hotkeyError={hotkeyError}
    />,
  )
  return b
}

const buttons = () => screen.getAllByRole('button').map((b) => b.textContent)
const show = (shown: boolean) => act(() => popover.set(shown))

describe('menubar FocusHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(T0)
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('idle: one row with the focus length and Start focus', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const b = setup(snap())
    expect(screen.getByText('Focus · 25 min')).toBeInTheDocument()
    expect(buttons()).toEqual(['Start focus'])
    expect(screen.queryByRole('timer')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Start focus' }))
    expect(b.start).toHaveBeenCalledWith(null)
  })

  it('idle: the length follows the config', () => {
    setup(snap({ config: { ...DEFAULT_POMODORO, focus: 50 } }))
    expect(screen.getByText('Focus · 50 min')).toBeInTheDocument()
  })

  it('idle: says when the hotkey is taken', () => {
    setup(snap(), '⌥⇧F is taken by another app')
    expect(screen.getByText('⌥⇧F is taken by another app')).toBeInTheDocument()
  })

  it('focus: label with the end time, countdown, task, cycle and controls', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const b = setup(FOCUS)
    expect(screen.getByText('Focus · ends 10:03 AM')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('25:00')
    expect(screen.getByText('Draft investor Q&A responses')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('OF 4')).toBeInTheDocument()
    expect(buttons()).toEqual(['Pause', '+5 min', 'Skip to break', 'End'])
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: '+5 min' }))
    await user.click(screen.getByRole('button', { name: 'Skip to break' }))
    await user.click(screen.getByRole('button', { name: 'End' }))
    expect(b.pause).toHaveBeenCalledTimes(1)
    expect(b.extend).toHaveBeenCalledTimes(1)
    expect(b.skip).toHaveBeenCalledTimes(1)
    expect(b.stop).toHaveBeenCalledTimes(1)
  })

  it('a bare focus is titled Focus', () => {
    setup(snap({ ...FOCUS, task: null }))
    expect(screen.getByText('Focus', { selector: '.mb-ftask' })).toBeInTheDocument()
  })

  it('the end time is in the Settings zone', () => {
    const b = setup(FOCUS)
    expect(b).toBeTruthy()
    expect(screen.queryByText(/ends 2:03|ends 14:03|ends 11:03/)).toBeNull()
  })

  it('short break: label and controls', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const b = setup(SHORT)
    expect(screen.getByText('Short break · ends 9:43 AM')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('05:00')
    expect(buttons()).toEqual(['Pause', '+5 min', 'Skip break'])
    await user.click(screen.getByRole('button', { name: 'Skip break' }))
    expect(b.skip).toHaveBeenCalledTimes(1)
  })

  it('long break: label', () => {
    setup(snap({ ...SHORT, phase: 'long_break', endsAt: T0 + 15 * MIN, phaseLenMs: 15 * MIN }))
    expect(screen.getByText('Long break · ends 9:53 AM')).toBeInTheDocument()
    expect(buttons()).toEqual(['Pause', '+5 min', 'Skip break'])
  })

  it('paused: the frozen time and Resume', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const b = setup(
      snap({ ...FOCUS, paused: true, endsAt: null, remainingMs: 16 * MIN + 48_000 }),
    )
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('16:48')
    expect(buttons()).toEqual(['Resume', '+5 min', 'Skip to break', 'End'])
    show(true)
    act(() => void vi.advanceTimersByTime(5000))
    expect(screen.getByRole('timer')).toHaveTextContent('16:48')
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(b.resume).toHaveBeenCalledTimes(1)

    // A paused break resumes too.
    setup(snap({ ...SHORT, paused: true, endsAt: null, remainingMs: 61_000 }))
    expect(screen.getAllByRole('timer')[1]).toHaveTextContent('01:01')
  })

  it('counts down from endsAt once a second while the popover is shown', () => {
    setup(FOCUS)
    show(true)
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByRole('timer')).toHaveTextContent('24:59')
    act(() => void vi.advanceTimersByTime(59_000))
    expect(screen.getByRole('timer')).toHaveTextContent('24:00')
    // From the wall clock, not from counting ticks: jump the clock (sleep).
    vi.setSystemTime(T0 + 20 * MIN)
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByRole('timer')).toHaveTextContent('04:59')
  })

  it('runs no interval while the popover is hidden', () => {
    setup(FOCUS)
    show(false)
    expect(vi.getTimerCount()).toBe(0)
    act(() => void vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('timer')).toHaveTextContent('25:00')

    show(true)
    expect(vi.getTimerCount()).toBe(1)
    act(() => void vi.advanceTimersByTime(2000))
    expect(screen.getByRole('timer')).toHaveTextContent('23:58')

    show(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs no interval while idle', () => {
    setup(snap())
    show(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('re-reads the state every time the popover is shown', async () => {
    const b = setup(FOCUS)
    const before = b.state.mock.calls.length
    // The break started while the web view was suspended; the event was lost.
    b.cell.current = SHORT
    show(true)
    expect(b.state).toHaveBeenCalledTimes(before + 1)
    expect(await screen.findByText('Short break · ends 9:43 AM')).toBeInTheDocument()
    show(false)
    show(true)
    expect(b.state).toHaveBeenCalledTimes(before + 2)
  })

  it('stops watching the popover on unmount', () => {
    const before = popover.watchers
    const b = setup(FOCUS)
    expect(b).toBeTruthy()
    expect(popover.watchers).toBe(before + 1)
  })
})
