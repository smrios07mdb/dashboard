import { describe, expect, it } from 'vitest'

import { DEFAULT_MEDITATION, type MeditationPrefs } from './meditationPrefs'
import { dayTimes, dueTimes, SCHEDULE_DAYS } from './meditationSchedule'

const HOUR = 3_600_000
const clock = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const day = (t: number) => new Date(t).getDate()
const times = (list: string[]): MeditationPrefs => ({
  ...DEFAULT_MEDITATION,
  mode: 'times',
  times: list,
})

describe('meditationSchedule', () => {
  it('the defaults give six a day: every 90 minutes, strictly before 18:00', () => {
    expect(dayTimes(DEFAULT_MEDITATION).map((m) => `${Math.floor(m / 60)}:${m % 60}`)).toEqual([
      '9:0',
      '10:30',
      '12:0',
      '13:30',
      '15:0',
      '16:30',
    ])
    // A time that lands on `to` is not due.
    expect(dayTimes({ ...DEFAULT_MEDITATION, every: 60, from: '09:00', to: '11:00' })).toEqual([
      540, 600,
    ])
    expect(dayTimes({ ...DEFAULT_MEDITATION, every: 240, from: '09:00', to: '09:01' })).toEqual([540])
    const now = new Date(2027, 0, 15, 6, 0)
    const due = dueTimes(DEFAULT_MEDITATION, now)
    expect(due.slice(0, 6).map(clock)).toEqual([
      '09:00',
      '10:30',
      '12:00',
      '13:30',
      '15:00',
      '16:30',
    ])
    expect(due.slice(0, 6).every((t) => day(t) === 15)).toBe(true)
  })

  it('covers 14 days, in order', () => {
    const now = new Date(2027, 0, 15, 6, 0)
    const due = dueTimes(DEFAULT_MEDITATION, now)
    expect(SCHEDULE_DAYS).toBe(14)
    expect(due).toHaveLength(6 * 14)
    expect([...due].sort((a, b) => a - b)).toEqual(due)
    expect(new Date(due[due.length - 1]).getDate()).toBe(28)
    expect(clock(due[due.length - 1])).toBe('16:30')
    // Across a month's end the dates roll over.
    const jan = dueTimes(times(['10:30']), new Date(2027, 0, 25, 6, 0))
    expect(jan.map(day)).toEqual([25, 26, 27, 28, 29, 30, 31, 1, 2, 3, 4, 5, 6, 7])
  })

  it('times mode: due at each listed time', () => {
    const now = new Date(2027, 0, 15, 6, 0)
    const due = dueTimes(times(['10:30', '13:00', '15:30']), now)
    expect(due).toHaveLength(3 * 14)
    expect(due.slice(0, 4).map(clock)).toEqual(['10:30', '13:00', '15:30', '10:30'])
    expect(dayTimes(times(['15:30', '07:05']))).toEqual([425, 930])
  })

  it('times already past are not sent', () => {
    const now = new Date(2027, 0, 15, 13, 0)
    const due = dueTimes(times(['10:30', '13:00', '15:30']), now)
    // 10:30 is past, and so is 13:00 on the dot.
    expect(due).toHaveLength(3 * 14 - 2)
    expect(clock(due[0])).toBe('15:30')
    expect(due.every((t) => t > now.getTime())).toBe(true)
    const every = dueTimes(DEFAULT_MEDITATION, new Date(2027, 0, 15, 12, 30))
    expect(every.slice(0, 3).map(clock)).toEqual(['13:30', '15:00', '16:30'])
  })

  it('enabled: false sends nothing', () => {
    expect(dueTimes({ ...DEFAULT_MEDITATION, enabled: false }, new Date(2027, 0, 15, 6, 0))).toEqual([])
  })

  it('a DST change keeps the local clock time', () => {
    // US clocks go forward on Sunday 14 March 2027, back on 7 November.
    for (const now of [new Date(2027, 2, 12, 12, 0), new Date(2027, 10, 5, 12, 0)]) {
      const due = dueTimes(times(['10:30', '15:30']), now)
      expect(due.map(clock)).toEqual(
        Array.from({ length: 27 }, (_, i) => (i % 2 === 0 ? '15:30' : '10:30')),
      )
      const mornings = due.filter((t) => clock(t) === '10:30')
      for (let i = 1; i < mornings.length; i++) {
        const [a, b] = [mornings[i - 1], mornings[i]]
        const shift = new Date(b).getTimezoneOffset() - new Date(a).getTimezoneOffset()
        // A day apart on the wall clock, whatever the offset did in between.
        expect(b - a).toBe(24 * HOUR + shift * 60_000)
      }
      if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York') {
        const gaps = new Set(mornings.slice(1).map((t, i) => (t - mornings[i]) / HOUR))
        expect([...gaps].sort()).toEqual(now.getMonth() === 2 ? [23, 24] : [24, 25])
      }
    }
  })
})
