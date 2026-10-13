import { dateKeyIn } from '@/lib/clock'

/*
 * The task row's "when" chip text (chunk 71). Pure: no React, no storage.
 *
 * Day math runs on calendar days in `timeZone` via `dateKeyIn` — the same
 * frame as `lib/today.ts` — so a due date reads `Today` on the same day the
 * Today panel pulls it in. `n` is the whole number of days from today's key
 * to the target's key.
 *
 * A due date is a calendar day; its time of day never matters. A reminder is
 * an instant: once it has passed it is `Overdue`, even on the same day.
 */

export type WhenTone = 'late' | 'today' | 'soon' | 'later'
export type WhenLabel = { text: string; tone: WhenTone; long: string }

const LOCALE = 'en-US'
const DAY_MS = 24 * 60 * 60 * 1000

function keyToUtc(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`)
}

function fmt(
  at: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  // Newer ICU puts U+202F before AM/PM; a plain space keeps labels stable.
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone })
    .format(at)
    .replace(/\u202f/g, ' ')
}

type Frame = { at: Date; n: number; otherYear: boolean }

function frame(iso: string, timeZone: string, now: Date): Frame {
  const at = new Date(iso)
  const todayKey = dateKeyIn(now, timeZone)
  const targetKey = dateKeyIn(at, timeZone)
  return {
    at,
    n: Math.round((keyToUtc(targetKey) - keyToUtc(todayKey)) / DAY_MS),
    otherYear: targetKey.slice(0, 4) !== todayKey.slice(0, 4),
  }
}

/** `Today` / `Tomorrow` / weekday (2–6) / `Oct 24` (≥ 7, or any past day). */
function dayText({ at, n, otherYear }: Frame, timeZone: string): string {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n >= 2 && n <= 6) return fmt(at, timeZone, { weekday: 'short' })
  return fmt(at, timeZone, {
    month: 'short',
    day: 'numeric',
    ...(otherYear ? { year: 'numeric' as const } : {}),
  })
}

function longDate({ at, otherYear }: Frame, timeZone: string): string {
  return fmt(at, timeZone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(otherYear ? { year: 'numeric' as const } : {}),
  })
}

function timeText(at: Date, timeZone: string): string {
  return fmt(at, timeZone, { hour: 'numeric', minute: '2-digit' })
}

function toneFor(n: number): WhenTone {
  if (n < 0) return 'late'
  if (n === 0) return 'today'
  return n <= 6 ? 'soon' : 'later'
}

export function dueLabel(
  dueAt: string,
  timeZone: string,
  now: Date = new Date(),
): WhenLabel {
  const f = frame(dueAt, timeZone, now)
  return {
    text: f.n < 0 ? `${-f.n}d late` : dayText(f, timeZone),
    tone: toneFor(f.n),
    long: longDate(f, timeZone),
  }
}

export function reminderLabel(
  remindAt: string,
  timeZone: string,
  now: Date = new Date(),
): WhenLabel {
  const f = frame(remindAt, timeZone, now)
  const time = timeText(f.at, timeZone)
  const long = `${longDate(f, timeZone)}, ${time}`
  if (f.at.getTime() <= now.getTime()) {
    return { text: 'Overdue', tone: 'late', long }
  }
  return { text: `${dayText(f, timeZone)} ${time}`, tone: toneFor(f.n), long }
}
