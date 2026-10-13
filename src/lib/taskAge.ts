import { dateKeyIn } from '@/lib/clock'

/*
 * How old an open task is (chunk 74). Pure: no React, no storage.
 *
 * Day math runs on calendar days in `timeZone` via `dateKeyIn` — the same
 * frame as `lib/whenLabel.ts` — so a task added late last night is one day
 * old this morning, whatever the hour.
 */

export type TaskAge = { days: number; text: string; long: string }

const LOCALE = 'en-US'
const DAY_MS = 24 * 60 * 60 * 1000
/** Under this the row shows no age. */
const MIN_AGE_DAYS = 28

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole calendar days from createdAt's day to now's day, in timeZone; null if createdAt does not parse. */
export function ageDays(
  createdAt: string,
  timeZone: string,
  now: Date = new Date(),
): number | null {
  const at = new Date(createdAt)
  if (Number.isNaN(at.getTime())) return null
  const from = keyToUtc(dateKeyIn(at, timeZone))
  const to = keyToUtc(dateKeyIn(now, timeZone))
  return Math.round((to - from) / DAY_MS)
}

/** The row's age label, or null under 28 days. */
export function taskAge(
  createdAt: string,
  timeZone: string,
  now: Date = new Date(),
): TaskAge | null {
  const days = ageDays(createdAt, timeZone, now)
  if (days === null || days < MIN_AGE_DAYS) return null

  const years = days >= 365
  const n = years ? Math.floor(days / 365) : Math.floor(days / 7)
  const unit = years ? 'year' : 'week'

  const at = new Date(createdAt)
  const otherYear =
    dateKeyIn(at, timeZone).slice(0, 4) !== dateKeyIn(now, timeZone).slice(0, 4)
  const date = new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    day: 'numeric',
    ...(otherYear ? { year: 'numeric' as const } : {}),
    timeZone,
  }).format(at)

  return {
    days,
    text: `${n}${years ? 'y' : 'w'}`,
    long: `Added ${date} · ${n} ${unit}${n === 1 ? '' : 's'} ago`,
  }
}
