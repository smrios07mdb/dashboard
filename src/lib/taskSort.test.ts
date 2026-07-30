import { describe, expect, it } from 'vitest'

import type { Task } from '@/db/types'
import {
  DEFAULT_TASK_SORT,
  compareTasks,
  loadTaskSortKey,
  storeTaskSortKey,
} from '@/lib/taskSort'

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    userId: 'u1',
    subcategoryId: 's1',
    title: `Task ${seq}`,
    notes: null,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }
}

function ids(tasks: Task[]): string[] {
  return tasks.map((t) => t.id)
}

describe('compareTasks("priority")', () => {
  it('orders 1 → 2 → 3 → null', () => {
    const p3 = task({ id: 'p3', priority: 3 })
    const none = task({ id: 'none', priority: null })
    const p1 = task({ id: 'p1', priority: 1 })
    const p2 = task({ id: 'p2', priority: 2 })
    const sorted = [p3, none, p1, p2].sort(compareTasks('priority'))
    expect(ids(sorted)).toEqual(['p1', 'p2', 'p3', 'none'])
  })

  it('never treats null as P3 — null sorts after an explicit 3', () => {
    const none = task({ id: 'none', priority: null })
    const p3 = task({ id: 'p3', priority: 3 })
    expect(compareTasks('priority')(none, p3)).toBeGreaterThan(0)
  })

  it('breaks ties by due_at asc with nulls last, then created_at asc', () => {
    const noDueOld = task({
      id: 'noDueOld',
      priority: 2,
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    const noDueNew = task({
      id: 'noDueNew',
      priority: 2,
      createdAt: '2026-07-02T00:00:00.000Z',
    })
    const dueLater = task({
      id: 'dueLater',
      priority: 2,
      dueAt: '2026-07-20T00:00:00.000Z',
    })
    const dueSoon = task({
      id: 'dueSoon',
      priority: 2,
      dueAt: '2026-07-10T00:00:00.000Z',
    })
    const sorted = [noDueNew, dueLater, noDueOld, dueSoon].sort(
      compareTasks('priority'),
    )
    expect(ids(sorted)).toEqual(['dueSoon', 'dueLater', 'noDueOld', 'noDueNew'])
  })
})

describe('compareTasks("due")', () => {
  it('orders due_at asc with nulls last', () => {
    const none = task({ id: 'none', dueAt: null })
    const late = task({ id: 'late', dueAt: '2026-08-01T00:00:00.000Z' })
    const soon = task({ id: 'soon', dueAt: '2026-07-05T00:00:00.000Z' })
    const sorted = [none, late, soon].sort(compareTasks('due'))
    expect(ids(sorted)).toEqual(['soon', 'late', 'none'])
  })

  it('breaks ties by priority (null last), then created_at asc', () => {
    const due = '2026-07-10T00:00:00.000Z'
    const nullP = task({ id: 'nullP', dueAt: due, priority: null })
    const p1 = task({ id: 'p1', dueAt: due, priority: 1 })
    const p3 = task({ id: 'p3', dueAt: due, priority: 3 })
    const nullPOlder = task({
      id: 'nullPOlder',
      dueAt: due,
      priority: null,
      createdAt: '2026-06-01T00:00:00.000Z',
    })
    const sorted = [nullP, p3, nullPOlder, p1].sort(compareTasks('due'))
    expect(ids(sorted)).toEqual(['p1', 'p3', 'nullPOlder', 'nullP'])
  })
})

describe('compareTasks("estimate")', () => {
  it('orders estimate_minutes asc', () => {
    const big = task({ id: 'big', estimateMinutes: 90 })
    const small = task({ id: 'small', estimateMinutes: 10 })
    const mid = task({ id: 'mid', estimateMinutes: 45 })
    const sorted = [big, small, mid].sort(compareTasks('estimate'))
    expect(ids(sorted)).toEqual(['small', 'mid', 'big'])
  })

  it('breaks ties by priority, then created_at asc', () => {
    const p2New = task({
      id: 'p2New',
      estimateMinutes: 30,
      priority: 2,
      createdAt: '2026-07-03T00:00:00.000Z',
    })
    const p2Old = task({
      id: 'p2Old',
      estimateMinutes: 30,
      priority: 2,
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    const p1 = task({ id: 'p1', estimateMinutes: 30, priority: 1 })
    const sorted = [p2New, p1, p2Old].sort(compareTasks('estimate'))
    expect(ids(sorted)).toEqual(['p1', 'p2Old', 'p2New'])
  })
})

describe('sort preference persistence', () => {
  it('defaults to priority when nothing is stored', () => {
    localStorage.removeItem('hupo.taskSort')
    expect(loadTaskSortKey()).toBe(DEFAULT_TASK_SORT)
    expect(DEFAULT_TASK_SORT).toBe('priority')
  })

  it('round-trips a stored key and rejects garbage', () => {
    storeTaskSortKey('estimate')
    expect(loadTaskSortKey()).toBe('estimate')
    localStorage.setItem('hupo.taskSort', 'bogus')
    expect(loadTaskSortKey()).toBe('priority')
    localStorage.removeItem('hupo.taskSort')
  })
})
