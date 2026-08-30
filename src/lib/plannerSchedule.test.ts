import { describe, expect, it } from 'vitest'

import type { ScheduledBlock, Task } from '@/db/types'
import { PLANNER, type WeekBusyBlock } from '@/lib/plannerGeometry'
import {
  autoFill,
  blockDurationMin,
  blockIsDone,
  isPastBlock,
  nextOpenSlot,
  BUSY_TTL_MS,
  isBusyEntryFresh,
  findOpenSlots,
  gridPointToSlot,
  overlapBusy,
  scheduledToWeekBlocks,
  snap15,
  splitTray,
  toInstant,
} from './plannerSchedule'

/*
 * Chunk 37 — scheduling math. Exact-port checks for the prototype's
 * `findOpenSlots` / `overlapBusy` / `posFromEvent`, plus the D3/D4
 * additions (instant ↔ grid round-trip, duration policy, tray split).
 */

const busy = (day: number, s: number, e: number, title?: string): WeekBusyBlock => ({
  day,
  startMin: s,
  endMin: e,
  source: 'icloud',
  title,
})
const sched = (day: number, s: number, e: number) => ({ day, startMin: s, endMin: e })

// Week of Mon May 4 2026 (local).
const weekStart = new Date(2026, 4, 4)

function aBlock(overrides: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b-1',
    userId: 'u-1',
    taskId: 't-1',
    startAt: new Date(2026, 4, 6, 13, 15).toISOString(),
    endAt: new Date(2026, 4, 6, 14, 0).toISOString(),
    done: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function aTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    userId: 'u-1',
    subcategoryId: 'sub-1',
    title: 'Task',
    notes: null,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('snap15 / blockDurationMin', () => {
  it('snap15 rounds to the nearest quarter hour', () => {
    expect(snap15(487)).toBe(480)
    expect(snap15(488)).toBe(495)
    expect(snap15(600)).toBe(600)
  })

  it('blockDurationMin: 0 → 30, 10 → 15, 47 → 60, 60 → 60', () => {
    expect(blockDurationMin(0)).toBe(30)
    expect(blockDurationMin(10)).toBe(15)
    expect(blockDurationMin(47)).toBe(60)
    expect(blockDurationMin(60)).toBe(60)
  })
})

describe('findOpenSlots', () => {
  it('finds the gap before the first occupancy with until = its start', () => {
    const slots = findOpenSlots(1, 45, [busy(1, 600, 660)], [], false, 0)
    expect(slots[0]).toEqual({ startMin: 480, endMin: 525, until: 600 })
  })

  it('finds a gap between two occupancies', () => {
    // 08:00–09:00 busy, 10:00–11:00 busy → gap 09:00–10:00 fits 45m.
    const slots = findOpenSlots(
      1,
      45,
      [busy(1, 480, 540), busy(1, 600, 660)],
      [],
      false,
      0,
    )
    expect(slots[0]).toEqual({ startMin: 540, endMin: 585, until: 600 })
  })

  it('trailing slots after the last occupancy use the max(dur,60)+60 stride', () => {
    const slots = findOpenSlots(1, 30, [busy(1, 480, 540)], [], false, 0)
    expect(slots).toEqual([
      { startMin: 540, endMin: 570, until: 1200 },
      { startMin: 660, endMin: 690, until: 1200 },
      { startMin: 780, endMin: 810, until: 1200 },
    ])
  })

  it('today starts at ceil15(now + 10)', () => {
    // now = 11:20 → 11:30 → ceil15 = 11:30
    const slots = findOpenSlots(2, 30, [], [], true, 680)
    expect(slots[0].startMin).toBe(690)
  })

  it('returns [] when nothing fits', () => {
    // Day fully occupied 08:00–20:00.
    expect(findOpenSlots(1, 30, [busy(1, 480, 1200)], [], false, 0)).toEqual([])
    // Too late in the day for the duration.
    expect(findOpenSlots(2, 60, [], [], true, 1170)).toEqual([])
  })

  it('never returns more than 3 and honours scheduled blocks too', () => {
    const slots = findOpenSlots(
      1,
      15,
      [busy(1, 540, 600)],
      [sched(1, 660, 720), sched(1, 480, 500)],
      false,
      0,
    )
    expect(slots).toHaveLength(3)
    // 08:00–08:20 scheduled → first slot starts 08:30 (ceil15 of 500).
    expect(slots[0]).toEqual({ startMin: 510, endMin: 525, until: 540 })
  })
})

describe('overlapBusy', () => {
  it('returns null when nothing overlaps', () => {
    expect(overlapBusy(1, 600, 660, [busy(1, 660, 720), busy(2, 600, 660)])).toBeNull()
  })

  it('picks the larger of two overlaps', () => {
    const hit = overlapBusy(1, 600, 700, [
      busy(1, 580, 620, 'Small'),
      busy(1, 640, 800, 'Big'),
    ])
    expect(hit).toEqual({ title: 'Big', mins: 60 })
  })

  it('reports title: null for an untitled busy block', () => {
    expect(overlapBusy(1, 600, 660, [busy(1, 630, 700)])).toEqual({
      title: null,
      mins: 30,
    })
  })
})

describe('scheduledToWeekBlocks / toInstant', () => {
  it('maps a single-day block to local minutes and carries done', () => {
    const [b] = scheduledToWeekBlocks([aBlock({ done: true })], weekStart)
    expect(b).toEqual({
      id: 'b-1',
      taskId: 't-1',
      day: 2,
      startMin: 795,
      endMin: 840,
      done: true,
    })
  })

  it('splits a block crossing local midnight into two segments', () => {
    const out = scheduledToWeekBlocks(
      [
        aBlock({
          startAt: new Date(2026, 4, 5, 23, 30).toISOString(),
          endAt: new Date(2026, 4, 6, 0, 30).toISOString(),
        }),
      ],
      weekStart,
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ day: 1, startMin: 1410, endMin: 1440 })
    expect(out[1]).toMatchObject({ day: 2, startMin: 0, endMin: 30 })
  })

  it('drops blocks outside the week and invalid ranges', () => {
    expect(
      scheduledToWeekBlocks(
        [
          aBlock({
            startAt: new Date(2026, 4, 12, 9).toISOString(),
            endAt: new Date(2026, 4, 12, 10).toISOString(),
          }),
          aBlock({ id: 'x', startAt: 'nope', endAt: 'nope' }),
          aBlock({
            id: 'y',
            startAt: new Date(2026, 4, 6, 10).toISOString(),
            endAt: new Date(2026, 4, 6, 9).toISOString(),
          }),
        ],
        weekStart,
      ),
    ).toEqual([])
  })

  it('toInstant ↔ scheduledToWeekBlocks round-trips a Wednesday 13:15 block', () => {
    const startAt = toInstant(weekStart, 2, 795)
    const endAt = toInstant(weekStart, 2, 840)
    expect(new Date(startAt).getTime()).toBe(new Date(2026, 4, 6, 13, 15).getTime())
    const [b] = scheduledToWeekBlocks([aBlock({ startAt, endAt })], weekStart)
    expect(b).toMatchObject({ day: 2, startMin: 795, endMin: 840 })
  })
})

