import { describe, expect, it } from 'vitest'

import { windowsFor } from './blockSchedule'

/*
 * Chunk 99 (D17). Expectations are built with the local `Date` constructor,
 * so every case holds under TZ=America/New_York, UTC and Asia/Tokyo.
 */

const at = (y: number, mo: number, d: number, h = 0, m = 0) =>
  new Date(y, mo - 1, d, h, m).getTime()

const weekdays = {
  blockOnSchedule: true,
  scheduleDays: [1, 2, 3, 4, 5],
  scheduleFrom: '09:00',
  scheduleTo: '17:00',
}

describe('windowsFor (chunk 99, D17)', () => {
  it('nothing when the schedule is off', () => {
    expect(
      windowsFor({ ...weekdays, blockOnSchedule: false }, new Date(2026, 10, 11, 10)),
    ).toEqual([])
  })

  it('Mon–Fri 9–5 from a Wednesday morning: today and the next 13 days', () => {
    // Wed 11 Nov 2026, 10:00 — inside today's window, which is kept.
    const w = windowsFor(weekdays, new Date(2026, 10, 11, 10))
    expect(w[0]).toEqual([at(2026, 11, 11, 9), at(2026, 11, 11, 17)])
    expect(w[1]).toEqual([at(2026, 11, 12, 9), at(2026, 11, 12, 17)])
    // Wed 11 → Tue 24 holds 10 weekdays.
    expect(w).toHaveLength(10)
    expect(w.at(-1)).toEqual([at(2026, 11, 24, 9), at(2026, 11, 24, 17)])
  })

  it('skips a day not in scheduleDays', () => {
    // Sat 14 Nov 12:00: the next weekday window is Monday's.
    const w = windowsFor(weekdays, new Date(2026, 10, 14, 12))
    expect(w[0]).toEqual([at(2026, 11, 16, 9), at(2026, 11, 16, 17)])
    expect(new Date(w[0][0]).getHours()).toBe(9)
  })

  it('drops a window already ended', () => {
    const w = windowsFor(weekdays, new Date(2026, 10, 11, 17, 0))
    expect(w[0]).toEqual([at(2026, 11, 12, 9), at(2026, 11, 12, 17)])
  })

  it('a past-midnight window belongs to its start day; yesterday\'s still counts', () => {
    const night = {
      blockOnSchedule: true,
      scheduleDays: [2], // Tuesday
      scheduleFrom: '22:00',
      scheduleTo: '06:00',
    }
    // Wed 11 Nov 03:00 — inside Tuesday's 22:00 → Wednesday 06:00.
    const w = windowsFor(night, new Date(2026, 10, 11, 3))
    expect(w[0]).toEqual([at(2026, 11, 10, 22), at(2026, 11, 11, 6)])
    expect(w[1]).toEqual([at(2026, 11, 17, 22), at(2026, 11, 18, 6)])
    expect(w).toHaveLength(3)
  })

  it('from == to is a full day, and adjacent days merge into one window', () => {
    const allDay = {
      blockOnSchedule: true,
      scheduleDays: [6, 0], // Sat, Sun
      scheduleFrom: '00:00',
      scheduleTo: '00:00',
    }
    const w = windowsFor(allDay, new Date(2026, 10, 11, 12))
    expect(w[0]).toEqual([at(2026, 11, 14), at(2026, 11, 16)])
    expect(w[1]).toEqual([at(2026, 11, 21), at(2026, 11, 23)])
    expect(w).toHaveLength(2)
  })

  it('follows the local clock across the November DST change', () => {
    // Sun 1 Nov 2026: US clocks fall back at 02:00.
    const sat = {
      blockOnSchedule: true,
      scheduleDays: [6],
      scheduleFrom: '22:00',
      scheduleTo: '06:00',
    }
    const w = windowsFor(sat, new Date(2026, 9, 31, 12))
    expect(w[0]).toEqual([at(2026, 10, 31, 22), at(2026, 11, 1, 6)])
    const hours = (w[0][1] - w[0][0]) / 3_600_000
    expect(hours).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York' ? 9 : 8,
    )
  })

  it('across the March DST change', () => {
    // Sun 8 Mar 2026: US clocks spring forward at 02:00.
    const sun = { ...weekdays, scheduleDays: [0] }
    const w = windowsFor(sun, new Date(2026, 2, 7, 12))
    expect(w[0]).toEqual([at(2026, 3, 8, 9), at(2026, 3, 8, 17)])
    expect(w[0][1] - w[0][0]).toBe(8 * 3_600_000)
  })
})
