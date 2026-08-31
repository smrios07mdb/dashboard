import { describe, expect, it } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

import {
  autoTodayIds,
  PINNED,
  reconcileTodayMembership,
  resolveToday,
  todayReason,
} from './today'

// ---------- fixtures ----------

// A fixed "now" built with the LOCAL Date constructor so the local-midnight
// bounds are stable regardless of the test runner's timezone: every remindAt
// below is derived from the same local frame, so comparisons hold in UTC CI or
// a local machine alike.
const NOW = new Date(2026, 6, 1, 12, 0, 0) // Wed Jul 1 2026, 12:00 local

/** ISO for a local wall-clock time on an offset of days from NOW's date. */
function localIso(
  dayOffset: number,
  hours: number,
  minutes = 0,
): string {
  return new Date(2026, 6, 1 + dayOffset, hours, minutes, 0).toISOString()
}

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
    notes: null,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

const WORK = cat('c-work', 'Work')
const PERSONAL = cat('c-personal', 'Personal')
const SUB_WORK = sub('s-work', 'c-work', 'Reviews')
const SUB_PERSONAL = sub('s-personal', 'c-personal', 'Health')

// ============================================================
// todayReason — precedence ladder + bounds + completion
// ============================================================

describe('todayReason', () => {
  it('returns Overdue when remindAt is before now (highest precedence)', () => {
    // Earlier today AND priority-1: Overdue still wins the ladder.
    const t = task({ id: 't', remindAt: localIso(0, 9), priority: 1 })
    expect(todayReason(t, NOW)).toMatchObject({ key: 'overdue', rank: 0 })
  })

  it('treats a reminder from a previous day as Overdue', () => {
    const t = task({ id: 't', remindAt: localIso(-1, 15) })
    expect(todayReason(t, NOW)?.key).toBe('overdue')
  })

  it('returns Due today when remindAt is later today within local-midnight bounds', () => {
    const t = task({ id: 't', remindAt: localIso(0, 15), priority: 1 })
    // Due beats Priority; not overdue because it's still in the future.
    expect(todayReason(t, NOW)).toMatchObject({ key: 'due', rank: 1 })
  })

  it('includes the exact end-of-day boundary as Due today', () => {
    const endOfDay = new Date(2026, 6, 1, 23, 59, 59, 999).toISOString()
    expect(todayReason(task({ id: 't', remindAt: endOfDay }), NOW)?.key).toBe(
      'due',
    )
  })

  it('returns Priority when a future (beyond today) reminder exists but priority===1', () => {
    const t = task({ id: 't', remindAt: localIso(1, 9), priority: 1 })
    expect(todayReason(t, NOW)).toMatchObject({ key: 'priority', rank: 2 })
  })

  it('returns Priority when priority===1 and no reminder', () => {
    expect(todayReason(task({ id: 't', priority: 1 }), NOW)?.key).toBe(
      'priority',
    )
  })

  it('returns null for a tomorrow-only reminder with no priority', () => {
    expect(todayReason(task({ id: 't', remindAt: localIso(1, 9) }), NOW)).toBeNull()
  })

  it('returns null for completed tasks even with an overdue reminder', () => {
    const t = task({
      id: 't',
      remindAt: localIso(-1, 9),
      priority: 1,
      completedAt: '2026-07-01T08:00:00.000Z',
    })
    expect(todayReason(t, NOW)).toBeNull()
  })

  it('returns null for a bare task (no signal)', () => {
    expect(todayReason(task({ id: 't' }), NOW)).toBeNull()
  })

  it('ignores priority values other than 1', () => {
    expect(todayReason(task({ id: 't', priority: 2 }), NOW)).toBeNull()
    expect(todayReason(task({ id: 't', priority: 3 }), NOW)).toBeNull()
  })
})

// ============================================================
// autoTodayIds — seeds the plan
// ============================================================

describe('autoTodayIds', () => {
  it('collects exactly the ids with a non-null reason', () => {
    const tasks = [
      task({ id: 'overdue', remindAt: localIso(-1, 9) }),
      task({ id: 'due', remindAt: localIso(0, 18) }),
      task({ id: 'prio', priority: 1 }),
      task({ id: 'none' }),
      task({ id: 'done', priority: 1, completedAt: '2026-07-01T08:00:00.000Z' }),
    ]
    expect(autoTodayIds(tasks, NOW)).toEqual(
      new Set(['overdue', 'due', 'prio']),
    )
  })

  it('is empty for an empty / nullish list', () => {
    expect(autoTodayIds([], NOW).size).toBe(0)
    expect(autoTodayIds(undefined, NOW).size).toBe(0)
  })
})