describe('gridPointToSlot', () => {
  // 56px gutter + 5×100 + 2×55 = 666px wide grid, 08:00–19:00 window.
  const base = {
    width: 56 + 500 + 110,
    gutter: PLANNER.gutter,
    hourH: PLANNER.hourH,
    h0: 8 * 60,
    h1: 19 * 60,
  }

  it('resolves weekday column boundaries', () => {
    expect(gridPointToSlot({ ...base, x: 56 + 1, y: 0 })?.day).toBe(0)
    expect(gridPointToSlot({ ...base, x: 56 + 99, y: 0 })?.day).toBe(0)
    expect(gridPointToSlot({ ...base, x: 56 + 100, y: 0 })?.day).toBe(1)
    expect(gridPointToSlot({ ...base, x: 56 + 499, y: 0 })?.day).toBe(4)
  })

  it('resolves a point inside the half-width SAT column', () => {
    expect(gridPointToSlot({ ...base, x: 56 + 500 + 20, y: 0 })?.day).toBe(5)
    expect(gridPointToSlot({ ...base, x: 56 + 555 + 20, y: 0 })?.day).toBe(6)
  })

  it('snaps y to 15 minutes from the window start', () => {
    // 52px/hour → 30m = 26px; 15px ≈ 17m → snaps to 15; 20px ≈ 23m → 30.
    expect(gridPointToSlot({ ...base, x: 100, y: 26 })?.minute).toBe(8 * 60 + 30)
    expect(gridPointToSlot({ ...base, x: 100, y: 15 })?.minute).toBe(8 * 60 + 15)
    expect(gridPointToSlot({ ...base, x: 100, y: 20 })?.minute).toBe(8 * 60 + 30)
  })

  it('returns null in the gutter and more than 20px below the grid', () => {
    expect(gridPointToSlot({ ...base, x: 30, y: 50 })).toBeNull()
    const gridH = 11 * PLANNER.hourH
    expect(gridPointToSlot({ ...base, x: 100, y: gridH + 21 })).toBeNull()
    // …but inside the 20px tolerance it clamps to the window end.
    expect(gridPointToSlot({ ...base, x: 100, y: gridH + 10 })?.minute).toBe(19 * 60)
  })
})

