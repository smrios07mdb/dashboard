import { describe, expect, it } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

import {
  aggregateForChart,
  applyOtherGrouping,
  buildColorMap,
  OTHER_KEY,
  summaryTable,
} from './insights'

// ---------- fixtures ----------

function cat(id: string, name: 'Work' | 'Personal'): Category {
  return { id, userId: 'u1', name }
}

function sub(id: string, categoryId: string, name: string): Subcategory {
  return { id, userId: 'u1', categoryId, name, sortOrder: 0, archivedAt: null }
}

function task(
  id: string,
  subcategoryId: string,
  estimateMinutes: number,
  completedDay: string | null,
): Task {
  return {
    id,
    userId: 'u1',
    subcategoryId,
    title: id,
    notes: null,
    estimateMinutes,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: completedDay ? `${completedDay}T12:00:00.000Z` : null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }
}

const WORK = cat('c-work', 'Work')
const PERSONAL = cat('c-personal', 'Personal')

// ============================================================
// summaryTable — exhaustive, descending, % of total
// ============================================================

describe('summaryTable', () => {
  it('sums minutes + task counts per subcategory, sorted descending with correct %', () => {
    const subs = [sub('s-a', 'c-work', 'Inbox'), sub('s-b', 'c-work', 'Projects')]
    const tasks = [
      task('t1', 's-a', 30, '2026-05-20'),
      task('t2', 's-a', 30, '2026-05-21'),
      task('t3', 's-b', 90, '2026-05-20'),
    ]

    const rows = summaryTable(tasks, subs)

    // Projects (90m) sorts above Inbox (60m).
    expect(rows.map((r) => r.name)).toEqual(['Projects', 'Inbox'])
    expect(rows[0]).toMatchObject({ minutes: 90, tasks: 1 })
    expect(rows[1]).toMatchObject({ minutes: 60, tasks: 2 })
    // 90 / 150 = 60%, 60 / 150 = 40%
    expect(rows[0].pct).toBeCloseTo(60)
    expect(rows[1].pct).toBeCloseTo(40)
  })

  it('omits subcategories with no completed tasks in range and handles empty input', () => {
    const subs = [sub('s-a', 'c-work', 'Inbox'), sub('s-empty', 'c-work', 'Idle')]
    expect(summaryTable([], subs)).toEqual([])
    const rows = summaryTable([task('t1', 's-a', 10, '2026-05-20')], subs)
    expect(rows.map((r) => r.name)).toEqual(['Inbox'])
  })
})

// ============================================================
// aggregateForChart — per-day stacked sums
// ============================================================

describe('aggregateForChart', () => {
  it('buckets completed minutes by day and subcategory', () => {
    const subs = [sub('s-a', 'c-work', 'Inbox'), sub('s-b', 'c-personal', 'Home')]
    const tasks = [
      task('t1', 's-a', 30, '2026-05-20'),
      task('t2', 's-a', 15, '2026-05-20'),
      task('t3', 's-b', 45, '2026-05-21'),
    ]

    const model = aggregateForChart(tasks, subs, [WORK, PERSONAL])

    const may20 = model.days.find((d) => d.date === '2026-05-20')
    const may21 = model.days.find((d) => d.date === '2026-05-21')
    expect(may20?.minutes['s-a']).toBe(45)
    expect(may21?.minutes['s-b']).toBe(45)
    // series cover both active subcategories
    expect(model.series.map((s) => s.key).sort()).toEqual(['s-a', 's-b'])
  })

  it('zero-fills every day when an explicit dayKeys range is given', () => {
    const subs = [sub('s-a', 'c-work', 'Inbox')]
    const tasks = [task('t1', 's-a', 30, '2026-05-21')]
    const model = aggregateForChart(tasks, subs, [WORK], [
      '2026-05-20',
      '2026-05-21',
      '2026-05-22',
    ])
    expect(model.days.map((d) => d.date)).toEqual([
      '2026-05-20',
      '2026-05-21',
      '2026-05-22',
    ])
    expect(model.days[0].minutes['s-a'] ?? 0).toBe(0)
    expect(model.days[1].minutes['s-a']).toBe(30)
  })
})

// ============================================================
// applyOtherGrouping — the 8-vs-9 boundary (the headline rule)
// ============================================================

function modelWithNSubs(n: number): ReturnType<typeof aggregateForChart> {
  const subs = Array.from({ length: n }, (_, i) =>
    sub(`s-${i}`, 'c-work', `Sub ${i}`),
  )
  // Give each sub a distinct total so "top 7 by minutes" is unambiguous:
  // s-0 highest … s-(n-1) lowest.
  const tasks = subs.map((s, i) => task(`t-${i}`, s.id, (n - i) * 10, '2026-05-20'))
  return aggregateForChart(tasks, subs, [WORK])
}

describe('applyOtherGrouping', () => {
  it('does NOT group at exactly 8 subcategories', () => {
    const { bars, groupedNames } = applyOtherGrouping(modelWithNSubs(8))
    expect(bars.series).toHaveLength(8)
    expect(bars.series.some((s) => s.key === OTHER_KEY)).toBe(false)
    expect(groupedNames).toEqual([])
  })

  it('groups all but the top 7 into Other at 9 subcategories', () => {
    const model = modelWithNSubs(9)
    const { bars, groupedNames } = applyOtherGrouping(model)

    // 7 named + 1 Other = 8 series.
    expect(bars.series).toHaveLength(8)
    const otherSeries = bars.series.find((s) => s.key === OTHER_KEY)
    expect(otherSeries).toBeDefined()
    // The two smallest (s-7 @ 20m, s-8 @ 10m) are folded.
    expect(groupedNames.sort()).toEqual(['Sub 7', 'Sub 8'])
    // Other's per-day minutes = sum of the folded subs (20 + 10 = 30).
    const day = bars.days[0]
    expect(day.minutes[OTHER_KEY]).toBe(30)
    // Folded subs no longer appear as their own keys.
    expect(day.minutes['s-7']).toBeUndefined()
  })
})

// ============================================================
// buildColorMap — deterministic ramps off the category base
// ============================================================

describe('buildColorMap', () => {
  it('assigns the category base to the first sub and is deterministic', () => {
    const subs = [
      sub('s-1', 'c-work', 'Inbox'),
      sub('s-2', 'c-work', 'Projects'),
      sub('s-3', 'c-personal', 'Home'),
    ]
    const map1 = buildColorMap(subs, [WORK, PERSONAL])
    const map2 = buildColorMap(subs, [WORK, PERSONAL])

    expect(map1).toEqual(map2) // deterministic
    expect(map1['s-1'].toLowerCase()).toBe('#3a5a40') // Work base
    expect(map1['s-3'].toLowerCase()).toBe('#a85a3c') // Personal base
    expect(map1['s-2']).not.toBe(map1['s-1']) // second Work sub lightened
  })
})
