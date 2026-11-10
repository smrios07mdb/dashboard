import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_MEDITATION,
  MEDITATION_KEY,
  readMeditationPrefs,
  saveMeditationPrefs,
  type MeditationPrefs,
} from './meditationPrefs'

const store = (v: unknown) =>
  localStorage.setItem(MEDITATION_KEY, JSON.stringify(v))

describe('meditationPrefs', () => {
  beforeEach(() => localStorage.clear())

  it('defaults', () => {
    expect(DEFAULT_MEDITATION).toEqual({
      enabled: true,
      length: 5,
      mode: 'every',
      every: 90,
      from: '09:00',
      to: '18:00',
      times: ['10:30', '13:00', '15:30'],
      headsUp: 5,
      pauseSpotify: true,
    })
    expect(readMeditationPrefs()).toEqual(DEFAULT_MEDITATION)
    localStorage.setItem(MEDITATION_KEY, '{not json')
    expect(readMeditationPrefs()).toEqual(DEFAULT_MEDITATION)
    store([1, 2])
    expect(readMeditationPrefs()).toEqual(DEFAULT_MEDITATION)
  })

  it('reads stored values', () => {
    const stored: MeditationPrefs = {
      enabled: false,
      length: 10,
      mode: 'times',
      every: 45,
      from: '08:15',
      to: '20:00',
      times: ['07:05', '21:40'],
      headsUp: 0,
      pauseSpotify: false,
    }
    store(stored)
    expect(readMeditationPrefs()).toEqual(stored)
    saveMeditationPrefs({ ...stored, length: 3 })
    expect(readMeditationPrefs().length).toBe(3)
  })

  it('an invalid field falls back on its own', () => {
    store({
      enabled: 'yes',
      length: 4,
      mode: 'weekly',
      every: 14,
      headsUp: 31,
      pauseSpotify: 0,
      times: ['11:00'],
    })
    expect(readMeditationPrefs()).toEqual({
      ...DEFAULT_MEDITATION,
      times: ['11:00'],
    })
    store({ every: 15, headsUp: 30, length: 3 })
    expect(readMeditationPrefs()).toMatchObject({ every: 15, headsUp: 30, length: 3 })
    store({ every: 240.5, headsUp: -1 })
    expect(readMeditationPrefs()).toMatchObject({ every: 90, headsUp: 5 })
    store({ every: 241 })
    expect(readMeditationPrefs().every).toBe(90)
  })

  it('from must be a time before to', () => {
    store({ from: '18:00', to: '18:00' })
    expect(readMeditationPrefs()).toMatchObject({ from: '09:00', to: '18:00' })
    store({ from: '19:30', to: '08:00' })
    expect(readMeditationPrefs()).toMatchObject({ from: '09:00', to: '18:00' })
    // One bad bound falls back alone when the pair still makes sense.
    store({ from: '9:00', to: '12:00' })
    expect(readMeditationPrefs()).toMatchObject({ from: '09:00', to: '12:00' })
    store({ from: '07:00', to: '24:00' })
    expect(readMeditationPrefs()).toMatchObject({ from: '07:00', to: '18:00' })
    // …and the whole pair when it does not.
    store({ from: '19:00', to: '25:61' })
    expect(readMeditationPrefs()).toMatchObject({ from: '09:00', to: '18:00' })
  })

  it('times: duplicates and invalid entries are dropped, the rest sorted', () => {
    store({ times: ['15:30', '09:00', '15:30', '9:5', 'noon', 7, '23:59', '24:00'] })
    expect(readMeditationPrefs().times).toEqual(['09:00', '15:30', '23:59'])
    store({ times: [] })
    expect(readMeditationPrefs().times).toEqual(DEFAULT_MEDITATION.times)
    store({ times: ['25:00', 'x'] })
    expect(readMeditationPrefs().times).toEqual(DEFAULT_MEDITATION.times)
    store({ times: '10:30' })
    expect(readMeditationPrefs().times).toEqual(DEFAULT_MEDITATION.times)
    const twelve = Array.from({ length: 12 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`)
    store({ times: twelve })
    expect(readMeditationPrefs().times).toEqual(twelve)
    store({ times: [...twelve, '20:30'] })
    expect(readMeditationPrefs().times).toEqual(DEFAULT_MEDITATION.times)
  })
})
