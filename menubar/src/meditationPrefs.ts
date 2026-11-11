/*
 * Meditation settings (chunk 96, D3): per Mac, in the web view's
 * `localStorage['hup:mb:meditation']` over the defaults. Pure and guarded
 * like `soundPrefs.ts`; an invalid field falls back on its own. Edited by
 * the Settings view (chunk 97), which also added `days`.
 */

export const MEDITATION_KEY = 'hup:mb:meditation'

export type MeditationLength = 3 | 5 | 10
export type MeditationMode = 'every' | 'times'

export type MeditationPrefs = {
  enabled: boolean
  /** Session length in minutes. */
  length: MeditationLength
  /** `every`: from `from`, every `every` minutes, before `to`. `times`: the list. */
  mode: MeditationMode
  /** Minutes between reminders, 15–240. */
  every: number
  /** `HH:MM`, before `to`. */
  from: string
  to: string
  /** 1–12 `HH:MM` times, sorted, no duplicates. */
  times: string[]
  /** Minutes of warning before a reminder, 0–30; 0 is none. */
  headsUp: number
  pauseSpotify: boolean
  /**
   * Days of the week reminders fall on, as `getDay()` (0 = Sunday … 6 =
   * Saturday): 1–7 distinct, sorted (chunk 97, D7).
   */
  days: number[]
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

export const DEFAULT_MEDITATION: MeditationPrefs = {
  enabled: true,
  length: 5,
  mode: 'every',
  every: 90,
  from: '09:00',
  to: '18:00',
  times: ['10:30', '13:00', '15:30'],
  headsUp: 5,
  pauseSpotify: true,
  days: [...ALL_DAYS],
}

/** 1–7 distinct integers 0–6, sorted; `null` when not. */
export function validDays(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 7) return null
  if (!v.every((d) => intIn(d, 0, 6))) return null
  if (new Set(v).size !== v.length) return null
  return [...(v as number[])].sort((a, b) => a - b)
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_TIMES = 12

export function isClockTime(v: unknown): v is string {
  return typeof v === 'string' && CLOCK.test(v)
}

/** `HH:MM` → minutes after midnight. */
export function clockMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

export function readMeditationPrefs(): MeditationPrefs {
  const prefs: MeditationPrefs = {
    ...DEFAULT_MEDITATION,
    times: [...DEFAULT_MEDITATION.times],
    days: [...DEFAULT_MEDITATION.days],
  }
  try {
    const raw = localStorage.getItem(MEDITATION_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return prefs
    }
    const o = stored as Record<string, unknown>
    if (typeof o.enabled === 'boolean') prefs.enabled = o.enabled
    if (o.length === 3 || o.length === 5 || o.length === 10) prefs.length = o.length
    if (o.mode === 'every' || o.mode === 'times') prefs.mode = o.mode
    if (intIn(o.every, 15, 240)) prefs.every = o.every
    if (isClockTime(o.from)) prefs.from = o.from
    if (isClockTime(o.to)) prefs.to = o.to
    // The pair has to make a window; if it does not, neither bound is kept.
    if (clockMinutes(prefs.from) >= clockMinutes(prefs.to)) {
      prefs.from = DEFAULT_MEDITATION.from
      prefs.to = DEFAULT_MEDITATION.to
    }
    if (Array.isArray(o.times)) {
      const times = [...new Set(o.times.filter(isClockTime))].sort()
      if (times.length >= 1 && times.length <= MAX_TIMES) prefs.times = times
    }
    if (intIn(o.headsUp, 0, 30)) prefs.headsUp = o.headsUp
    if (typeof o.pauseSpotify === 'boolean') prefs.pauseSpotify = o.pauseSpotify
    const days = validDays(o.days)
    if (days) prefs.days = days
  } catch {
    // Unreadable or malformed: the defaults stand.
  }
  return prefs
}

export function saveMeditationPrefs(prefs: MeditationPrefs): void {
  try {
    localStorage.setItem(MEDITATION_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: the settings hold until restart.
  }
}
