/*
 * Pomodoro settings (chunk 94, D7): per Mac, in the web view's
 * `localStorage['hup:mb:pomodoro']` over the defaults. Pure and guarded like
 * `prefs.ts`; an invalid field falls back on its own. The ranges are the
 * shell's (`Config::validated` in `pomodoro.rs`), which rejects anything
 * else. There is no settings UI yet — chunk 97 edits this key.
 *
 * Settings only: a running session's state is never stored here. Rust is the
 * only truth for that.
 */

export const POMODORO_KEY = 'hup:mb:pomodoro'

export type PomodoroConfig = {
  /** Minutes of focus. */
  focus: number
  /** Minutes of short break. */
  short: number
  /** Minutes of long break. */
  long: number
  /** A long break after every this-many focus sessions. */
  every: number
  /** Tray text in whole minutes (`17m`) instead of `16:48`. */
  compact: boolean
}

export const DEFAULT_POMODORO: PomodoroConfig = {
  focus: 25,
  short: 5,
  long: 15,
  every: 4,
  compact: false,
}

const RANGE = {
  focus: [1, 180],
  short: [1, 60],
  long: [1, 90],
  every: [1, 12],
} as const

const NUMBERS = Object.keys(RANGE) as Array<keyof typeof RANGE>

export function readPomodoroPrefs(): PomodoroConfig {
  const config = { ...DEFAULT_POMODORO }
  try {
    const raw = localStorage.getItem(POMODORO_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (stored && typeof stored === 'object') {
      const o = stored as Record<string, unknown>
      for (const key of NUMBERS) {
        const v = o[key]
        const [min, max] = RANGE[key]
        if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) {
          config[key] = v
        }
      }
      if (typeof o.compact === 'boolean') config.compact = o.compact
    }
  } catch {
    // Unreadable or malformed: the defaults stand.
  }
  return config
}

export function savePomodoroPrefs(config: PomodoroConfig): void {
  try {
    localStorage.setItem(POMODORO_KEY, JSON.stringify(config))
  } catch {
    // Storage unavailable: the settings hold until restart.
  }
}
