import { describe, expect, it } from 'vitest'

import type { RoutineItem, RoutineLog } from '@/db/types'
import { calcStreak, requiredItemsByDay } from './streak'

// All tests fix `today` to a known date so day-arithmetic is
// reproducible. We don't `vi.mock('@/lib/clock', …)` here because the
// streak module already accepts `today` and `timezone` as explicit
// parameters per pre-flight note #6 — passing them is enough.

const TZ = 'America/New_York'
const TODAY = '2026-05-27'

// EDT is UTC-4 in May. startOfDay(2026-05-27, NY) = 2026-05-27T04:00:00.000Z.
// Items / logs use ISO timestamps that are explicitly before/after that
// boundary so each test's intent reads at a glance.
const BEFORE_TODAY = '2026-05-20T00:00:00.000Z' // ~7d before, well before today boundary
const MIDDAY_TODAY = '2026-05-27T14:00:00.000Z' // 10am ET — after today start

function daysAgo(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function buildItem(
  overrides: { id: string; routine: 'morning' | 'night' } & Partial<RoutineItem>,
): RoutineItem {
  return {
    userId: 'u-1',
    label: overrides.id,
    sortOrder: 0,
    archivedAt: null,
    createdAt: BEFORE_TODAY,
    ...overrides,
  }
}

function logFor(
  itemId: string,
  dateKey: string,
  completed = true,
): RoutineLog {
  return {
    id: `log-${itemId}-${dateKey}`,
    userId: 'u-1',
    routineItemId: itemId,
    dateKey,
    completed,
  }
}

function logsForRange(
  itemIds: string[],
  startDateKey: string,
  daysBackInclusive: number,
): RoutineLog[] {
  const out: RoutineLog[] = []
  for (let d = 0; d < daysBackInclusive; d += 1) {
    const dk = daysAgo(startDateKey, d)
    for (const id of itemIds) out.push(logFor(id, dk))
  }
  return out
}

describe('streak — calcStreak', () => {
  it('returns 0 when today is not started and yesterday is incomplete', () => {
    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'b', routine: 'morning' }),
    ]
    const logs: RoutineLog[] = [] // nothing checked anywhere
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(0)
  })

  it('returns 5 for 5 consecutive complete days ending yesterday, today not yet checked', () => {
    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'b', routine: 'morning' }),
    ]
    // Days -1 through -5 complete; today has no logs.
    const logs: RoutineLog[] = []
    for (let d = 1; d <= 5; d += 1) {
      logs.push(logFor('a', daysAgo(TODAY, d)))
      logs.push(logFor('b', daysAgo(TODAY, d)))
    }
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(5)
  })

  it('returns 5 when today is fully complete and 4 prior days are complete', () => {
    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'b', routine: 'morning' }),
    ]
    const logs = logsForRange(['a', 'b'], TODAY, 5)
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(5)
  })

  it('breaks at a gap day mid-history — only counts back to the gap', () => {
    const items = [buildItem({ id: 'a', routine: 'morning' })]
    // Days -1, -2 complete; day -3 missing; day -4 complete.
    const logs: RoutineLog[] = [
      logFor('a', daysAgo(TODAY, 1)),
      logFor('a', daysAgo(TODAY, 2)),
      // skip day -3
      logFor('a', daysAgo(TODAY, 4)),
    ]
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(2)
  })

  it('does NOT count days where some required items are unchecked', () => {
    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'b', routine: 'morning' }),
      buildItem({ id: 'c', routine: 'morning' }),
      buildItem({ id: 'd', routine: 'morning' }),
      buildItem({ id: 'e', routine: 'morning' }),
    ]
    // Yesterday: only 4 of 5 items completed.
    const logs: RoutineLog[] = [
      logFor('a', daysAgo(TODAY, 1)),
      logFor('b', daysAgo(TODAY, 1)),
      logFor('c', daysAgo(TODAY, 1)),
      logFor('d', daysAgo(TODAY, 1)),
      // 'e' missing for yesterday
    ]
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(0)
  })

  it('items created today do not block today from being complete', () => {
    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'b', routine: 'morning' }),
      // Brand-new item — added at 10am today. NOT required for today.
      buildItem({
        id: 'c-new',
        routine: 'morning',
        createdAt: MIDDAY_TODAY,
      }),
    ]
    // Pre-existing items checked off today; new item left unchecked.
    const logs: RoutineLog[] = [
      logFor('a', TODAY),
      logFor('b', TODAY),
    ]
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(1)
  })

  it('archived items are not required on or after the day they were archived', () => {
    // Item 'a' archived as of day -2 morning (between day -3 and day -2 starts).
    // For days -1 and 0 (today) it should NOT be required.
    // For day -2 and earlier it SHOULD be required.
    const archiveBoundary = daysAgo(TODAY, 2) // YYYY-MM-DD
    // Place archivedAt one second after startOfDay(day -2) so day -2
    // still requires the item but day -1 does not.
    const archivedAt = `${archiveBoundary}T04:00:01.000Z`
    const items = [
      buildItem({ id: 'a', routine: 'morning', archivedAt }),
      buildItem({ id: 'b', routine: 'morning' }),
    ]
    // Today: check 'b' (the only required item now → complete).
    // Day -1: check 'b' (the only required item → complete).
    // Day -2: 'a' was still required; check both → complete.
    // Day -3: 'a' still required; check both → complete.
    const logs: RoutineLog[] = [
      logFor('b', TODAY),
      logFor('b', daysAgo(TODAY, 1)),
      logFor('a', daysAgo(TODAY, 2)),
      logFor('b', daysAgo(TODAY, 2)),
      logFor('a', daysAgo(TODAY, 3)),
      logFor('b', daysAgo(TODAY, 3)),
    ]
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(4)
  })

  it('ignores logs for items in the other routine', () => {
    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'n', routine: 'night' }),
    ]
    // Night item is logged every day for 7 days. Morning has nothing.
    const logs: RoutineLog[] = []
    for (let d = 0; d < 7; d += 1) {
      logs.push(logFor('n', daysAgo(TODAY, d)))
    }
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(0)
    expect(calcStreak('night', items, logs, TODAY, TZ)).toBe(7)
  })
})

describe('streak — requiredItemsByDay', () => {
  it('returns empty sets for dates before any item existed', () => {
    const items = [
      buildItem({
        id: 'a',
        routine: 'morning',
        createdAt: `${daysAgo(TODAY, 3)}T04:00:01.000Z`,
      }),
    ]
    const dates = [
      daysAgo(TODAY, 5), // item didn't exist
      daysAgo(TODAY, 1), // item existed
      TODAY,
    ]
    const map = requiredItemsByDay(items, dates, TZ)
    expect(map.get(daysAgo(TODAY, 5))?.size).toBe(0)
    expect(map.get(daysAgo(TODAY, 1))?.has('a')).toBe(true)
    expect(map.get(TODAY)?.has('a')).toBe(true)
  })
})
