import { describe, expect, it } from 'vitest'

import { proposeSlots } from './slots'

/*
 * proposeSlots is a pure function (ARCHITECTURE.md §8). Every test pins a
 * fixed `now` and a non-local timezone so the working-window math is
 * exercised in the user's tz, not the runner's (resolution 6).
 *
 * All tests use America/New_York. In late May 2026 the zone is EDT (UTC-4),
 * so 09:00 EDT == 13:00Z and 18:00 EDT == 22:00Z. Expected slot times are
 * ISO-UTC literals with the EDT wall-clock noted alongside.
 */
const TZ = 'America/New_York'

describe('proposeSlots', () => {
  it('returns the first 3 open slots when the day is wide open', () => {
    const now = new Date('2026-05-28T13:00:00Z') // 09:00 EDT (window start)
    const slots = proposeSlots({
      estimateMinutes: 30,
      busyRanges: [],
      timezone: TZ,
      now,
    })
    expect(slots).toHaveLength(3)
    expect(slots.map((s) => s.start)).toEqual([
      '2026-05-28T13:15:00.000Z', // 09:15 EDT (first boundary ≥ now+15m)
      '2026-05-28T13:30:00.000Z', // 09:30 EDT
      '2026-05-28T13:45:00.000Z', // 09:45 EDT
    ])
    expect(slots[0].end).toBe('2026-05-28T13:45:00.000Z') // start + 30m
  })

  it('returns a single slot (limited availability) when only one fits', () => {
    // 08:00 EDT → tomorrow's 09:00 window is >24h away, so only today counts.
    const now = new Date('2026-05-28T12:00:00Z') // 08:00 EDT
    // Busy 09:00–17:00 EDT leaves exactly one 60-min slot: 17:00–18:00 EDT.
    const slots = proposeSlots({
      estimateMinutes: 60,
      busyRanges: [
        { start: '2026-05-28T13:00:00Z', end: '2026-05-28T21:00:00Z' },
      ],
      timezone: TZ,
      now,
    })
    expect(slots).toHaveLength(1) // caller renders "Limited availability"
    expect(slots[0]).toEqual({
      start: '2026-05-28T21:00:00.000Z', // 17:00 EDT
      end: '2026-05-28T22:00:00.000Z', // 18:00 EDT
    })
  })

  it('returns no slots when the working window is fully busy', () => {
    const now = new Date('2026-05-28T12:00:00Z') // 08:00 EDT (tomorrow out of range)
    const slots = proposeSlots({
      estimateMinutes: 30,
      busyRanges: [
        { start: '2026-05-28T13:00:00Z', end: '2026-05-28T22:00:00Z' }, // 09:00–18:00 EDT
      ],
      timezone: TZ,
      now,
    })
    expect(slots).toEqual([])
  })

  it('snaps the first slot to the next 15-min boundary after the now+15min buffer', () => {
    const now = new Date('2026-05-28T13:08:00Z') // 09:08 EDT → +15m = 09:23 → 09:30
    const slots = proposeSlots({
      estimateMinutes: 30,
      busyRanges: [],
      timezone: TZ,
      now,
    })
    expect(slots[0].start).toBe('2026-05-28T13:30:00.000Z') // 09:30 EDT
  })

  it('crosses the day boundary: a late-afternoon ask returns next-morning slots', () => {
    const now = new Date('2026-05-28T22:30:00Z') // 18:30 EDT, after today's window
    const slots = proposeSlots({
      estimateMinutes: 30,
      busyRanges: [],
      timezone: TZ,
      now,
    })
    expect(slots).toHaveLength(3)
    expect(slots[0].start).toBe('2026-05-29T13:00:00.000Z') // next day 09:00 EDT
  })

  // ── edge cases ─────────────────────────────────────────────────────
  it('allows a slot starting exactly when a busy range ends (back-to-back)', () => {
    const now = new Date('2026-05-28T13:00:00Z') // 09:00 EDT
    // Busy 09:00–09:30 EDT; a 30-min slot at 09:30 is adjacent, not overlapping.
    const slots = proposeSlots({
      estimateMinutes: 30,
      busyRanges: [
        { start: '2026-05-28T13:00:00Z', end: '2026-05-28T13:30:00Z' },
      ],
      timezone: TZ,
      now,
    })
    expect(slots[0].start).toBe('2026-05-28T13:30:00.000Z') // touches busy end, allowed
  })

  it('returns no slots when the estimate is longer than the working window', () => {
    const now = new Date('2026-05-28T12:00:00Z') // 08:00 EDT (today only)
    const slots = proposeSlots({
      estimateMinutes: 10 * 60, // 10h > 9h window
      busyRanges: [],
      timezone: TZ,
      now,
    })
    expect(slots).toEqual([])
  })
})
