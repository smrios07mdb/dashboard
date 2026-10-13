import { describe, expect, it } from 'vitest'

import { ageDays, taskAge } from './taskAge'

/*
 * Task age (chunk 74). `now` is Tuesday Oct 13 2026, 12:00 in New York, passed
 * in — nothing here reads the machine's clock or zone.
 */

const NOW = new Date('2026-10-13T16:00:00Z')
const TZ = 'America/New_York'
const DAY_MS = 24 * 60 * 60 * 1000

const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString()

describe('taskAge', () => {
  it('is null under 28 days, weeks to 364 days, years from 365', () => {
    expect(taskAge(daysAgo(27), TZ, NOW)).toBeNull()

    expect(taskAge(daysAgo(28), TZ, NOW)).toMatchObject({ days: 28, text: '4w' })

    expect(taskAge(daysAgo(97), TZ, NOW)).toEqual({
      days: 97,
      text: '13w',
      long: 'Added Jul 8 · 13 weeks ago',
    })

    expect(taskAge(daysAgo(364), TZ, NOW)).toMatchObject({
      text: '52w',
      long: 'Added Oct 14, 2025 · 52 weeks ago',
    })

    expect(taskAge(daysAgo(365), TZ, NOW)).toEqual({
      days: 365,
      text: '1y',
      long: 'Added Oct 13, 2025 · 1 year ago',
    })

    expect(taskAge(daysAgo(800), TZ, NOW)).toMatchObject({
      days: 800,
      text: '2y',
      long: 'Added Aug 4, 2024 · 2 years ago',
    })
  })

  it('counts calendar days in the zone it is given', () => {
    // 03:30 UTC on Sep 15 is still Sep 14 in New York.
    const createdAt = '2026-09-15T03:30:00Z'
    expect(ageDays(createdAt, TZ, NOW)).toBe(29)
    expect(ageDays(createdAt, 'UTC', NOW)).toBe(28)
    expect(taskAge(createdAt, TZ, NOW)?.long).toBe('Added Sep 14 · 4 weeks ago')
    expect(taskAge(createdAt, 'UTC', NOW)?.long).toBe('Added Sep 15 · 4 weeks ago')
  })

  it('returns null for a createdAt that does not parse', () => {
    expect(ageDays('not a date', TZ, NOW)).toBeNull()
    expect(taskAge('not a date', TZ, NOW)).toBeNull()
    expect(ageDays('', TZ, NOW)).toBeNull()
  })
})
