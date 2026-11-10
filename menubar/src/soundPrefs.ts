/*
 * Sound settings (chunk 95, D11): per Mac, in the web view's
 * `localStorage['hup:mb:sound']` over the defaults. Pure and guarded like
 * `pomodoroPrefs.ts`; an invalid field falls back on its own. Sent to the
 * shell with `sound_configure` at sign-in and whenever it changes.
 */
import { DEFAULT_PRESET, isPresetId, type PresetId } from './sound'

export const SOUND_KEY = 'hup:mb:sound'

export type SoundPrefs = {
  /** Play on focus, pause on break. */
  auto: boolean
  preset: PresetId
}

export const DEFAULT_SOUND: SoundPrefs = { auto: true, preset: DEFAULT_PRESET }

export function readSoundPrefs(): SoundPrefs {
  const prefs = { ...DEFAULT_SOUND }
  try {
    const raw = localStorage.getItem(SOUND_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (stored && typeof stored === 'object') {
      const o = stored as Record<string, unknown>
      if (typeof o.auto === 'boolean') prefs.auto = o.auto
      if (isPresetId(o.preset)) prefs.preset = o.preset
    }
  } catch {
    // Unreadable or malformed: the defaults stand.
  }
  return prefs
}

export function saveSoundPrefs(prefs: SoundPrefs): void {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: the choice holds until restart.
  }
}
