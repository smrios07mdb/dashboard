import { describe, expect, it } from 'vitest'

import { calcStats, catProgress, taskXP } from './gamify'
import type { Category, Subcategory, Task } from '@/db/types'

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't',
    userId: 'u',
    subcategoryId: 's',
    title: 't',
    notes: null,
    estimateMinutes: 0,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function mkSub(id: string, categoryId: string): Subcategory {
  return { id, userId: 'u', categoryId, name: id, sortOrder: 0, archivedAt: null }
}

function mkCat(id: string, name: 'Work' | 'Personal'): Category {
  return { id, userId: 'u', name }
}

describe('taskXP', () => {
  it('is 10 + estimateMinutes', () => {
    expect(taskXP(mkTask({ estimateMinutes: 25 }))).toBe(35)
  })

  it('floors at 10 for a zero-estimate task', () => {
    expect(taskXP(mkTask({ estimateMinutes: 0 }))).toBe(10)
  })
})

describe('calcStats', () => {
  it('returns a clean zero/level-1 baseline for no tasks', () => {
    expect(calcStats([])).toEqual({
      total: 0,
      done: 0,
      open: 0,
      xp: 0,
      level: 1,
      intoLevel: 0,
      ratio: 0,
    })
  })

  it('counts done/open and sums XP only over completed tasks', () => {
    const tasks = [
      mkTask({ id: 'a', estimateMinutes: 20, completedAt: '2026-01-02T00:00:00.000Z' }),
      mkTask({ id: 'b', estimateMinutes: 5 }),
      mkTask({ id: 'c', estimateMinutes: 100 }),
    ]
    const s = calcStats(tasks)
    expect(s.total).toBe(3)
    expect(s.done).toBe(1)
    expect(s.open).toBe(2)
    // only the completed task contributes: 10 + 20 = 30
    expect(s.xp).toBe(30)
    expect(s.level).toBe(1)
    expect(s.intoLevel).toBeCloseTo(0.1, 10)
    expect(s.ratio).toBeCloseTo(1 / 3, 10)
  })

  it('crosses to level 2 and reports the remainder into the new level', () => {
    // one completed task worth 10 + 310 = 320 XP → level 2, 20 into the level
    const s = calcStats([
      mkTask({ id: 'big', estimateMinutes: 310, completedAt: '2026-01-02T00:00:00.000Z' }),
    ])
    expect(s.xp).toBe(320)
    expect(s.level).toBe(2)
    expect(s.intoLevel).toBeCloseTo(20 / 300, 10)
    expect(s.ratio).toBe(1)
  })

  it('lands exactly on a level boundary with intoLevel back at zero', () => {
    // 10 + 290 = 300 XP is exactly one level: level 2, 0 into the new level.
    const s = calcStats([
      mkTask({ id: 'exact', estimateMinutes: 290, completedAt: '2026-01-02T00:00:00.000Z' }),
    ])
    expect(s.xp).toBe(300)
    expect(s.level).toBe(2)
    expect(s.intoLevel).toBe(0)
  })
})

describe('catProgress', () => {
  const cats = [mkCat('cw', 'Work'), mkCat('cp', 'Personal')]
  const subs = [mkSub('s1', 'cw'), mkSub('s2', 'cw'), mkSub('s3', 'cp')]
  const tasks = [
    mkTask({ id: 'w1', subcategoryId: 's1', completedAt: '2026-01-02T00:00:00.000Z' }),
    mkTask({ id: 'w2', subcategoryId: 's1' }),
    mkTask({ id: 'w3', subcategoryId: 's2' }),
    mkTask({ id: 'p1', subcategoryId: 's3' }),
  ]

  it('aggregates done/total/ratio over every subcategory of the category', () => {
    expect(catProgress(tasks, subs, cats, 'Work')).toEqual({
      done: 1,
      total: 3,
      ratio: 1 / 3,
    })
  })

  it('reports an all-open category as ratio 0', () => {
    expect(catProgress(tasks, subs, cats, 'Personal')).toEqual({
      done: 0,
      total: 1,
      ratio: 0,
    })
  })

  it('returns a zeroed result for an unknown category', () => {
    expect(catProgress(tasks, subs, cats, 'Nope')).toEqual({
      done: 0,
      total: 0,
      ratio: 0,
    })
  })
})
