/*
 * Site blocking on this Mac (chunk 99, D18): `localStorage['hup:mb:blocker']`
 * over `{ enabled: true }`. Pure and guarded like the other prefs; an invalid
 * value falls back to the default.
 */

export const BLOCKER_KEY = 'hup:mb:blocker'

export type BlockerPrefs = { enabled: boolean }

export const DEFAULT_BLOCKER: BlockerPrefs = { enabled: true }

export function readBlockerPrefs(): BlockerPrefs {
  try {
    const raw = localStorage.getItem(BLOCKER_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (
      stored &&
      typeof stored === 'object' &&
      typeof (stored as Record<string, unknown>).enabled === 'boolean'
    ) {
      return { enabled: (stored as { enabled: boolean }).enabled }
    }
  } catch {
    // Unreadable or malformed: the default stands.
  }
  return { ...DEFAULT_BLOCKER }
}

export function saveBlockerPrefs(prefs: BlockerPrefs): void {
  try {
    localStorage.setItem(BLOCKER_KEY, JSON.stringify({ enabled: prefs.enabled }))
  } catch {
    // Storage unavailable: the switch holds until restart.
  }
}
