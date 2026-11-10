import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { timeText } from '@/lib/whenLabel'

import {
  createMeditation,
  idleMeditation,
  type MeditationBackend,
  type MeditationSnapshot,
} from './meditation'
import MeditationPanel from './MeditationPanel'
import { DEFAULT_MEDITATION } from './meditationPrefs'

const NOW = new Date(2027, 0, 15, 10, 25, 1).getTime()
const DUE = new Date(2027, 0, 15, 10, 30).getTime()
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const snap = (over: Partial<MeditationSnapshot> = {}): MeditationSnapshot => ({
  ...idleMeditation(DEFAULT_MEDITATION),
  ...over,
})

function mount(first: MeditationSnapshot, hotkeyError: string | null = null) {
  let emit: (s: MeditationSnapshot) => void = () => {}
  const ok = async () => snap() as MeditationSnapshot | null
  const b = {
    state: vi.fn(async () => first as MeditationSnapshot | null),
    configure: vi.fn(ok),
    start: vi.fn(ok),
    snooze: vi.fn(ok),
    skip: vi.fn(ok),
    end: vi.fn(ok),
    watch: (on: (s: MeditationSnapshot) => void) => {
      emit = on
      return () => {}
    },
  } satisfies MeditationBackend
  const meditation = createMeditation(b)
  meditation.start()
  render(
    <MeditationPanel
      meditation={meditation}
      hotkey="Alt+Shift+M"
      hotkeyError={hotkeyError}
    />,
  )
  act(() => emit(first))
  return { b, emit: (s: MeditationSnapshot) => act(() => emit(s)) }
}

describe('MeditationPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('shows nothing without a reminder, or during a session', () => {
    const { emit } = mount(snap())
    expect(screen.queryByRole('region')).toBeNull()
    emit(snap({ status: 'running', startedAt: NOW, endsAt: NOW + 300_000 }))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('heads-up: the due time in this Mac’s zone and a countdown', () => {
    mount(snap({ status: 'heads_up', dueAt: DUE }))
    expect(timeText(new Date(DUE), ZONE)).toBe('10:30 AM')
    expect(screen.getByText('Breathe at 10:30 AM')).toBeInTheDocument()
    expect(screen.getByText('5-minute session · in 4:59')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Start now',
      'Snooze 5',
      'Snooze 15',
      'Skip',
    ])
  })

  it('the countdown moves once a second while shown', () => {
    mount(snap({ status: 'heads_up', dueAt: DUE, length: 3 }))
    expect(screen.getByText('3-minute session · in 4:59')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByText('3-minute session · in 4:58')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(58_000))
    expect(screen.getByText('3-minute session · in 4:00')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(239_000))
    expect(screen.getByText('3-minute session · in 0:01')).toBeInTheDocument()
  })

  it('due: the calm Start session button with its hotkey', () => {
    mount(snap({ status: 'due', dueAt: DUE }))
    expect(screen.getByText('Time to breathe')).toBeInTheDocument()
    expect(
      screen.getByText('5 minutes. Spotify pauses, Esc ends it.'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Start session ⌥⇧M',
      'Snooze 5',
      'Snooze 15',
      'Skip',
    ])
    expect(screen.queryByText('Start now')).toBeNull()
  })

  it('drops "Spotify pauses" when the session will not pause it', () => {
    mount(snap({ status: 'due', dueAt: DUE, length: 10, pauseSpotify: false }))
    expect(screen.getByText('10 minutes. Esc ends it.')).toBeInTheDocument()
  })

  it('each button sends its command', () => {
    const { b, emit } = mount(snap({ status: 'heads_up', dueAt: DUE }))
    fireEvent.click(screen.getByText('Start now'))
    expect(b.start).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Snooze 5'))
    expect(b.snooze).toHaveBeenLastCalledWith(5)
    fireEvent.click(screen.getByText('Snooze 15'))
    expect(b.snooze).toHaveBeenLastCalledWith(15)
    fireEvent.click(screen.getByText('Skip'))
    expect(b.skip).toHaveBeenCalledTimes(1)

    emit(snap({ status: 'due', dueAt: DUE }))
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }))
    expect(b.start).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText('Snooze 15'))
    expect(b.snooze).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByText('Skip'))
    expect(b.skip).toHaveBeenCalledTimes(2)
    expect(b.end).not.toHaveBeenCalled()
  })

  it('says when ⌥⇧M is taken', () => {
    mount(snap({ status: 'due', dueAt: DUE }), '⌥⇧M is taken by another app')
    expect(screen.getByRole('status')).toHaveTextContent('⌥⇧M is taken by another app')
  })
})
