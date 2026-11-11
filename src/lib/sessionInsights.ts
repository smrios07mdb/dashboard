/*
 * Tracked-session aggregation for Insights (chunk 98 — ARCHITECTURE.md §12).
 *
 * Pure functions over saved focus and breathing sessions → the four tracked
 * cards and the per-day chart. No I/O, no React; the screen holds no
 * arithmetic. Unlike the headline cards (sums of task *estimates*), every
 * figure here is time the menu bar app actually measured, pauses excluded.
 *
 * A session belongs to the day its `startedAt` falls on in the caller's
 * timezone (`settings.timezone`) — also when it runs past midnight.
 */
import { formatInTimeZone } from 'date-fns-tz'

import type { Category, Subcategory, Task, TrackedSession } from '@/db/types'

/**
 * Which sessions count: `null` is All; otherwise the ids of the live tasks in
 * the chosen category — only focus sessions on one of those tasks count, so
 * bare focus sessions and breathing show under All alone.
 */
export type SessionScope = ReadonlySet<string> | null

export type SessionTotals = {
  /** Sessions in scope — 0 is the empty state. */
  count: number
  focusMinutes: number
  focusSessions: number
  /** Focus sessions that ran to the end (`completed`). */
  focusCompleted: number
  breathingMinutes: number
  breathingSessions: number
  /** The task with the most focus time; `null` when no session had a task. */
  mostFocused: { taskId: string; title: string; minutes: number } | null
}

export type SessionDay = {
  date: string // YYYY-MM-DD
  label: string // e.g. "May 20"
  /** Minutes, the chart's two series. */
  focus: number
  breathing: number
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** "May 20" — the label `lib/insights` gives the estimate chart's days. */
function labelFor(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

const toMinutes = (seconds: number) => Math.round(seconds / 60)

/** Calendar day (YYYY-MM-DD) a session started on in `timezone`. */
export function sessionDayKey(startedAt: string, timezone: string): string {
  return formatInTimeZone(startedAt, timezone, 'yyyy-MM-dd')
}

/**
 * The scope for a category filter: the ids of every live task whose
 * subcategory sits in a category named `name`. Archived subcategories count —
 * their tasks are still that category's tasks.
 */
export function categoryScope(
  name: Category['name'],
  tasks: Task[],
  subcategories: Subcategory[],
  categories: Category[],
): Set<string> {
  const catIds = new Set(
    categories.filter((c) => c.name === name).map((c) => c.id),
  )
  const subIds = new Set(
    subcategories.filter((s) => catIds.has(s.categoryId)).map((s) => s.id),
  )
  return new Set(
    tasks.filter((t) => subIds.has(t.subcategoryId)).map((t) => t.id),
  )
}

/** The sessions a scope keeps. */
export function sessionsInScope(
  sessions: TrackedSession[],
  scope: SessionScope,
): TrackedSession[] {
  if (scope === null) return sessions
  return sessions.filter(
    (s) => s.kind === 'focus' && s.taskId !== null && scope.has(s.taskId),
  )
}

/**
 * The four cards' figures. `liveTitles` maps a live task's id to its current
 * title: "Most focused" shows that, and falls back to the `taskTitle` the
 * session saved (its latest spelling) for a task that no longer exists.
 */
export function sessionTotals(
  sessions: TrackedSession[],
  scope: SessionScope,
  liveTitles: ReadonlyMap<string, string> = new Map(),
): SessionTotals {
  const kept = sessionsInScope(sessions, scope)
  let focusSeconds = 0
  let focusSessions = 0
  let focusCompleted = 0
  let breathingSeconds = 0
  let breathingSessions = 0
  // Per task: focus seconds, and the title of its latest session.
  const perTask = new Map<
    string,
    { seconds: number; title: string | null; at: number }
  >()

  for (const s of kept) {
    if (s.kind === 'meditation') {
      breathingSeconds += s.activeSeconds
      breathingSessions += 1
      continue
    }
    focusSeconds += s.activeSeconds
    focusSessions += 1
    if (s.outcome === 'completed') focusCompleted += 1
    if (s.taskId === null) continue
    const at = Date.parse(s.startedAt)
    const seen = perTask.get(s.taskId)
    if (!seen) {
      perTask.set(s.taskId, { seconds: s.activeSeconds, title: s.taskTitle, at })
    } else {
      seen.seconds += s.activeSeconds
      if (s.taskTitle !== null && (seen.title === null || at >= seen.at)) {
        seen.title = s.taskTitle
        seen.at = at
      }
    }
  }

  let mostFocused: SessionTotals['mostFocused'] = null
  let mostSeconds = -1
  // Ties go to the smaller id, so the card never flips between renders.
  for (const [taskId, t] of [...perTask].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    if (t.seconds > mostSeconds) {
      mostSeconds = t.seconds
      mostFocused = {
        taskId,
        title: liveTitles.get(taskId) ?? t.title ?? 'Untitled task',
        minutes: toMinutes(t.seconds),
      }
    }
  }

  return {
    count: kept.length,
    focusMinutes: toMinutes(focusSeconds),
    focusSessions,
    focusCompleted,
    breathingMinutes: toMinutes(breathingSeconds),
    breathingSessions,
    mostFocused,
  }
}

/**
 * One bucket per day key, oldest first as given: focus and breathing minutes
 * of the sessions that *started* that day in `timezone`. A session outside
 * the keys is left out. Pass the sessions already scoped (`sessionsInScope`).
 */
export function sessionDays(
  sessions: TrackedSession[],
  dayKeys: string[],
  timezone: string,
): SessionDay[] {
  const seconds = new Map<string, { focus: number; breathing: number }>(
    dayKeys.map((k) => [k, { focus: 0, breathing: 0 }]),
  )
  for (const s of sessions) {
    const day = seconds.get(sessionDayKey(s.startedAt, timezone))
    if (!day) continue
    if (s.kind === 'focus') day.focus += s.activeSeconds
    else day.breathing += s.activeSeconds
  }
  return dayKeys.map((date) => {
    const d = seconds.get(date) ?? { focus: 0, breathing: 0 }
    return {
      date,
      label: labelFor(date),
      focus: toMinutes(d.focus),
      breathing: toMinutes(d.breathing),
    }
  })
}