describe('splitTray', () => {
  it('excludes completed tasks and tasks that already have a block', () => {
    const tasks = [
      aTask({ id: 'open' }),
      aTask({ id: 'done', completedAt: '2026-05-01T00:00:00.000Z' }),
      aTask({ id: 'blocked' }),
    ]
    const out = splitTray(tasks, [aBlock({ taskId: 'blocked' })])
    expect(out.map((t) => t.id)).toEqual(['open'])
  })
})

describe('blockIsDone (chunk 37 revisions R1)', () => {
  it('derives done from task.completedAt only — a stale block.done never wins', () => {
    // Smoke check 5: block.done=true left behind after a Dashboard uncheck.
    const block = aBlock({ done: true })
    expect(block.done).toBe(true)
    expect(blockIsDone(aTask({ completedAt: null }))).toBe(false)
    expect(blockIsDone(aTask({ completedAt: '2026-05-01T09:00:00.000Z' }))).toBe(true)
  })
})

describe('isBusyEntryFresh (chunk 37 revisions R2)', () => {
  it('is fresh inside the 5-minute TTL and stale at/after it or when absent', () => {
    const now = 1_000_000_000
    expect(isBusyEntryFresh({ fetchedAt: now - 1 }, now)).toBe(true)
    expect(isBusyEntryFresh({ fetchedAt: now - BUSY_TTL_MS + 1 }, now)).toBe(true)
    expect(isBusyEntryFresh({ fetchedAt: now - BUSY_TTL_MS }, now)).toBe(false)
    expect(isBusyEntryFresh(null, now)).toBe(false)
    expect(isBusyEntryFresh(undefined, now)).toBe(false)
  })
})

// ============================================================
// Chunk 38 — carryover + Fill my week
// ============================================================

describe('isPastBlock (chunk 38 D6)', () => {
  const todayIdx = 2
  const nowMin = 680
  it('past day → true; today ended → true; today running → false; future → false', () => {
    expect(isPastBlock({ day: 1, endMin: 600 }, todayIdx, nowMin)).toBe(true)
    expect(isPastBlock({ day: 2, endMin: 680 }, todayIdx, nowMin)).toBe(true)
    expect(isPastBlock({ day: 2, endMin: 700 }, todayIdx, nowMin)).toBe(false)
    expect(isPastBlock({ day: 3, endMin: 600 }, todayIdx, nowMin)).toBe(false)
  })
  it('todayIdx out of range: a past week is all past, a future week none', () => {
    expect(isPastBlock({ day: 6, endMin: 1439 }, 9, 0)).toBe(true)
    expect(isPastBlock({ day: 0, endMin: 540 }, -1, 1439)).toBe(false)
  })
})

describe('nextOpenSlot (chunk 38 D4)', () => {
  it('today starts at ceil15(now + 10)', () => {
    expect(nextOpenSlot(30, [], [], 2, 680)).toEqual({ day: 2, startMin: 690 })
  })
  it('skips busy and scheduled ranges, snapping the cursor to 15m', () => {
    const slot = nextOpenSlot(
      30,
      [busy(2, 690, 750)],
      [sched(2, 750, 842)],
      2,
      680,
    )
    expect(slot).toEqual({ day: 2, startMin: 855 })
  })
  it('falls to the next day at 09:00 when today is full', () => {
    expect(nextOpenSlot(30, [busy(2, 690, 1080)], [], 2, 680)).toEqual({
      day: 3,
      startMin: 540,
    })
  })
  it('allows weekend days (today → Sunday)', () => {
    expect(nextOpenSlot(30, [], [], 5, 600)).toEqual({ day: 5, startMin: 615 })
    expect(nextOpenSlot(60, [busy(5, 540, 1080)], [], 5, 0)).toEqual({
      day: 6,
      startMin: 540,
    })
  })
  it('returns null when todayIdx > 6 (past week) or nothing fits', () => {
    expect(nextOpenSlot(30, [], [], 7, 0)).toBeNull()
    const full = [0, 1, 2, 3, 4, 5, 6].map((d) => busy(d, 540, 1080))
    expect(nextOpenSlot(15, full, [], 0, 0)).toBeNull()
    // A 10h block never fits the 9h window.
    expect(nextOpenSlot(600, [], [], 0, 0)).toBeNull()
  })
})

