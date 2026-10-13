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
// These fixtures are built in the runner's local frame, so they pass the
// runner's own zone as the Settings zone (chunk 66). The zone-specific
// behaviour is covered by the "Settings time zone" block at the end.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

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
    expect(todayReason(t, LOCAL_TZ, NOW)).toMatchObject({ key: 'overdue', rank: 0 })
  })

  it('treats a reminder from a previous day as Overdue', () => {
    const t = task({ id: 't', remindAt: localIso(-1, 15) })
    expect(todayReason(t, LOCAL_TZ, NOW)?.key).toBe('overdue')
  })

  it('returns Due today when remindAt is later today within local-midnight bounds', () => {
    const t = task({ id: 't', remindAt: localIso(0, 15), priority: 1 })
    // Due beats Priority; not overdue because it's still in the future.
    expect(todayReason(t, LOCAL_TZ, NOW)).toMatchObject({ key: 'due', rank: 1 })
  })

  it('includes the exact end-of-day boundary as Due today', () => {
    const endOfDay = new Date(2026, 6, 1, 23, 59, 59, 999).toISOString()
    expect(todayReason(task({ id: 't', remindAt: endOfDay }), LOCAL_TZ, NOW)?.key).toBe(
      'due',
    )
  })

  it('returns Priority when a future (beyond today) reminder exists but priority===1', () => {
    const t = task({ id: 't', remindAt: localIso(1, 9), priority: 1 })
    expect(todayReason(t, LOCAL_TZ, NOW)).toMatchObject({ key: 'priority', rank: 2 })
  })

  it('returns Priority when priority===1 and no reminder', () => {
    expect(todayReason(task({ id: 't', priority: 1 }), LOCAL_TZ, NOW)?.key).toBe(
      'priority',
    )
  })

  it('returns null for a tomorrow-only reminder with no priority', () => {
    expect(todayReason(task({ id: 't', remindAt: localIso(1, 9) }), LOCAL_TZ, NOW)).toBeNull()
  })

  it('returns null for completed tasks even with an overdue reminder', () => {
    const t = task({
      id: 't',
      remindAt: localIso(-1, 9),
      priority: 1,
      completedAt: '2026-07-01T08:00:00.000Z',
    })
    expect(todayReason(t, LOCAL_TZ, NOW)).toBeNull()
  })

  it('returns null for a bare task (no signal)', () => {
    expect(todayReason(task({ id: 't' }), LOCAL_TZ, NOW)).toBeNull()
  })

  it('ignores priority values other than 1', () => {
    expect(todayReason(task({ id: 't', priority: 2 }), LOCAL_TZ, NOW)).toBeNull()
    expect(todayReason(task({ id: 't', priority: 3 }), LOCAL_TZ, NOW)).toBeNull()
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
    expect(autoTodayIds(tasks, LOCAL_TZ, NOW)).toEqual(
      new Set(['overdue', 'due', 'prio']),
    )
  })

  it('is empty for an empty / nullish list', () => {
    expect(autoTodayIds([], LOCAL_TZ, NOW).size).toBe(0)
    expect(autoTodayIds(undefined, LOCAL_TZ, NOW).size).toBe(0)
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
      LOCAL_TZ,
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
    const rows = resolveToday({ ...data, tasks }, new Set(['a']), LOCAL_TZ, NOW)
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
    const rows = resolveToday({ ...data, tasks }, set, LOCAL_TZ, NOW)
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
    const rows = resolveToday({ ...data, tasks: [t] }, new Set(['x']), LOCAL_TZ, NOW)
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
    const next = reconcileTodayMembership(membership, prevIds, tasks, LOCAL_TZ, NOW)
    expect(next).toEqual(new Set(['a', 'b']))
  })

  it('drops members whose task was deleted', () => {
    const tasks = [task({ id: 'a', priority: 1 })]
    const next = reconcileTodayMembership(
      new Set(['a', 'gone']),
      new Set(['a', 'gone']),
      tasks,
      LOCAL_TZ,
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
      LOCAL_TZ,
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
      LOCAL_TZ,
      NOW,
    )
    expect(next).toEqual(new Set(['new']))
  })
})

