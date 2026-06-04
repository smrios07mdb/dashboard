import { describe, expect, it } from 'vitest'

import type { Subcategory, Task } from '@/db/types'

import { selectDashboardState } from './dashboardState'

// ---------- fixtures ----------

function sub(
  id: string,
  opts: { archivedAt?: string | null } = {},
): Subcategory {
  return {
    id,
    userId: 'u1',
    categoryId: 'c1',
    name: id,
    sortOrder: 0,
    archivedAt: opts.archivedAt ?? null,
  }
}

function task(
  id: string,
  opts: { subcategoryId?: string; completedAt?: string | null } = {},
): Task {
  return {
    id,
    userId: 'u1',
    subcategoryId: opts.subcategoryId ?? 's1',
    title: id,
    notes: null,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: opts.completedAt ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const DONE = '2026-01-03T00:00:00.000Z'
const ARCHIVED = '2026-01-02T00:00:00.000Z'

describe('selectDashboardState', () => {
  it("returns 'first-run' when there are no non-archived subcategories, even if task rows exist", () => {
    // Signup seeds Work/Personal categories but no subcategories; a task
    // cannot exist without one, so 0 live subs is the brand-new dead-end.
    expect(
      selectDashboardState([], [task('t1', { completedAt: null })]),
    ).toBe('first-run')
  })

  it("counts archived-only subcategories as zero live subs → 'first-run'", () => {
    expect(
      selectDashboardState([sub('s1', { archivedAt: ARCHIVED })], []),
    ).toBe('first-run')
  })

  it("returns 'all-clear' when a live subcategory exists but there are no tasks at all", () => {
    // Accepted edge: a usable board with nothing logged is not a dead-end —
    // the + Add task / + Add subcategory affordances are present.
    expect(selectDashboardState([sub('s1')], [])).toBe('all-clear')
  })

  it("returns 'all-clear' when a live subcategory exists and every task is completed", () => {
    expect(
      selectDashboardState(
        [sub('s1')],
        [
          task('t1', { subcategoryId: 's1', completedAt: DONE }),
          task('t2', { subcategoryId: 's1', completedAt: DONE }),
        ],
      ),
    ).toBe('all-clear')
  })

  it("returns 'normal' when at least one outstanding task exists in a live subcategory", () => {
    expect(
      selectDashboardState(
        [sub('s1')],
        [
          task('t1', { subcategoryId: 's1', completedAt: DONE }),
          task('t2', { subcategoryId: 's1', completedAt: null }),
        ],
      ),
    ).toBe('normal')
  })

  it("ignores incomplete tasks whose subcategory is archived → 'all-clear'", () => {
    // Mirrors the Dashboard's openTasks semantics (incomplete AND live sub):
    // an incomplete task in an archived sub never renders, so the visible
    // board is all-clear.
    expect(
      selectDashboardState(
        [sub('s1'), sub('s2', { archivedAt: ARCHIVED })],
        [
          task('t1', { subcategoryId: 's1', completedAt: DONE }),
          task('t2', { subcategoryId: 's2', completedAt: null }),
        ],
      ),
    ).toBe('all-clear')
  })
})
