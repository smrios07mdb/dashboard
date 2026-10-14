import { describe, expect, it } from 'vitest'

import { COMPLETED_VISIBLE_DAYS, isRecentCompletion } from './completedAge'

const NOW = new Date('2026-10-14T12:00:00.000Z')
const ago = (ms: number) => ({ completedAt: new Date(NOW.getTime() - ms).toISOString() })
const H = 60 * 60 * 1000
const D = 24 * H

describe('isRecentCompletion (chunk 86, D2)', () => {
  it('is 30 days', () => {
    expect(COMPLETED_VISIBLE_DAYS).toBe(30)
  })

  it('29 d 23 h ago is recent', () => {
    expect(isRecentCompletion(ago(29 * D + 23 * H), NOW)).toBe(true)
  })

  it('30 d ago is not', () => {
    expect(isRecentCompletion(ago(30 * D), NOW)).toBe(false)
  })

  it('an open task is not', () => {
    expect(isRecentCompletion({ completedAt: null }, NOW)).toBe(false)
  })

  it('uses the injected now', () => {
    const t = ago(2 * D)
    expect(isRecentCompletion(t, NOW)).toBe(true)
    expect(isRecentCompletion(t, new Date(NOW.getTime() + 40 * D))).toBe(false)
  })
})
