import { describe, expect, it } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

import { suggestToday, TODAY_PLAN_TARGET } from './todaySuggest'

// ---------- fixtures ----------
// Fixed ISO timestamps throughout: the picker takes no clock and no time zone.

function cat(id: string, name: 'Work' | 'Personal'): Category {
  return { id, userId: 'u1', name }
}

function sub(id: string, categoryId: string, name: string): Subcategory {
  return { id, userId: 'u1', categoryId, name, sortOrder: 0, archivedAt: null }
}

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    userId: 'u1',
    subcategoryId: 's-work',
    title: overrides.id,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  }
}

const CATEGORIES = [cat('c-work', 'Work'), cat('c-personal', 'Personal')]
const SUBCATEGORIES = [
  sub('s-work', 'c-work', 'Deals'),
  sub('s-home', 'c-personal', 'Home'),
]

function data(tasks: Task[]) {
  return { categories: CATEGORIES, subcategories: SUBCATEGORIES, tasks }
}

const NONE: ReadonlySet<string> = new Set()

function ids(tasks: Task[], limit = 10, todaySet = NONE, skipped = NONE) {
  return suggestToday(data(tasks), todaySet, skipped, limit).map(
    (s) => s.task.id,
  )
}

describe('todaySuggest', () => {
  it('targets a plan of three', () => {
    expect(TODAY_PLAN_TARGET).toBe(3)
  })

  it('orders by priority, then soonest due, then oldest created', () => {
    const tasks = [
      task({ id: 'none-new', createdAt: '2026-09-05T12:00:00.000Z' }),
      task({ id: 'none-old', createdAt: '2026-08-01T12:00:00.000Z' }),
      task({ id: 'none-due', dueAt: '2026-12-01T04:00:00.000Z' }),
      task({ id: 'p3', priority: 3 }),
      task({ id: 'p2-late', priority: 2, dueAt: '2026-11-20T05:00:00.000Z' }),
      task({ id: 'p2-soon', priority: 2, dueAt: '2026-11-02T05:00:00.000Z' }),
      task({ id: 'p2-nodue', priority: 2 }),
      task({ id: 'p1', priority: 1 }),
    ]
    expect(ids(tasks)).toEqual([
      'p1',
      'p2-soon',
      'p2-late',
      'p2-nodue',
      'p3',
      'none-due',
      'none-old',
      'none-new',
    ])
  })

  it('sorts an unparseable dueAt or createdAt as absent', () => {
    expect(
      ids([
        task({ id: 'bad-due', dueAt: 'not a date' }),
        task({ id: 'real-due', dueAt: '2026-11-02T05:00:00.000Z' }),
      ]),
    ).toEqual(['real-due', 'bad-due'])
    // 'aaa…' sorts before any ISO string lexicographically, so this also pins
    // that createdAt is compared as a time, not as text.
    expect(
      ids([
        task({ id: 'bad-created', createdAt: 'aaa not a date' }),
        task({ id: 'real-created', createdAt: '2026-09-05T12:00:00.000Z' }),
      ]),
    ).toEqual(['real-created', 'bad-created'])
    // An unparseable dueAt ties with a null one; createdAt then decides.
    expect(
      ids([
        task({
          id: 'bad-due-new',
          dueAt: 'not a date',
          createdAt: '2026-09-05T12:00:00.000Z',
        }),
        task({ id: 'no-due-old', createdAt: '2026-08-01T12:00:00.000Z' }),
      ]),
    ).toEqual(['no-due-old', 'bad-due-new'])
  })

  it('breaks a full tie by id', () => {
    expect(ids([task({ id: 'c' }), task({ id: 'a' }), task({ id: 'b' })])).toEqual(
      ['a', 'b', 'c'],
    )
  })

  it('lets categories take turns', () => {
    const tasks = [
      task({ id: 'w1', createdAt: '2026-08-01T12:00:00.000Z' }),
      task({ id: 'w2', createdAt: '2026-08-02T12:00:00.000Z' }),
      task({ id: 'w3', createdAt: '2026-08-03T12:00:00.000Z' }),
      task({
        id: 'p1',
        subcategoryId: 's-home',
        createdAt: '2026-09-20T12:00:00.000Z',
      }),
    ]
    expect(ids(tasks, 3)).toEqual(['w1', 'p1', 'w2'])
    // The category holding the best candidate leads.
    expect(
      ids(
        [
          ...tasks,
          task({ id: 'p0', subcategoryId: 's-home', priority: 1 }),
        ],
        3,
      ),
    ).toEqual(['p0', 'w1', 'p1'])
  })

  it('fills the limit from a single category', () => {
    const tasks = [
      task({ id: 'w1', createdAt: '2026-08-01T12:00:00.000Z' }),
      task({ id: 'w2', createdAt: '2026-08-02T12:00:00.000Z' }),
      task({ id: 'w3', createdAt: '2026-08-03T12:00:00.000Z' }),
      task({ id: 'w4', createdAt: '2026-08-04T12:00:00.000Z' }),
    ]
    expect(ids(tasks, 3)).toEqual(['w1', 'w2', 'w3'])
  })

  it('carries the subcategory and category names', () => {
    const rows = suggestToday(
      data([
        task({ id: 'w1', createdAt: '2026-08-01T12:00:00.000Z' }),
        task({ id: 'p1', subcategoryId: 's-home' }),
      ]),
      NONE,
      NONE,
      3,
    )
    expect(rows.map((r) => [r.task.id, r.subName, r.catName])).toEqual([
      ['w1', 'Deals', 'Work'],
      ['p1', 'Home', 'Personal'],
    ])
  })

  it('leaves out completed, already-planned and skipped tasks', () => {
    const tasks = [
      task({ id: 'done', completedAt: '2026-09-02T12:00:00.000Z' }),
      task({ id: 'planned' }),
      task({ id: 'skipped' }),
      task({ id: 'open' }),
    ]
    expect(ids(tasks, 10, new Set(['planned']), new Set(['skipped']))).toEqual([
      'open',
    ])
  })

  it('leaves out a task under an unknown subcategory', () => {
    expect(
      ids([task({ id: 'orphan', subcategoryId: 's-gone' }), task({ id: 'kept' })]),
    ).toEqual(['kept'])
  })

  it('respects the limit; 0 and negative return nothing', () => {
    const tasks = [
      task({ id: 'a' }),
      task({ id: 'b' }),
      task({ id: 'c', subcategoryId: 's-home' }),
    ]
    expect(ids(tasks, 2)).toHaveLength(2)
    expect(ids(tasks, 1)).toEqual(['a'])
    expect(ids(tasks, 0)).toEqual([])
    expect(ids(tasks, -2)).toEqual([])
  })

  it('returns nothing when there are no tasks', () => {
    expect(ids([], 3)).toEqual([])
  })
})
