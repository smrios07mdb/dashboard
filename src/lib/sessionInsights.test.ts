import { describe, expect, it } from 'vitest'

import type { Category, Subcategory, Task, TrackedSession } from '@/db/types'

import {
  categoryScope,
  sessionDayKey,
  sessionDays,
  sessionsInScope,
  sessionTotals,
} from './sessionInsights'

/*
 * Chunk 98 (D17, D19) — the tracked section's arithmetic. Every instant below
 * is written in UTC, so the expectations hold in whatever zone the suite runs
 * (the gate runs it in America/New_York, UTC and Asia/Tokyo).
 */

let seq = 0
function session(over: Partial<TrackedSession> = {}): TrackedSession {
  seq += 1
  return {
    id: `s-${seq}`,
    userId: 'u1',
    kind: 'focus',
    startedAt: '2026-11-10T15:00:00.000Z',
    endedAt: '2026-11-10T15:25:00.000Z',
    plannedSeconds: 1500,
    activeSeconds: 1500,
    outcome: 'completed',
    taskId: null,
    taskTitle: null,
    createdAt: '2026-11-10T15:25:01.000Z',
    ...over,
  }
}

const focusOn = (
  taskId: string,
  taskTitle: string,
  over: Partial<TrackedSession> = {},
) => session({ taskId, taskTitle, ...over })

const breathing = (over: Partial<TrackedSession> = {}) =>
  session({
    kind: 'meditation',
    outcome: 'ended',
    plannedSeconds: 300,
    activeSeconds: 180,
    ...over,
  })

const cat = (id: string, name: 'Work' | 'Personal'): Category => ({
  id,
  userId: 'u1',
  name,
})
const sub = (
  id: string,
  categoryId: string,
  archivedAt: string | null = null,
): Subcategory => ({
  id,
  userId: 'u1',
  categoryId,
  name: id,
  sortOrder: 0,
  archivedAt,
})
const task = (id: string, subcategoryId: string, title = id): Task => ({
  id,
  userId: 'u1',
  subcategoryId,
  title,
  estimateMinutes: 0,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
})

const CATS = [cat('c-work', 'Work'), cat('c-personal', 'Personal')]
const SUBS = [
  sub('s-atlas', 'c-work'),
  sub('s-old', 'c-work', '2026-01-01T00:00:00.000Z'),
  sub('s-gym', 'c-personal'),
]
const TASKS = [
  task('t-report', 's-atlas', 'Write the report (renamed)'),
  task('t-archive', 's-old'),
  task('t-run', 's-gym', 'Run'),
]

describe('categoryScope', () => {
  it('holds the live tasks of that category, archived subcategories included', () => {
    expect([...categoryScope('Work', TASKS, SUBS, CATS)].sort()).toEqual([
      't-archive',
      't-report',
    ])
    expect([...categoryScope('Personal', TASKS, SUBS, CATS)]).toEqual(['t-run'])
    expect(categoryScope('Work', [], SUBS, CATS).size).toBe(0)
  })
})

