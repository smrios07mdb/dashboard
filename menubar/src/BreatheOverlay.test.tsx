import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { syncDelay, type MeditationSnapshot } from './meditation'

const h = vi.hoisted(() => ({
  state: vi.fn<() => Promise<unknown>>(async () => null),
  end: vi.fn<() => Promise<unknown>>(async () => null),
  emit: (() => {}) as (s: unknown) => void,
}))

vi.mock('./native', () => ({
  meditationState: h.state,
  meditationEnd: h.end,
  watchMeditation: (on: (s: unknown) => void) => {
    h.emit = on
    return () => {
      h.emit = () => {}
    }
  },
}))

import BreatheOverlay from './BreatheOverlay'

const NOW = 1_800_000_000_000
const running = (startedAt: number, endsAt: number): MeditationSnapshot => ({
  status: 'running',
  dueAt: null,
  startedAt,
  endsAt,
  length: 5,
  pauseSpotify: true,
  nextDueAt: null,
})

function motion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

async function mount(s: MeditationSnapshot | null) {
  h.state.mockResolvedValue(s)
  const view = render(<BreatheOverlay />)
  await act(async () => {
    await Promise.resolve()
  })
  return view
}

describe('BreatheOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    h.state.mockClear()
    h.end.mockClear()
    motion(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('the delay puts every display at the same point of the 10 s cycle', () => {
    expect(syncDelay(NOW, NOW)).toBe(0)
    expect(syncDelay(NOW, NOW + 3_200)).toBe(-3200)
    expect(syncDelay(NOW, NOW + 10_000)).toBe(0)
    expect(syncDelay(NOW, NOW + 78_000 + 450)).toBe(-8450)
    // A clock read a hair before the start still gives a delay inside a cycle.
    expect(syncDelay(NOW, NOW - 100)).toBe(-9900)
  })

  it('the animations start from startedAt, whenever this window loaded', async () => {
    const { container } = await mount(running(NOW - 23_700, NOW + 222_000))
    const veil = container.querySelector('.bo-veil') as HTMLElement
    expect(veil.style.getPropertyValue('--bo-delay')).toBe('-3700ms')
    expect(screen.getByText('Breathe in')).toBeInTheDocument()
    expect(screen.getByText('Breathe out')).toBeInTheDocument()
    // A later snapshot of the same session does not shift the phase.
    vi.setSystemTime(NOW + 4_000)
    act(() => h.emit(running(NOW - 23_700, NOW + 222_000)))
    expect(veil.style.getPropertyValue('--bo-delay')).toBe('-3700ms')
  })

  it('the time left is read from endsAt, not counted', async () => {
    await mount(running(NOW - 78_000, NOW + 222_000))
    expect(screen.getByText('3:42 LEFT · ESC TO END')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByText('3:41 LEFT · ESC TO END')).toBeInTheDocument()
    // The clock jumps (a sleep): the next draw is right at once.
    vi.setSystemTime(NOW + 200_000)
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByText('0:21 LEFT · ESC TO END')).toBeInTheDocument()
  })

  it('Esc ends the session', async () => {
    await mount(running(NOW, NOW + 300_000))
    fireEvent.keyDown(window, { key: 'a' })
    expect(h.end).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('reduced motion: nothing moves and the words stay on Breathe in', async () => {
    motion(true)
    const { container } = await mount(running(NOW - 6_000, NOW + 294_000))
    const veil = container.querySelector('.bo-veil') as HTMLElement
    expect(veil.dataset.still).toBe('true')
    expect(veil.style.getPropertyValue('--bo-delay')).toBe('')
    expect(screen.getByText('Breathe in')).toBeInTheDocument()
    expect(screen.queryByText('Breathe out')).toBeNull()
    expect(screen.getByText('4:54 LEFT · ESC TO END')).toBeInTheDocument()
  })

  it('without a session it draws only the veil', async () => {
    const { container } = await mount(null)
    expect(container.querySelector('.bo-veil')).not.toBeNull()
    expect(screen.queryByText('Breathe in')).toBeNull()
    act(() => h.emit(running(NOW, NOW + 300_000)))
    expect(screen.getByText('Breathe in')).toBeInTheDocument()
    act(() => h.emit({ ...running(NOW, NOW + 300_000), status: 'none', startedAt: null, endsAt: null }))
    expect(screen.queryByText('Breathe in')).toBeNull()
  })
})