// ============================================================
// Settings time zone + due dates (chunk 66, Day-7 #11)
// ============================================================

describe('todayReason in the Settings time zone (chunk 66)', () => {
  const NY = 'America/New_York'
  // Oct 13 2026, 10:00 in New York.
  const MORNING = new Date('2026-10-13T14:00:00.000Z')
  // Oct 13 2026, 22:30 in New York — already Oct 14 in UTC.
  const LATE = new Date('2026-10-14T02:30:00.000Z')
  // Due dates are stored as midnight of the picked day in the Settings zone.
  const DUE_OCT_12 = '2026-10-12T04:00:00.000Z'
  const DUE_OCT_13 = '2026-10-13T04:00:00.000Z'
  const DUE_OCT_14 = '2026-10-14T04:00:00.000Z'

  it('a due date of today is Due today', () => {
    expect(todayReason(task({ id: 't', dueAt: DUE_OCT_13 }), NY, MORNING)?.key).toBe('due')
  })

  it('a due date before today is Overdue', () => {
    expect(todayReason(task({ id: 't', dueAt: DUE_OCT_12 }), NY, MORNING)?.key).toBe(
      'overdue',
    )
  })

  it('a due date after today is no signal on its own', () => {
    expect(todayReason(task({ id: 't', dueAt: DUE_OCT_14 }), NY, MORNING)).toBeNull()
  })

  it('a due date never turns Overdue during its own day, whatever its time', () => {
    // An imported due date carrying a time (21:00 New York) is still due
    // today once that time has passed.
    const t = task({ id: 't', dueAt: '2026-10-14T01:00:00.000Z' })
    expect(todayReason(t, NY, LATE)?.key).toBe('due')
  })

  it('the day boundary is the Settings zone’s midnight, not UTC’s', () => {
    const t = task({ id: 't', dueAt: DUE_OCT_13 })
    // 22:30 Oct 13 in New York: still due today there…
    expect(todayReason(t, NY, LATE)?.key).toBe('due')
    // …but in UTC it is already Oct 14, so the same due date is Overdue.
    expect(todayReason(t, 'UTC', LATE)?.key).toBe('overdue')
  })

  it('a reminder later today in the Settings zone still counts as Due today', () => {
    // 21:00 New York on Oct 13 — Oct 14 in UTC.
    const t = task({ id: 't', remindAt: '2026-10-14T01:00:00.000Z' })
    expect(todayReason(t, NY, MORNING)?.key).toBe('due')
    expect(todayReason(t, 'UTC', MORNING)).toBeNull()
  })

  it('either signal places the task: due tomorrow + reminder today is Due today', () => {
    const t = task({
      id: 't',
      dueAt: DUE_OCT_14,
      remindAt: '2026-10-13T20:00:00.000Z',
    })
    expect(todayReason(t, NY, MORNING)?.key).toBe('due')
  })

  it('Overdue from the due date beats a reminder later today', () => {
    const t = task({
      id: 't',
      dueAt: DUE_OCT_12,
      remindAt: '2026-10-13T20:00:00.000Z',
    })
    expect(todayReason(t, NY, MORNING)?.key).toBe('overdue')
  })

  it('an unparseable due date is ignored', () => {
    expect(todayReason(task({ id: 't', dueAt: 'not a date' }), NY, MORNING)).toBeNull()
  })

  it('a completed task with a past due date has no reason', () => {
    const t = task({
      id: 't',
      dueAt: DUE_OCT_12,
      completedAt: '2026-10-12T15:00:00.000Z',
    })
    expect(todayReason(t, NY, MORNING)).toBeNull()
  })

  it('autoTodayIds and resolveToday use the zone they are given', () => {
    const tasks = [task({ id: 'd', dueAt: DUE_OCT_13 }), task({ id: 'n', dueAt: DUE_OCT_14 })]
    expect(autoTodayIds(tasks, NY, MORNING)).toEqual(new Set(['d']))
    const rows = resolveToday(
      { categories: [WORK], subcategories: [SUB_WORK], tasks },
      new Set(['d']),
      NY,
      MORNING,
    )
    expect(rows.map((r) => [r.task.id, r.reason.key])).toEqual([['d', 'due']])
  })
})
