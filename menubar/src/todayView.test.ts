import { describe, expect, it } from 'vitest'

import type { Category, Subcategory, Task, TodayMark } from '@/db/types'

import { buildTodayView, type TodayViewInput } from './todayView'

// The Settings zone is fixed and every instant is absolute, so the results
// must be identical under TZ=America/New_York, UTC and Asia/Tokyo.
const TZ = 'America/New_York'
const NOW = new Date('2026-11-10T17:00:00.000Z') // Tue Nov 10, 12:00 in New York
const TODAY = '2026-11-10'
const YESTERDAY = '2026-11-09'

const categories: Category[] = [
  { id: 'c-work', userId: 'u1', name: 'Work' },
  { id: 'c-personal', userId: 'u1', name: 'Personal' },
]

function sub(
  id: string,
  categoryId: string,
  archivedAt: string | null = null,
): Subcategory {
  return { id, userId: 'u1', categoryId, name: id, sortOrder: 0, archivedAt }
}

const subcategories = [
  sub('s-work', 'c-work'),
  sub('s-home', 'c-personal'),
  sub('s-old', 'c-work', '2026-10-01T00:00:00.000Z'),
]

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
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  }
}

function mark(id: string, kind: TodayMark['kind'], day: string): TodayMark {
  return { id, userId: 'u1', day, kind, updatedAt: '2026-11-10T13:00:00.000Z' }
}

function view(tasks: Task[], marks: TodayMark[] = [], now: Date = NOW) {
  const input: TodayViewInput = {
    categories,
    subcategories,
    tasks,
    marks,
    timeZone: TZ,
  }
  return buildTodayView(input, now)
}

describe('buildTodayView — membership', () => {
  it('includes an auto member (P1) and leaves a plain task out', () => {
    const v = view([task({ id: 'p1', priority: 1 }), task({ id: 'plain' })])
    expect(v.rows.map((r) => r.id)).toEqual(['p1'])
  })

  it('includes a task pinned today', () => {
    const v = view([task({ id: 'plain' })], [mark('plain', 'pin', TODAY)])
    expect(v.rows.map((r) => r.id)).toEqual(['plain'])
  })

  it('drops an auto member removed today', () => {
    const v = view(
      [task({ id: 'p1', priority: 1 }), task({ id: 'p1b', priority: 1 })],
      [mark('p1', 'remove', TODAY)],
    )
    expect(v.rows.map((r) => r.id)).toEqual(['p1b'])
  })

  it('ignores marks dated yesterday, pin and remove alike', () => {
    const v = view(
      [task({ id: 'p1', priority: 1 }), task({ id: 'plain' })],
      [mark('plain', 'pin', YESTERDAY), mark('p1', 'remove', YESTERDAY)],
    )
    expect(v.rows.map((r) => r.id)).toEqual(['p1'])
  })

  it('dates marks in the Settings zone, not UTC', () => {
    // 21:00 on Nov 10 in New York is already Nov 11 in UTC and Tokyo.
    const late = new Date('2026-11-11T02:00:00.000Z')
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const v = view(
      tasks,
      [mark('a', 'pin', '2026-11-10'), mark('b', 'pin', '2026-11-11')],
      late,
    )
    expect(v.rows.map((r) => r.id)).toEqual(['a'])
  })

  it('leaves out tasks in an archived list', () => {
    const v = view([
      task({ id: 'gone', priority: 1, subcategoryId: 's-old' }),
      task({ id: 'kept', priority: 1 }),
    ])
    expect(v.rows.map((r) => r.id)).toEqual(['kept'])
  })
})

describe('buildTodayView — rows and counts', () => {
  it('sinks done rows last and counts them', () => {
    const v = view(
      [
        task({
          id: 'done',
          completedAt: '2026-11-10T15:00:00.000Z',
          estimateMinutes: 5,
        }),
        task({ id: 'p1', priority: 1, estimateMinutes: 60 }),
        task({ id: 'pinned', estimateMinutes: 10 }),
      ],
      [mark('done', 'pin', TODAY), mark('pinned', 'pin', TODAY)],
    )
    expect(v.rows.map((r) => r.id)).toEqual(['p1', 'pinned', 'done'])
    expect(v.rows.map((r) => r.done)).toEqual([false, false, true])
    expect(v).toMatchObject({ done: 1, total: 3, open: 2, trayTitle: '2' })
  })

  it("keeps resolveToday's order: overdue, due today, priority, pinned", () => {
    const v = view(
      [
        task({ id: 'pinned' }),
        task({ id: 'prio', priority: 1 }),
        task({ id: 'due', dueAt: '2026-11-10T05:00:00.000Z' }),
        task({ id: 'late', dueAt: '2026-11-08T05:00:00.000Z' }),
      ],
      [mark('pinned', 'pin', TODAY)],
    )
    expect(v.rows.map((r) => r.id)).toEqual(['late', 'due', 'prio', 'pinned'])
  })

  it('carries the category, priority, when-chip and minutes of each row', () => {
    const v = view([
      task({
        id: 'due',
        subcategoryId: 's-home',
        priority: 2,
        dueAt: '2026-11-10T05:00:00.000Z',
        estimateMinutes: 45,
      }),
    ])
    expect(v.rows[0]).toMatchObject({
      catName: 'Personal',
      priority: 2,
      minutes: 45,
      done: false,
    })
    expect(v.rows[0].when).toMatchObject({ text: 'Today', tone: 'today' })
  })

  it('shows no when-chip on a done row', () => {
    const v = view(
      [
        task({
          id: 'done',
          dueAt: '2026-11-10T05:00:00.000Z',
          completedAt: '2026-11-10T15:00:00.000Z',
        }),
      ],
      [mark('done', 'pin', TODAY)],
    )
    expect(v.rows[0].when).toBeNull()
  })
})

describe('buildTodayView — tray title', () => {
  it("is '' with nothing planned", () => {
    expect(view([task({ id: 'plain' })]).trayTitle).toBe('')
  })

  it("is '' when every planned task is done", () => {
    const v = view(
      [task({ id: 'done', completedAt: '2026-11-10T15:00:00.000Z' })],
      [mark('done', 'pin', TODAY)],
    )
    expect(v).toMatchObject({ total: 1, open: 0, trayTitle: '' })
  })

  it('is the open count otherwise', () => {
    const v = view([
      task({ id: 'a', priority: 1 }),
      task({ id: 'b', priority: 1 }),
      task({ id: 'c', priority: 1 }),
    ])
    expect(v.trayTitle).toBe('3')
  })
})
