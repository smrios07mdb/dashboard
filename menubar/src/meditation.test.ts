import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configFor,
  countdownText,
  createMeditation,
  idleMeditation,
  type MeditationBackend,
  type MeditationSnapshot,
} from './meditation'
import { DEFAULT_MEDITATION, MEDITATION_KEY, readMeditationPrefs } from './meditationPrefs'

const NOW = new Date(2027, 0, 15, 10, 0)
const snap = (over: Partial<MeditationSnapshot> = {}): MeditationSnapshot => ({
  ...idleMeditation(DEFAULT_MEDITATION),
  ...over,
})

function backend(state: MeditationSnapshot = snap()) {
  let emit: (s: MeditationSnapshot) => void = () => {}
  const b = {
    state: vi.fn(async () => state as MeditationSnapshot | null),
    configure: vi.fn(async () => state as MeditationSnapshot | null),
    start: vi.fn(async () => snap({ status: 'running' }) as MeditationSnapshot | null),
    snooze: vi.fn(async () => snap() as MeditationSnapshot | null),
    skip: vi.fn(async () => snap() as MeditationSnapshot | null),
    end: vi.fn(async () => snap() as MeditationSnapshot | null),
    watch: vi.fn((on: (s: MeditationSnapshot) => void) => {
      emit = on
      return () => {
        emit = () => {}
      }
    }),
  } satisfies MeditationBackend
  return { b, emit: (s: MeditationSnapshot) => emit(s) }
}

describe('meditation', () => {
  beforeEach(() => localStorage.clear())

  it('the idle snapshot carries the stored length and Spotify choice', () => {
    expect(idleMeditation({ ...DEFAULT_MEDITATION, length: 10, pauseSpotify: false })).toEqual({
      status: 'none',
      dueAt: null,
      startedAt: null,
      endsAt: null,
      length: 10,
      pauseSpotify: false,
      nextDueAt: null,
    })
  })

  it('configFor: the due times, the settings and this Mac’s UTC offset', () => {
    const c = configFor(DEFAULT_MEDITATION, NOW)
    expect(c.due).toHaveLength(6 * 14 - 1)
    expect(new Date(c.due[0]).getHours()).toBe(10)
    expect(c).toMatchObject({ headsUp: 5, length: 5, pauseSpotify: true })
    expect(c.utcOffset).toBe(-NOW.getTimezoneOffset())
    expect(configFor({ ...DEFAULT_MEDITATION, enabled: false }, NOW).due).toEqual([])
  })

  it('counts down in m:ss, seconds rounded up', () => {
    expect(countdownText(299_000)).toBe('4:59')
    expect(countdownText(298_001)).toBe('4:59')
    expect(countdownText(300_000)).toBe('5:00')
    expect(countdownText(7_000)).toBe('0:07')
    expect(countdownText(-5)).toBe('0:00')
  })

  it('signed in and on every show: the schedule goes to the shell', async () => {
    const { b } = backend(snap({ nextDueAt: 5 }))
    const m = createMeditation(b, () => NOW)
    await m.shown()
    expect(b.configure).not.toHaveBeenCalled()
    await m.signedIn()
    expect(b.configure).toHaveBeenCalledWith(configFor(DEFAULT_MEDITATION, NOW))
    expect(m.getState().snapshot.nextDueAt).toBe(5)
    await m.shown()
    expect(b.configure).toHaveBeenCalledTimes(2)
  })

  it('signed out: the session ends and the schedule is cleared', async () => {
    const { b } = backend()
    const m = createMeditation(b, () => NOW)
    await m.signedIn()
    b.configure.mockClear()
    await m.signedOut()
    expect(b.end).toHaveBeenCalledTimes(1)
    expect(b.configure).toHaveBeenCalledWith({ ...configFor(DEFAULT_MEDITATION, NOW), due: [] })
    await m.shown()
    expect(b.configure).toHaveBeenCalledTimes(1)
  })

  it('saving prefs stores them and reconfigures', async () => {
    const { b } = backend()
    const m = createMeditation(b, () => NOW)
    await m.signedIn()
    const prefs = { ...DEFAULT_MEDITATION, length: 10 as const, headsUp: 0 }
    await m.savePrefs(prefs)
    expect(JSON.parse(localStorage.getItem(MEDITATION_KEY)!)).toEqual(prefs)
    expect(readMeditationPrefs().length).toBe(10)
    expect(b.configure).toHaveBeenLastCalledWith(configFor(prefs, NOW))
  })

  it('follows the shell’s events and commands', async () => {
    const { b, emit } = backend()
    const m = createMeditation(b, () => NOW)
    const listener = vi.fn()
    m.subscribe(listener)
    const stop = m.start()
    await vi.waitFor(() => expect(b.state).toHaveBeenCalled())
    emit(snap({ status: 'due', dueAt: 9 }))
    expect(m.getState().snapshot.status).toBe('due')
    expect(listener).toHaveBeenCalled()
    await m.snooze(15)
    expect(b.snooze).toHaveBeenCalledWith(15)
    await m.skip()
    expect(b.skip).toHaveBeenCalledTimes(1)
    await m.startSession()
    expect(m.getState().snapshot.status).toBe('running')
    await m.end()
    expect(m.getState().snapshot.status).toBe('none')
    stop()
  })

  it('a rejected command re-reads the state instead of throwing', async () => {
    const { b } = backend(snap({ status: 'running' }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.start.mockRejectedValueOnce('a session is already running')
    const m = createMeditation(b, () => NOW)
    await expect(m.startSession()).resolves.toBeUndefined()
    expect(b.state).toHaveBeenCalledTimes(1)
    expect(m.getState().snapshot.status).toBe('running')
    error.mockRestore()
  })

  it('⌥⇧M starts a session only while signed in', async () => {
    const { b } = backend()
    const m = createMeditation(b, () => NOW)
    await m.hotkey()
    expect(b.start).not.toHaveBeenCalled()
    await m.signedIn()
    await m.hotkey()
    expect(b.start).toHaveBeenCalledTimes(1)
  })

  it('⌥⇧F does nothing while a session runs', async () => {
    const running = backend(snap({ status: 'running' }))
    const toggle = vi.fn(async () => {})
    await createMeditation(running.b, () => NOW).unlessRunning(toggle)
    expect(running.b.state).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()

    for (const status of ['none', 'heads_up', 'due'] as const) {
      const { b } = backend(snap({ status }))
      await createMeditation(b, () => NOW).unlessRunning(toggle)
    }
    expect(toggle).toHaveBeenCalledTimes(3)
    // No shell (a browser), or a failed read: focus still toggles.
    const none = backend()
    none.b.state.mockResolvedValueOnce(null)
    await createMeditation(none.b, () => NOW).unlessRunning(toggle)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    none.b.state.mockRejectedValueOnce(new Error('gone'))
    await createMeditation(none.b, () => NOW).unlessRunning(toggle)
    expect(toggle).toHaveBeenCalledTimes(5)
    error.mockRestore()
  })
})
