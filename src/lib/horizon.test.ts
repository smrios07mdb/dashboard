import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/db/types'
import {
  daysFromNow,
  filterByHorizon,
  HORIZON_STORAGE_KEY,
  loadHorizonFilter,
  storeHorizonFilter,
  taskHorizon,
} from '@/lib/horizon'

/* Chunk 76: near term / long term, derived from priority and dates. */

const now = new Date('2026-10-13T16:00:00Z')
const TZ = 'America/New_York'

const mk = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  userId: 'u1',
  subcategoryId: 's1',
  title: id,
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

describe('daysFromNow', () => {
  it('counts calendar days in the time zone', () => {
    expect(daysFromNow(now.toISOString(), TZ, now)).toBe(0)
    expect(daysFromNow('2026-10-27T12:00:00Z', TZ, now)).toBe(14)
    expect(daysFromNow('2026-10-28T12:00:00Z', TZ, now)).toBe(15)
    expect(daysFromNow('2026-10-10T12:00:00Z', TZ, now)).toBe(-3)
    expect(daysFromNow('garbage', TZ, now)).toBeNull()
  })

  it('follows the day boundary of the zone', () => {
    // 03:30Z on the 28th is still the evening of Oct 27 in New York.
    expect(daysFromNow('2026-10-28T03:30:00Z', TZ, now)).toBe(14)
    expect(daysFromNow('2026-10-28T03:30:00Z', 'UTC', now)).toBe(15)
  })
})

describe('taskHorizon', () => {
  const h = (extra: Partial<Task>) => taskHorizon(mk('t', extra), TZ, now)

  it('P1 and P2 are near; P3 and no priority are long', () => {
    expect(h({ priority: 1 })).toBe('near')
    expect(h({ priority: 2 })).toBe('near')
    expect(h({ priority: 3 })).toBe('long')
    expect(h({ priority: null })).toBe('long')
  })

  it('a due date within 14 days, or late, is near', () => {
    expect(h({ dueAt: '2026-10-27T12:00:00Z' })).toBe('near')
    expect(h({ dueAt: '2026-10-28T12:00:00Z' })).toBe('long')
    expect(h({ dueAt: '2026-10-10T12:00:00Z' })).toBe('near')
  })

  it('a reminder within 14 days, or overdue, is near', () => {
    expect(h({ remindAt: '2026-10-27T12:00:00Z' })).toBe('near')
    expect(h({ remindAt: '2026-10-28T12:00:00Z' })).toBe('long')
    expect(h({ remindAt: '2026-10-01T12:00:00Z' })).toBe('near')
  })

  it('dates win over P3; an unparsable date is ignored', () => {
    expect(h({ priority: 3, dueAt: '2026-10-14T12:00:00Z' })).toBe('near')
    expect(h({ dueAt: 'not a date' })).toBe('long')
  })
})

describe('filterByHorizon', () => {
  const tasks = [
    mk('a', { priority: 3 }),
    mk('b', { priority: 1 }),
    mk('c'),
    mk('d', { dueAt: '2026-10-15T12:00:00Z' }),
    mk('e', { remindAt: '2026-12-01T12:00:00Z' }),
  ]

  it('returns the same array for all', () => {
    expect(filterByHorizon(tasks, 'all', TZ, now)).toBe(tasks)
  })

  it('near and long partition the set, in order', () => {
    const near = filterByHorizon(tasks, 'near', TZ, now).map((t) => t.id)
    const long = filterByHorizon(tasks, 'long', TZ, now).map((t) => t.id)
    expect(near).toEqual(['b', 'd'])
    expect(long).toEqual(['a', 'c', 'e'])
    expect([...near, ...long].sort()).toEqual(tasks.map((t) => t.id))
  })
})

describe('horizon preference', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('round-trips and rejects bad values', () => {
    expect(loadHorizonFilter()).toBe('all')
    storeHorizonFilter('near')
    expect(localStorage.getItem(HORIZON_STORAGE_KEY)).toBe('near')
    expect(loadHorizonFilter()).toBe('near')
    localStorage.setItem(HORIZON_STORAGE_KEY, 'bogus')
    expect(loadHorizonFilter()).toBe('all')
  })

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadHorizonFilter()).toBe('all')
    expect(() => storeHorizonFilter('long')).not.toThrow()
  })
})
