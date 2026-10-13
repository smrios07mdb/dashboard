import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Subcategory, Task } from '@/db/types'

import {
  REVIEW_KEY,
  isReviewDue,
  loadLastReview,
  reviewCandidates,
  storeLastReview,
} from './review'

/* The weekly review's pure half (chunk 74). `now` is always passed in. */

const NOW = new Date('2026-10-13T16:00:00Z')
const TZ = 'America/New_York'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString()

function sub(id: string, archivedAt: string | null = null): Subcategory {
  return { id, userId: 'u1', categoryId: 'c1', name: id, sortOrder: 0, archivedAt }
}

function task(id: string, createdAt: string, over: Partial<Task> = {}): Task {
  return {
    id,
    userId: 'u1',
    subcategoryId: 's-live',
    title: id,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...over,
  }
}

const SUBS = [sub('s-live'), sub('s-arch', '2026-05-25T12:00:00.000Z')]

describe('reviewCandidates', () => {
  it('keeps open, live, unplanned tasks at 90 days or more, oldest first then by id', () => {
    const tasks = [
      task('young-90', daysAgo(90)),
      task('b-tie', daysAgo(120)),
      task('a-tie', daysAgo(120)),
      task('oldest', daysAgo(400)),
    ]
    const got = reviewCandidates({ subcategories: SUBS, tasks }, new Set(), TZ, NOW)
    expect(got.map((t) => t.id)).toEqual(['oldest', 'a-tie', 'b-tie', 'young-90'])
  })

  it('drops completed, archived-list, missing-list, planned and 89-day tasks', () => {
    const tasks = [
      task('kept', daysAgo(200)),
      task('done', daysAgo(200), { completedAt: daysAgo(1) }),
      task('archived', daysAgo(200), { subcategoryId: 's-arch' }),
      task('missing', daysAgo(200), { subcategoryId: 's-gone' }),
      task('planned', daysAgo(200)),
      task('young-89', daysAgo(89)),
      task('garbage', 'not a date'),
    ]
    const got = reviewCandidates(
      { subcategories: SUBS, tasks },
      new Set(['planned']),
      TZ,
      NOW,
    )
    expect(got.map((t) => t.id)).toEqual(['kept'])
  })
})

describe('isReviewDue', () => {
  it('is due with no date, a week on, or an unreadable date', () => {
    expect(isReviewDue(null, NOW)).toBe(true)
    expect(
      isReviewDue(new Date(NOW.getTime() - (7 * DAY_MS - HOUR_MS)).toISOString(), NOW),
    ).toBe(false)
    expect(isReviewDue(daysAgo(7), NOW)).toBe(true)
    expect(isReviewDue('garbage', NOW)).toBe(true)
  })
})

describe('loadLastReview / storeLastReview', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem(REVIEW_KEY)
  })

  it('round-trips the ISO date under hup:lastReview', () => {
    expect(loadLastReview()).toBeNull()
    storeLastReview(NOW)
    expect(localStorage.getItem('hup:lastReview')).toBe('2026-10-13T16:00:00.000Z')
    expect(loadLastReview()).toBe('2026-10-13T16:00:00.000Z')
  })

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadLastReview()).toBeNull()
    expect(() => storeLastReview(NOW)).not.toThrow()
  })
})
