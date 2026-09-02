import { describe, expect, it } from 'vitest'

import {
  addDays,
  blockPos,
  busyToWeekBlocks,
  ceil15,
  expandedWindow,
  fmtClock,
  fmtRange,
  hiddenCounts,
  isoWeek,
  minutesOfDay,
  PLANNER,
  todayIndex,
  weekDays,
  weekMetaLabel,
  weekRangeLabel,
  weekStart,
} from './plannerGeometry'

/*
 * Pure geometry/week math (chunk 36). Dates are constructed with local
 * Date components throughout — the lib is deliberately browser-local
 * (locked decision D6), so tests never touch timezones.
 */

describe('clock formatting', () => {
  it('formats 24h clock and ranges', () => {
    expect(fmtClock(0)).toBe('00:00')
    expect(fmtClock(9 * 60 + 5)).toBe('09:05')
    expect(fmtClock(21 * 60)).toBe('21:00')
    expect(fmtRange(600, 645)).toBe('10:00–10:45')
  })

  it('ceil15 rounds up to the next quarter hour', () => {
    expect(ceil15(600)).toBe(600)
    expect(ceil15(601)).toBe(615)
    expect(ceil15(680)).toBe(690)
  })
})

describe('blockPos', () => {
  const { hourH } = PLANNER
  const h0 = 8 * 60
  const h1 = 19 * 60

  it('positions a block per the DESIGN_NOTES formula', () => {
    // 10:00–10:45 in the 08:00 window at 52px/h.
    const pos = blockPos(600, 645, hourH, h0, h1)
    expect(pos).toEqual({
      top: (120 / 60) * 52 + 1, // 105
      height: (45 / 60) * 52 - 2, // 37
      clipTop: false,
      clipBottom: false,
    })
  })

  it('enforces the 14px minimum height', () => {
    const pos = blockPos(600, 610, hourH, h0, h1)
    expect(pos?.height).toBe(14)
  })

  it('clamps a block crossing the top edge and flags clipTop', () => {
    // 07:30–08:30 against the 08:00 collapsed window.
    const pos = blockPos(450, 510, hourH, h0, h1)
    expect(pos).not.toBeNull()
    expect(pos?.top).toBe(1)
    expect(pos?.height).toBe((30 / 60) * 52 - 2)
    expect(pos?.clipTop).toBe(true)
    expect(pos?.clipBottom).toBe(false)
  })

  it('clamps a block crossing the bottom edge and flags clipBottom', () => {
    // 18:30–19:30 against the 19:00 end.
    const pos = blockPos(1110, 1170, hourH, h0, h1)
    expect(pos?.clipBottom).toBe(true)
    expect(pos?.clipTop).toBe(false)
  })

  it('returns null for blocks fully outside the window', () => {
    expect(blockPos(300, 360, hourH, h0, h1)).toBeNull() // 05:00–06:00
    expect(blockPos(1200, 1260, hourH, h0, h1)).toBeNull() // 20:00–21:00
    // Zero overlap at the exact edge is outside too.
    expect(blockPos(420, 480, hourH, h0, h1)).toBeNull() // 07:00–08:00
  })
})

describe('week helpers', () => {
  // The prototype's reference week: Mon May 4 – Sun May 10, 2026.
  const wed = new Date(2026, 4, 6, 11, 20)

  it('weekStart returns the local Monday 00:00', () => {
    const ws = weekStart(wed)
    expect([ws.getFullYear(), ws.getMonth(), ws.getDate()]).toEqual([2026, 4, 4])
    expect([ws.getHours(), ws.getMinutes()]).toEqual([0, 0])
    expect(ws.getDay()).toBe(1)
  })

  it('weekStart is idempotent on a Monday and handles Sundays', () => {
    const mon = new Date(2026, 4, 4)
    expect(weekStart(mon).getDate()).toBe(4)
    const sun = new Date(2026, 4, 10, 23, 59)
    expect(weekStart(sun).getDate()).toBe(4)
  })

  it('weekDays lists Mon–Sun', () => {
    const days = weekDays(weekStart(wed))
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.getDate())).toEqual([4, 5, 6, 7, 8, 9, 10])
  })

  it('labels the prototype week WEEK 19 · 2026', () => {
    expect(weekMetaLabel(weekStart(wed))).toBe('WEEK 19 · 2026')
  })

  it('isoWeek handles the year boundary (Dec 29 2025 → week 1 of 2026)', () => {
    expect(isoWeek(new Date(2025, 11, 29))).toEqual({ week: 1, year: 2026 })
    expect(isoWeek(new Date(2026, 0, 4))).toEqual({ week: 1, year: 2026 })
  })

  it('formats same-month and cross-month range labels', () => {
    expect(weekRangeLabel(weekStart(wed))).toBe('May 4 – 10')
    // Mon Apr 27 – Sun May 3, 2026.
    expect(weekRangeLabel(new Date(2026, 3, 27))).toBe('Apr 27 – May 3')
  })

  it('todayIndex is week-relative and can leave 0–6', () => {
    const ws = weekStart(wed)
    expect(todayIndex(ws, wed)).toBe(2)
    expect(todayIndex(ws, new Date(2026, 4, 10))).toBe(6)
    expect(todayIndex(ws, new Date(2026, 4, 1))).toBe(-3) // previous week
    expect(todayIndex(ws, new Date(2026, 4, 12))).toBe(8) // next week
  })

  it('minutesOfDay reads the local wall clock', () => {
    expect(minutesOfDay(new Date(2026, 4, 6, 11, 20))).toBe(680)
  })

  it('addDays crosses month boundaries', () => {
    expect(addDays(new Date(2026, 3, 30), 2).getDate()).toBe(2)
  })
})