describe('autoFill (chunk 38 D3)', () => {
  const p1 = (id: string, over: Partial<Task> = {}) =>
    aTask({ id, priority: 1, estimateMinutes: 30, ...over })
  const p2 = (id: string, over: Partial<Task> = {}) =>
    aTask({ id, priority: 2, estimateMinutes: 30, ...over })

  it('P1 before P2, packed sequentially from Monday 09:00 on a future week', () => {
    const out = autoFill([p2('b'), p1('a')], [], [], -7, 1000)
    expect(out).toEqual([
      { taskId: 'a', day: 0, startMin: 540, endMin: 570 },
      { taskId: 'b', day: 0, startMin: 570, endMin: 600 },
    ])
  })
  it('ties break by due date then created_at via compareTasks', () => {
    const out = autoFill(
      [
        p1('late', { dueAt: '2026-05-10T00:00:00.000Z' }),
        p1('none'),
        p1('early', { dueAt: '2026-05-05T00:00:00.000Z' }),
      ],
      [],
      [],
      0,
      0,
    )
    expect(out.map((p) => p.taskId)).toEqual(['early', 'late', 'none'])
  })
  it('excludes P3 and no-priority tasks', () => {
    const out = autoFill(
      [aTask({ id: 'p3', priority: 3 }), aTask({ id: 'np', priority: null }), p1('a')],
      [],
      [],
      0,
      0,
    )
    expect(out.map((p) => p.taskId)).toEqual(['a'])
  })
  it('a 0-estimate task proposes 30m (blockDurationMin, deviation from the prototype)', () => {
    const out = autoFill([p1('z', { estimateMinutes: 0 })], [], [], 0, 0)
    expect(out[0].endMin - out[0].startMin).toBe(30)
  })
  it('earlier proposals occupy for later candidates and spill to the next day', () => {
    const out = autoFill(
      [p1('big', { estimateMinutes: 480 }), p2('small', { estimateMinutes: 60 })],
      [],
      [],
      0,
      0,
    )
    expect(out).toEqual([
      { taskId: 'big', day: 0, startMin: 540, endMin: 1020 },
      { taskId: 'small', day: 0, startMin: 1020, endMin: 1080 },
    ])
    const out2 = autoFill(
      [p1('big', { estimateMinutes: 480 }), p2('mid', { estimateMinutes: 90 })],
      [],
      [],
      0,
      0,
    )
    expect(out2[1]).toEqual({ taskId: 'mid', day: 1, startMin: 540, endMin: 630 })
  })
  it('weekend of the current week or a past week → []', () => {
    expect(autoFill([p1('a')], [], [], 5, 600)).toEqual([])
    expect(autoFill([p1('a')], [], [], 6, 600)).toEqual([])
    expect(autoFill([p1('a')], [], [], 8, 600)).toEqual([])
  })
  it('today starts at ceil15(now + 10); honors busy + scheduled', () => {
    expect(autoFill([p1('a')], [], [], 2, 680)).toEqual([
      { taskId: 'a', day: 2, startMin: 690, endMin: 720 },
    ])
    const out = autoFill(
      [p1('a')],
      [busy(2, 690, 750)],
      [sched(2, 750, 840)],
      2,
      680,
    )
    expect(out).toEqual([{ taskId: 'a', day: 2, startMin: 840, endMin: 870 }])
  })
  it('never proposes past Friday — a task that fits nowhere is skipped', () => {
    const full = [0, 1, 2, 3, 4].map((d) => busy(d, 540, 1080))
    expect(autoFill([p1('a')], full, [], 0, 0)).toEqual([])
    // A task too long for any day is skipped while a shorter one still lands.
    const out = autoFill([p1('huge', { estimateMinutes: 600 }), p2('ok')], [], [], 0, 0)
    expect(out.map((p) => p.taskId)).toEqual(['ok'])
  })
})
