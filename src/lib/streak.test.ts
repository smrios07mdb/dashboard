import { afterEach, describe, expect, it } from 'vitest'

import type { RoutineItem, RoutineLog } from '@/db/types'
import { __clockOverride, today } from './clock'
import { calcStreak, requiredItemsByDay } from './streak'

// Streak tests pass `today` explicitly per pre-flight note #6 in
// `streak.ts`, so they don't depend on the clock module. The DEV-only
// override test below verifies the harness path — that callers reading
// `clock.today(tz)` pick up the pinned value — and is what the
// chunk-10 smoke pass relies on for Tests 3 / 4 in the v2 spec. Always
// clear the override on test teardown so it never leaks between cases.
afterEach(() => {
  __clockOverride?.clear()
})

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

  it('archived items are not required on or after the day they were archived (ARCH §11)', () => {
    // ARCH §11 archival boundary (Option B): an item archived during
    // day D is NOT required for D. Boundary lives on the *end* of D
    // (equivalently startOfDay(D + 1)), so an `archivedAt` anywhere
    // within day -2 — including 1s after start-of-day — drops the
    // item from day -2's required set onward.
    const archiveBoundary = daysAgo(TODAY, 2) // YYYY-MM-DD
    // Mid-day-2 archive: 10am ET = 14:00Z (May EDT = UTC-4). Well
    // inside day -2's window, clearly after startOfDay(day -2).
    const archivedAt = `${archiveBoundary}T14:00:00.000Z`
    const items = [
      buildItem({ id: 'a', routine: 'morning', archivedAt }),
      buildItem({ id: 'b', routine: 'morning' }),
    ]
    // Today: required = {b}; check 'b' → complete.
    // Day -1: required = {b}; check 'b' → complete.
    // Day -2: required = {b} (a archived during day -2, not required); check 'b' → complete.
    // Day -3: required = {a, b}; check both → complete.
    // Day -4: required = {a, b}; no logs → break.
    const logs: RoutineLog[] = [
      logFor('b', TODAY),
      logFor('b', daysAgo(TODAY, 1)),
      logFor('b', daysAgo(TODAY, 2)), // 'a' NOT required on day -2 under Option B
      logFor('a', daysAgo(TODAY, 3)),
      logFor('b', daysAgo(TODAY, 3)),
    ]
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(4)
  })

  it('archiving an incomplete item mid-day does not break today (ARCH §11 Option B repro)', () => {
    // Repro of the prod scenario captured in PROGRESS.md's
    // "Archive-today streak semantics" investigation: items A, B, C
    // exist coming into today; user completes A and B, then archives
    // C mid-day via the Routines screen's DeleteConfirm flow. Under
    // the prior (Option A) rule this dropped today's streak credit
    // because C was still required and unchecked. Under Option B the
    // archived-today item is excluded from today's required set, so
    // today reads complete and the streak is retained.
    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'b', routine: 'morning' }),
      buildItem({
        id: 'c',
        routine: 'morning',
        // 10am ET on today — mid-day archive, never completed.
        archivedAt: `${TODAY}T14:00:00.000Z`,
      }),
    ]

    // Required-set assertion: c drops out of today's required set.
    const required = requiredItemsByDay(items, [TODAY], TZ)
    expect(required.get(TODAY)).toEqual(new Set(['a', 'b']))

    const logs: RoutineLog[] = [
      logFor('a', TODAY),
      logFor('b', TODAY),
      // c intentionally never logged
    ]
    // Today complete (2/2 required logged); no prior history → streak = 1.
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(1)
  })

  it('today fully archived → today is "faded", streak counts from yesterday backward', () => {
    // Newly-reachable state under ARCH §11 Option B: every item
    // archived during today, so today's required set is empty —
    // today is "faded" (the same neutral state as a day before any
    // item existed; rule 2 in streak.ts's docstring). This test
    // pins the existing faded-day treatment: today doesn't add to
    // the streak, but the count-back-from-yesterday loop in
    // `calcStreak` continues to extend through earlier complete
    // days. No new special-casing is introduced for the archival
    // variant — it flows through the same isDayComplete `req.size
    // === 0` short-circuit as the pre-creation case.
    const archivedToday = `${TODAY}T14:00:00.000Z`
    const items = [
      buildItem({ id: 'a', routine: 'morning', archivedAt: archivedToday }),
      buildItem({ id: 'b', routine: 'morning', archivedAt: archivedToday }),
    ]
    // Days -1, -2, -3: both items still active, both completed.
    const logs: RoutineLog[] = [
      logFor('a', daysAgo(TODAY, 1)),
      logFor('b', daysAgo(TODAY, 1)),
      logFor('a', daysAgo(TODAY, 2)),
      logFor('b', daysAgo(TODAY, 2)),
      logFor('a', daysAgo(TODAY, 3)),
      logFor('b', daysAgo(TODAY, 3)),
    ]
    // Today required = ∅ → today not complete, but doesn't break.
    // Count back: day -1 complete, day -2 complete, day -3 complete,
    // day -4 has no logs → break. Streak = 3.
    expect(calcStreak('morning', items, logs, TODAY, TZ)).toBe(3)
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

describe('streak — DEV harness clock override', () => {
  it('streak math reads the pinned today from clock.__clockOverride (smoke-pass path)', () => {
    // Pin "today" to a known dateKey via the DEV-only override hook.
    // This is the path the chunk-10 smoke pass v2 uses to advance
    // "today" — see PROGRESS.md Revisions 2026-05-27.
    const pinned = '2026-06-15'
    __clockOverride!.set(pinned)

    const items = [
      buildItem({ id: 'a', routine: 'morning' }),
      buildItem({ id: 'b', routine: 'morning' }),
    ]
    // Both items checked on the pinned day and the prior 2.
    const logs: RoutineLog[] = []
    for (let d = 0; d <= 2; d += 1) {
      const dk = daysAgo(pinned, d)
      logs.push(logFor('a', dk))
      logs.push(logFor('b', dk))
    }

    // Read today via the clock module — this is what real consumers do.
    const todayKey = today(TZ)
    expect(todayKey).toBe(pinned)
    expect(calcStreak('morning', items, logs, todayKey, TZ)).toBe(3)
  })

  it('clearing the override returns calcStreak inputs back to live behavior', () => {
    __clockOverride!.set('2026-06-15')
    expect(today(TZ)).toBe('2026-06-15')
    __clockOverride!.clear()
    // Now today(TZ) is the live value; streak math depends on the
    // current wall clock plus whatever logs are present (none here).
    const items = [buildItem({ id: 'a', routine: 'morning' })]
    expect(calcStreak('morning', items, [], today(TZ), TZ)).toBe(0)
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