// ============================================================
// resolveToday — Pinned synthesis + ordering
// ============================================================

describe('resolveToday', () => {
  const data = {
    categories: [WORK, PERSONAL],
    subcategories: [SUB_WORK, SUB_PERSONAL],
    tasks: [] as Task[],
  }

  it('gives a pinned-only task the synthetic Pinned reason (rank 3) and its names', () => {
    const t = task({ id: 'pin', subcategoryId: 's-personal' })
    const rows = resolveToday(
      { ...data, tasks: [t] },
      new Set(['pin']),
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toEqual(PINNED)
    expect(rows[0].reason.rank).toBe(3)
    expect(rows[0].subName).toBe('Health')
    expect(rows[0].catName).toBe('Personal')
  })

  it('only includes tasks in the membership set', () => {
    const tasks = [task({ id: 'a', priority: 1 }), task({ id: 'b', priority: 1 })]
    const rows = resolveToday({ ...data, tasks }, new Set(['a']), NOW)
    expect(rows.map((r) => r.task.id)).toEqual(['a'])
  })

  it('sorts incomplete-before-complete, then reason rank, then shortest estimate', () => {
    const tasks = [
      task({ id: 'done', priority: 1, completedAt: '2026-07-01T08:00:00.000Z' }),
      task({ id: 'prio-long', priority: 1, estimateMinutes: 90 }),
      task({ id: 'prio-short', priority: 1, estimateMinutes: 15 }),
      task({ id: 'overdue', remindAt: localIso(-1, 9), estimateMinutes: 60 }),
      task({ id: 'due', remindAt: localIso(0, 18), estimateMinutes: 45 }),
    ]
    const set = new Set(['done', 'prio-long', 'prio-short', 'overdue', 'due'])
    const rows = resolveToday({ ...data, tasks }, set, NOW)
    expect(rows.map((r) => r.task.id)).toEqual([
      'overdue', // rank 0
      'due', // rank 1
      'prio-short', // rank 2, 15m
      'prio-long', // rank 2, 90m
      'done', // completed sinks last
    ])
  })

  it('keeps a completed task in the resolved rows (for done/total + linger)', () => {
    const t = task({ id: 'x', priority: 1, completedAt: '2026-07-01T09:00:00.000Z' })
    const rows = resolveToday({ ...data, tasks: [t] }, new Set(['x']), NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toEqual(PINNED) // reason null → Pinned fallback once done
  })
})

// ============================================================
// reconcileTodayMembership — seed-per-load, applied incrementally
// ============================================================

describe('reconcileTodayMembership', () => {
  it('keeps existing members whose task still exists (survives in-place edits)', () => {
    const tasks = [task({ id: 'a', priority: 1 }), task({ id: 'b' })]
    const prevIds = new Set(['a', 'b'])
    const membership = new Set(['a', 'b']) // 'b' was a manual pin
    // Same ids, one field changed → membership preserved verbatim.
    const next = reconcileTodayMembership(membership, prevIds, tasks, NOW)
    expect(next).toEqual(new Set(['a', 'b']))
  })

  it('drops members whose task was deleted', () => {
    const tasks = [task({ id: 'a', priority: 1 })]
    const next = reconcileTodayMembership(
      new Set(['a', 'gone']),
      new Set(['a', 'gone']),
      tasks,
      NOW,
    )
    expect(next).toEqual(new Set(['a']))
  })

  it('auto-adds a newly appeared task that carries a signal', () => {
    const tasks = [
      task({ id: 'a', priority: 1 }),
      task({ id: 'new-prio', priority: 1 }),
      task({ id: 'new-plain' }),
    ]
    const next = reconcileTodayMembership(
      new Set(['a']),
      new Set(['a']),
      tasks,
      NOW,
    )
    expect(next).toEqual(new Set(['a', 'new-prio']))
  })

  it('preserves a manual removal across an unrelated task creation', () => {
    // 'x' is overdue (auto) but the user removed it (not in membership). Adding a
    // brand-new task must NOT resurrect 'x'.
    const tasks = [
      task({ id: 'x', remindAt: localIso(-1, 9) }),
      task({ id: 'y' }),
      task({ id: 'new', priority: 1 }),
    ]
    const next = reconcileTodayMembership(
      new Set([]), // x removed, y never pinned
      new Set(['x', 'y']),
      tasks,
      NOW,
    )
    expect(next).toEqual(new Set(['new']))
  })
})
