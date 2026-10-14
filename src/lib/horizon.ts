import type { Task } from '@/db/types'
import { dateKeyIn } from '@/lib/clock'

/*
 * Near term / long term (chunk 76). Pure: no React, no storage beyond the
 * preference helpers at the bottom.
 *
 * The horizon is derived, never stored: a task is near when its priority
 * (P1 Urgent, P2 Soon) or its dates say so; everything else is long. Day
 * math runs on calendar days in `timeZone` via `dateKeyIn`, the same frame
 * as `lib/taskAge.ts` and `lib/whenLabel.ts`.
 *
 * One global preference applies to every list (Dashboard columns and both
 * drill-downs), persisted under `hupo.taskHorizon`, like `hupo.taskSort`.
 */

export type Horizon = 'near' | 'long'
export type HorizonFilter = 'near' | 'long' | 'all'

/** A due date or reminder this many calendar days out, or less, is near term. */
export const NEAR_TERM_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole calendar days from now's day to iso's day in timeZone; null if iso does not parse. */
export function daysFromNow(
  iso: string,
  timeZone: string,
  now: Date = new Date(),
): number | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const from = keyToUtc(dateKeyIn(now, timeZone))
  const to = keyToUtc(dateKeyIn(at, timeZone))
  return Math.round((to - from) / DAY_MS)
}

function within(iso: string | null, timeZone: string, now: Date): boolean {
  if (!iso) return false
  const days = daysFromNow(iso, timeZone, now)
  return days !== null && days <= NEAR_TERM_DAYS
}

/** Near when P1/P2, or when due or reminder is within NEAR_TERM_DAYS (past days count). Otherwise long. */
export function taskHorizon(
  task: Task,
  timeZone: string,
  now: Date = new Date(),
): Horizon {
  if (task.priority === 1 || task.priority === 2) return 'near'
  if (within(task.dueAt, timeZone, now)) return 'near'
  if (within(task.remindAt, timeZone, now)) return 'near'
  return 'long'
}

/** Identity for 'all'; otherwise the open rows whose horizon matches. */
export function filterByHorizon<T extends Task>(
  tasks: T[],
  filter: HorizonFilter,
  timeZone: string,
  now: Date = new Date(),
): T[] {
  if (filter === 'all') return tasks
  return tasks.filter((t) => taskHorizon(t, timeZone, now) === filter)
}

export const HORIZON_STORAGE_KEY = 'hupo.taskHorizon'

export const DEFAULT_HORIZON: HorizonFilter = 'all'

export const HORIZON_OPTIONS: { value: HorizonFilter; label: string }[] = [
  { value: 'near', label: 'Near' },
  { value: 'long', label: 'Long' },
  { value: 'all', label: 'All' },
]

function isHorizonFilter(v: unknown): v is HorizonFilter {
  return v === 'near' || v === 'long' || v === 'all'
}

/** Read the persisted preference; falls back to 'all'. */
export function loadHorizonFilter(): HorizonFilter {
  try {
    const raw = localStorage.getItem(HORIZON_STORAGE_KEY)
    return isHorizonFilter(raw) ? raw : DEFAULT_HORIZON
  } catch {
    return DEFAULT_HORIZON
  }
}

export function storeHorizonFilter(f: HorizonFilter): void {
  try {
    localStorage.setItem(HORIZON_STORAGE_KEY, f)
  } catch {
    // Private-mode / quota failures just lose persistence, not filtering.
  }
}