describe('sessionTotals', () => {
  const SESSIONS = [
    focusOn('t-report', 'Write the report'), // 25 min, completed
    focusOn('t-report', 'Write the report', {
      activeSeconds: 600,
      outcome: 'skipped',
    }), // 10 min
    focusOn('t-run', 'Run', { activeSeconds: 900, outcome: 'stopped' }), // 15 min
    focusOn('t-deleted', 'A task since deleted', { activeSeconds: 300 }), // 5 min
    session({ activeSeconds: 1200 }), // bare, 20 min, completed
    breathing(), // 3 min
    breathing({ activeSeconds: 290, outcome: 'completed' }), // 4.83 min
  ]

  it('All counts everything', () => {
    const t = sessionTotals(SESSIONS, null)
    expect(t).toMatchObject({
      count: 7,
      focusMinutes: 75,
      focusSessions: 5,
      focusCompleted: 3,
      // 470 s → 8 min, rounded once over the sum.
      breathingMinutes: 8,
      breathingSessions: 2,
    })
  })

  it('a category keeps only focus sessions on its live tasks', () => {
    const work = sessionTotals(
      SESSIONS,
      categoryScope('Work', TASKS, SUBS, CATS),
    )
    expect(work).toMatchObject({
      count: 2,
      focusMinutes: 35,
      focusSessions: 2,
      focusCompleted: 1,
      breathingMinutes: 0,
      breathingSessions: 0,
    })
    const personal = sessionTotals(
      SESSIONS,
      categoryScope('Personal', TASKS, SUBS, CATS),
    )
    expect(personal).toMatchObject({ count: 1, focusMinutes: 15 })
  })

  it('bare, breathing and deleted-task sessions are outside every category', () => {
    const scope = categoryScope('Work', TASKS, SUBS, CATS)
    const kept = sessionsInScope(SESSIONS, scope)
    expect(kept.every((s) => s.kind === 'focus' && s.taskId === 't-report')).toBe(
      true,
    )
    expect(sessionsInScope(SESSIONS, null)).toBe(SESSIONS)
    const none = sessionTotals(
      [session(), breathing(), focusOn('t-deleted', 'Gone')],
      scope,
    )
    expect(none).toMatchObject({ count: 0, focusSessions: 0, mostFocused: null })
  })

  it('Most focused is the task with the most focus time, under its live title', () => {
    const titles = new Map(TASKS.map((t) => [t.id, t.title]))
    expect(sessionTotals(SESSIONS, null, titles).mostFocused).toEqual({
      taskId: 't-report',
      title: 'Write the report (renamed)',
      minutes: 35,
    })
  })

  it('Most focused falls back to the saved title when the task is gone', () => {
    const sessions = [
      focusOn('t-deleted', 'Old name', {
        startedAt: '2026-11-01T10:00:00.000Z',
      }),
      focusOn('t-deleted', 'Newer name', {
        startedAt: '2026-11-05T10:00:00.000Z',
      }),
      focusOn('t-run', 'Run', { activeSeconds: 60 }),
    ]
    const titles = new Map([['t-run', 'Run']])
    expect(sessionTotals(sessions, null, titles).mostFocused).toMatchObject({
      taskId: 't-deleted',
      title: 'Newer name',
      minutes: 50,
    })
    // No titles at all: still the snapshot.
    expect(sessionTotals(sessions, null).mostFocused?.title).toBe('Newer name')
  })

  it('there is no Most focused without a session on a task', () => {
    expect(sessionTotals([session(), breathing()], null).mostFocused).toBeNull()
    expect(sessionTotals([], null)).toMatchObject({
      count: 0,
      focusMinutes: 0,
      breathingMinutes: 0,
      mostFocused: null,
    })
  })
})

describe('sessionDays', () => {
  const KEYS = ['2026-11-09', '2026-11-10', '2026-11-11']

  it('gives one bucket per day key, in order, with both series', () => {
    const days = sessionDays(
      [
        session({ startedAt: '2026-11-10T15:00:00.000Z' }), // 25
        session({ startedAt: '2026-11-10T18:00:00.000Z', activeSeconds: 600 }),
        breathing({ startedAt: '2026-11-10T19:00:00.000Z' }), // 3
        breathing({ startedAt: '2026-11-11T09:00:00.000Z', activeSeconds: 300 }),
        // Outside the keys: left out.
        session({ startedAt: '2026-11-01T12:00:00.000Z' }),
      ],
      KEYS,
      'UTC',
    )
    expect(days).toEqual([
      { date: '2026-11-09', label: 'Nov 9', focus: 0, breathing: 0 },
      { date: '2026-11-10', label: 'Nov 10', focus: 35, breathing: 3 },
      { date: '2026-11-11', label: 'Nov 11', focus: 0, breathing: 5 },
    ])
  })

  /*
   * 23:30 local on Nov 10 in each zone, for a 50-minute focus that runs past
   * midnight: it counts on Nov 10, the day it started.
   */
  const AT_2330: [string, string][] = [
    ['America/New_York', '2026-11-11T04:30:00.000Z'], // UTC−5
    ['UTC', '2026-11-10T23:30:00.000Z'],
    ['Asia/Tokyo', '2026-11-10T14:30:00.000Z'], // UTC+9
  ]

  it.each(AT_2330)(
    'a session at 23:30 in %s stays on its own day and counts on its start day',
    (tz, startedAt) => {
      const late = session({
        startedAt,
        endedAt: new Date(Date.parse(startedAt) + 50 * 60_000).toISOString(),
        plannedSeconds: 3000,
        activeSeconds: 3000,
      })
      expect(sessionDayKey(startedAt, tz)).toBe('2026-11-10')
      // It ends on the 11th there.
      expect(sessionDayKey(late.endedAt, tz)).toBe('2026-11-11')
      const days = sessionDays([late], KEYS, tz)
      expect(days.map((d) => d.focus)).toEqual([0, 50, 0])
    },
  )

  it('the same instant lands on different days in different zones', () => {
    const at = '2026-11-10T02:00:00.000Z'
    expect(sessionDayKey(at, 'America/New_York')).toBe('2026-11-09')
    expect(sessionDayKey(at, 'UTC')).toBe('2026-11-10')
    expect(sessionDayKey(at, 'Asia/Tokyo')).toBe('2026-11-10')
    const s = [session({ startedAt: at })]
    expect(sessionDays(s, KEYS, 'America/New_York').map((d) => d.focus)).toEqual(
      [25, 0, 0],
    )
    expect(sessionDays(s, KEYS, 'Asia/Tokyo').map((d) => d.focus)).toEqual([
      0, 25, 0,
    ])
  })
})
