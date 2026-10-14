import { describe, expect, it } from 'vitest'

import type { BusyRange } from '@/db/types'

import { freeMinutesToday } from './freeToday'

/*
 * Free minutes left today (chunk 87, D5): 09:00–18:00 in the given zone, from
 * now rounded up to 15 min, minus merged busy. `now` is injected and every
 * instant is written with its offset, so the result is the same in any
 * process TZ.
 */

const NY = 'America/New_York'
// 2026-10-14 is a Wednesday; New York is on EDT (UTC−4).
const at = (hm: string) => new Date(`2026-10-14T${hm}:00-04:00`)
const busy = (start: string, end: string): BusyRange =>
  ({ start, end }) as BusyRange
const ny = (hm: string) => `2026-10-14T${hm}:00-04:00`

describe('freeMinutesToday', () => {
  it('counts the whole window before 09:00', () => {
    expect(freeMinutesToday([], NY, at('07:00'))).toBe(540)
  })

  it('counts from now rounded up to 15 min', () => {
    expect(freeMinutesToday([], NY, at('10:07'))).toBe(465)
    // Already on a quarter: no rounding.
    expect(freeMinutesToday([], NY, at('10:15'))).toBe(465)
  })

  it('merges overlapping busy ranges once', () => {
    const ranges = [
      busy(ny('12:00'), ny('13:00')),
      busy(ny('12:30'), ny('14:00')),
    ]
    expect(freeMinutesToday(ranges, NY, at('07:00'))).toBe(540 - 120)
  })

  it('clips busy that straddles the window edges', () => {
    const ranges = [
      busy(ny('08:00'), ny('09:30')),
      busy(ny('17:30'), ny('19:00')),
    ]
    expect(freeMinutesToday(ranges, NY, at('07:00'))).toBe(540 - 30 - 30)
  })

  it('clips busy that started before now', () => {
    const ranges = [busy(ny('10:00'), ny('11:00'))]
    // Counted from 10:30: 450 left, of which 30 busy.
    expect(freeMinutesToday(ranges, NY, at('10:30'))).toBe(420)
  })

  it('is 0 after the window', () => {
    expect(freeMinutesToday([], NY, at('18:30'))).toBe(0)
    expect(freeMinutesToday([], NY, at('17:50'))).toBe(0)
  })

  it('ignores a busy range on another day', () => {
    const ranges = [
      busy('2026-10-13T12:00:00-04:00', '2026-10-13T15:00:00-04:00'),
      busy('2026-10-15T09:00:00-04:00', '2026-10-15T18:00:00-04:00'),
    ]
    expect(freeMinutesToday(ranges, NY, at('07:00'))).toBe(540)
  })

  it('ignores an unparseable range', () => {
    expect(
      freeMinutesToday([busy('nope', ny('13:00'))], NY, at('07:00')),
    ).toBe(540)
  })

  it('uses the same window on a Saturday', () => {
    const sat = new Date('2026-10-17T07:00:00-04:00')
    expect(freeMinutesToday([], NY, sat)).toBe(540)
    expect(
      freeMinutesToday(
        [busy('2026-10-17T10:00:00-04:00', '2026-10-17T11:00:00-04:00')],
        NY,
        sat,
      ),
    ).toBe(480)
  })

  it('evaluates the same instant in the Tokyo window', () => {
    // 07:00 EDT = 20:00 JST: Tokyo's window is over.
    expect(freeMinutesToday([], 'Asia/Tokyo', at('07:00'))).toBe(0)
    // 21:07 EDT on the 13th = 10:07 JST on the 14th: from 10:15 JST.
    const instant = new Date('2026-10-13T21:07:00-04:00')
    expect(freeMinutesToday([], 'Asia/Tokyo', instant)).toBe(465)
    // Busy 12:00–13:00 JST counts in Tokyo, not in New York's frame.
    const tokyoNoon = busy(
      '2026-10-14T12:00:00+09:00',
      '2026-10-14T13:00:00+09:00',
    )
    expect(freeMinutesToday([tokyoNoon], 'Asia/Tokyo', instant)).toBe(405)
    // The same instant in New York is 21:07 on the 13th: nothing left.
    expect(freeMinutesToday([tokyoNoon], NY, instant)).toBe(0)
  })
})
