import { describe, expect, it } from 'vitest'

import type { CapacityInterval } from './plannerCapacity'
import { computeCapacity, computeDayFree } from './plannerCapacity'

/*
 * Capacity math (chunk 36). The working window is Mon–Fri 09:00–18:00
 * (5 × 540m = 2700m/week). Chunk 36 always calls these with
 * `scheduled = []`; the non-empty scheduled cases below future-proof
 * chunk 37 (locked decision D5).
 */

const b = (day: number, startMin: number, endMin: number): CapacityInterval => ({
  day,
  startMin,
  endMin,
})

describe('computeCapacity', () => {
  it('returns the full window with no busy and no scheduled', () => {
    expect(computeCapacity([], [])).toEqual({ planned: 0, free: 2700 })
  })

  it('subtracts weekday busy clipped to 09:00–18:00', () => {
    const busy = [
      b(0, 570, 600), // 30m inside the window
      b(1, 480, 600), // 08:00–10:00 → only 09:00–10:00 counts (60m)
      b(2, 1050, 1140), // 17:30–19:00 → only 17:30–18:00 counts (30m)
    ]
    expect(computeCapacity(busy, [])).toEqual({ planned: 0, free: 2700 - 120 })
  })

  it('ignores weekend busy entirely', () => {
    const busy = [b(5, 600, 690), b(6, 900, 960)]
    expect(computeCapacity(busy, [])).toEqual({ planned: 0, free: 2700 })
  })

  it('counts scheduled toward planned everywhere but free only on weekdays in-window', () => {
    const scheduled = [
      b(0, 600, 645), // 45m weekday, in window → planned + free hit
      b(5, 600, 660), // 60m Saturday → planned only
      b(1, 480, 540), // 08:00–09:00 weekday, outside window → planned only
    ]
    const cap = computeCapacity([], scheduled)
    expect(cap.planned).toBe(45 + 60 + 60)
    expect(cap.free).toBe(2700 - 45)
  })

  it('floors free at 0 when the week is overbooked', () => {
    const busy = [0, 1, 2, 3, 4].map((d) => b(d, 540, 1080)) // whole window busy
    const scheduled = [b(0, 540, 1080)]
    expect(computeCapacity(busy, scheduled).free).toBe(0)
  })
})

describe('computeDayFree', () => {
  const today = 2
  const now = 11 * 60 + 20 // 11:20 → counts from 11:30

  it('returns null for past days', () => {
    expect(computeDayFree(0, [], [], today, now)).toBeNull()
    expect(computeDayFree(1, [], [], today, now)).toBeNull()
  })

  it('counts today from now rounded up to :15', () => {
    // 11:30 → 18:00 = 390m.
    expect(computeDayFree(2, [], [], today, now)).toBe(390)
  })

  it('gives future days the full window', () => {
    expect(computeDayFree(3, [], [], today, now)).toBe(540)
  })

  it('subtracts busy clipped to the remaining window', () => {
    const busy = [
      b(2, 600, 660), // 10:00–11:00 — already past 11:30, clipped out
      b(2, 720, 780), // 12:00–13:00 — 60m
    ]
    expect(computeDayFree(2, busy, [], today, now)).toBe(390 - 60)
  })

  it('subtracts scheduled input too (chunk-37 future-proofing)', () => {
    const scheduled = [b(3, 900, 990)] // 15:00–16:30
    expect(computeDayFree(3, [], scheduled, today, now)).toBe(540 - 90)
  })

  it('returns 0 after the window closes today', () => {
    expect(computeDayFree(2, [], [], today, 18 * 60 + 30)).toBe(0)
  })

  it('treats every day as past when today is beyond the week', () => {
    // Viewing a fully past week: todayIndex is e.g. 8.
    expect(computeDayFree(4, [], [], 8, now)).toBeNull()
  })

  it('treats every day as future when today precedes the week', () => {
    expect(computeDayFree(0, [], [], -3, now)).toBe(540)
  })
})
