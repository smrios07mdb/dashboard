import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_POMODORO,
  POMODORO_KEY,
  readPomodoroPrefs,
  savePomodoroPrefs,
} from './pomodoroPrefs'

describe('pomodoro prefs', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to 25 / 5 / 15, a long break every 4, full tray text', () => {
    expect(DEFAULT_POMODORO).toEqual({
      focus: 25,
      short: 5,
      long: 15,
      every: 4,
      compact: false,
    })
    expect(readPomodoroPrefs()).toEqual(DEFAULT_POMODORO)
  })

  it('reads a stored override', () => {
    const stored = { focus: 50, short: 10, long: 30, every: 2, compact: true }
    localStorage.setItem(POMODORO_KEY, JSON.stringify(stored))
    expect(readPomodoroPrefs()).toEqual(stored)
  })

  it('falls back field by field', () => {
    localStorage.setItem(
      POMODORO_KEY,
      JSON.stringify({
        focus: 181, // out of range
        short: 10,
        long: '30', // not a number
        every: 2.5, // not whole
        compact: 'yes', // not a boolean
        extra: 1,
      }),
    )
    expect(readPomodoroPrefs()).toEqual({
      focus: 25,
      short: 10,
      long: 15,
      every: 4,
      compact: false,
    })
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ focus: 0, every: 13 }))
    expect(readPomodoroPrefs()).toEqual(DEFAULT_POMODORO)
    localStorage.setItem(POMODORO_KEY, JSON.stringify({ short: 60, long: 90 }))
    expect(readPomodoroPrefs()).toEqual({ ...DEFAULT_POMODORO, short: 60, long: 90 })
  })

  it('survives junk', () => {
    localStorage.setItem(POMODORO_KEY, '{not json')
    expect(readPomodoroPrefs()).toEqual(DEFAULT_POMODORO)
    localStorage.setItem(POMODORO_KEY, '[1,2]')
    expect(readPomodoroPrefs()).toEqual(DEFAULT_POMODORO)
    localStorage.setItem(POMODORO_KEY, 'null')
    expect(readPomodoroPrefs()).toEqual(DEFAULT_POMODORO)
  })

  it('saves and reads back', () => {
    const next = { ...DEFAULT_POMODORO, focus: 1, short: 1 }
    savePomodoroPrefs(next)
    expect(readPomodoroPrefs()).toEqual(next)
  })
})