describe('busyToWeekBlocks', () => {
  const ws = weekStart(new Date(2026, 4, 6))

  /** Local-time ISO builder for the test week. */
  const local = (day: number, h: number, m = 0) =>
    new Date(2026, 4, 4 + day, h, m).toISOString()

  it('maps instants to local wall-clock minutes on the right day', () => {
    const blocks = busyToWeekBlocks(
      [
        {
          start: local(2, 9, 0),
          end: local(2, 9, 30),
          source: 'outlook',
          title: 'Standup',
        },
      ],
      ws,
    )
    expect(blocks).toEqual([
      { day: 2, startMin: 540, endMin: 570, source: 'outlook', title: 'Standup' },
    ])
  })

  it('splits an interval crossing local midnight into two segments', () => {
    const blocks = busyToWeekBlocks(
      [{ start: local(3, 23, 0), end: local(4, 1, 0), source: 'icloud' }],
      ws,
    )
    expect(blocks).toEqual([
      { day: 3, startMin: 23 * 60, endMin: 24 * 60, source: 'icloud', title: undefined },
      { day: 4, startMin: 0, endMin: 60, source: 'icloud', title: undefined },
    ])
  })

  it('drops intervals outside the week and invalid ones', () => {
    const blocks = busyToWeekBlocks(
      [
        { start: local(-3, 10, 0), end: local(-3, 11, 0), source: 'icloud' },
        { start: 'not-a-date', end: local(2, 11, 0), source: 'outlook' },
        { start: local(2, 11, 0), end: local(2, 10, 0), source: 'outlook' },
      ],
      ws,
    )
    expect(blocks).toEqual([])
  })

  it('clips an interval that starts before the week', () => {
    const blocks = busyToWeekBlocks(
      [{ start: local(-1, 22, 0), end: local(0, 8, 0), source: 'outlook' }],
      ws,
    )
    expect(blocks).toEqual([
      { day: 0, startMin: 0, endMin: 480, source: 'outlook', title: undefined },
    ])
  })
})

describe('hiddenCounts', () => {
  it('counts blocks past each collapsed edge', () => {
    const blocks = [
      { startMin: 450, endMin: 495 }, // 07:30–08:15 → top
      { startMin: 540, endMin: 570 }, // inside
      { startMin: 1110, endMin: 1170 }, // 18:30–19:30 → bottom
      { startMin: 1140, endMin: 1260 }, // 19:00–21:00 → bottom
    ]
    expect(hiddenCounts(blocks)).toEqual({ top: 1, bottom: 2 })
  })

  it('is empty for an all-visible day', () => {
    expect(hiddenCounts([{ startMin: 600, endMin: 660 }])).toEqual({
      top: 0,
      bottom: 0,
    })
  })
})

describe('expandedWindow', () => {
  it('defaults to the full 07:00–21:00 window', () => {
    expect(expandedWindow([])).toEqual({
      start: PLANNER.winFullStart,
      end: PLANNER.winFullEnd,
    })
    expect(expandedWindow([{ startMin: 600, endMin: 660 }])).toEqual({
      start: PLANNER.winFullStart,
      end: PLANNER.winFullEnd,
    })
  })

  it('stretches to whole hours to cover out-of-window blocks', () => {
    // 05:10–06:00 → floor to 05:00; 21:00–22:40 → ceil to 23:00.
    expect(
      expandedWindow([
        { startMin: 310, endMin: 360 },
        { startMin: 1260, endMin: 1360 },
      ]),
    ).toEqual({ start: 300, end: 1380 })
  })

  it('clamps to the day bounds', () => {
    expect(expandedWindow([{ startMin: 0, endMin: 24 * 60 }])).toEqual({
      start: 0,
      end: 24 * 60,
    })
  })
})

describe('busyToWeekBlocks — calendar color (chunk 51b)', () => {
  it('carries `color` onto every segment of an interval and omits the key when absent', () => {
    const start = new Date(2026, 4, 4) // Mon 4 May 2026, local
    const out = busyToWeekBlocks(
      [
        {
          start: new Date(2026, 4, 5, 22).toISOString(),
          end: new Date(2026, 4, 6, 2).toISOString(),
          source: 'icloud',
          calendar: 'Home',
          color: '#ff2968',
        },
        {
          start: new Date(2026, 4, 7, 9).toISOString(),
          end: new Date(2026, 4, 7, 10).toISOString(),
          source: 'icloud',
        },
      ],
      start,
    )
    expect(out.map((b) => [b.day, b.color])).toEqual([
      [1, '#ff2968'],
      [2, '#ff2968'],
      [3, undefined],
    ])
    expect('color' in out[2]!).toBe(false)
  })
})
