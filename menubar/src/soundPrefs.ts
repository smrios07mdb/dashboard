/*
 * Sound settings (chunk 95, D11): per Mac, in the web view's
 * `localStorage['hup:mb:sound']` over the defaults. Pure and guarded like
 * `pomodoroPrefs.ts`; an invalid field falls back on its own. Sent to the
 * shell with `sound_configure` at sign-in and whenever it changes.
 *
 * `playlists` (chunk 97, D5): his own playlist behind a slot. An invalid
 * slot is dropped on its own, so that slot plays the built-in preset.
 */
import {
  DEFAULT_PRESET,
  isPresetId,
  PLAYLIST_SLOTS,
  PLAYLIST_URI,
  type PlaylistOverride,
  type PlaylistOverrides,
  type PresetId,
} from './sound'

export const SOUND_KEY = 'hup:mb:sound'

export type SoundPrefs = {
  /** Play on focus, pause on break. */
  auto: boolean
  preset: PresetId
  playlists: PlaylistOverrides
}

export const DEFAULT_SOUND: SoundPrefs = {
  auto: true,
  preset: DEFAULT_PRESET,
  playlists: {},
}

export const LABEL_MAX = 20

/** A label for a slot: trimmed, 1–20 characters; `null` when not. */
export function validLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= 1 && t.length <= LABEL_MAX ? t : null
}

function readOverride(v: unknown): PlaylistOverride | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const label = validLabel(o.label)
  if (!label || typeof o.uri !== 'string' || !PLAYLIST_URI.test(o.uri)) return null
  return { label, uri: o.uri }
}

export function readSoundPrefs(): SoundPrefs {
  const prefs: SoundPrefs = { ...DEFAULT_SOUND, playlists: {} }
  try {
    const raw = localStorage.getItem(SOUND_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (stored && typeof stored === 'object') {
      const o = stored as Record<string, unknown>
      if (typeof o.auto === 'boolean') prefs.auto = o.auto
      if (isPresetId(o.preset)) prefs.preset = o.preset
      const lists = o.playlists
      if (lists && typeof lists === 'object' && !Array.isArray(lists)) {
        for (const slot of PLAYLIST_SLOTS) {
          const own = readOverride((lists as Record<string, unknown>)[slot])
          if (own) prefs.playlists[slot] = own
        }
      }
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
