/*
 * The meditation schedule (chunk 96, D2 and D4). The web view owns this
 * arithmetic: the shell has no time-zone code and receives only due times.
 * Pure.
 *
 * Each due time is built with `new Date(y, m, d, h, min)` in the Mac's local
 * time, so the platform handles DST: 10:30 stays 10:30 on the wall clock on
 * both sides of a change.
 */
import { clockMinutes, type MeditationPrefs } from './meditationPrefs'

/** How far ahead the due list reaches. Every show refills it. */
export const SCHEDULE_DAYS = 14

/**
 * One day's reminders, as minutes after midnight, in order. `every`: at
 * `from`, then every `every` minutes for as long as the time is strictly
 * before `to`. `times`: each listed time. The same on every day; which days
 * is `dueTimes`' business (`prefs.days`, chunk 97).
 */
export function dayTimes(prefs: MeditationPrefs): number[] {
  if (prefs.mode === 'times') {
    return prefs.times.map(clockMinutes).sort((a, b) => a - b)
  }
  const out: number[] = []
  const to = clockMinutes(prefs.to)
  for (let m = clockMinutes(prefs.from); m < to; m += prefs.every) out.push(m)
  return out
}

/**
 * The due times (epoch ms) for the next `days` days from `now`, today
 * included, in order. Times already past are left out; reminders switched
 * off give none, and so does a day whose `getDay()` is not in `prefs.days`.
 */
export function dueTimes(
  prefs: MeditationPrefs,
  now: Date,
  days: number = SCHEDULE_DAYS,
): number[] {
  if (!prefs.enabled) return []
  const minutes = dayTimes(prefs)
  const [y, m, d] = [now.getFullYear(), now.getMonth(), now.getDate()]
  const from = now.getTime()
  const out: number[] = []
  const on = new Set(prefs.days)
  for (let i = 0; i < days; i++) {
    if (!on.has(new Date(y, m, d + i).getDay())) continue
    for (const minute of minutes) {
      const at = new Date(y, m, d + i, Math.floor(minute / 60), minute % 60).getTime()
      if (at > from) out.push(at)
    }
  }
  return out.sort((a, b) => a - b)
}
