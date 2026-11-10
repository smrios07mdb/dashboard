/*
 * Sound presets (chunk 95, D10) and the shape of the shell's Spotify state.
 * Pure table. The three playlists are Spotify-owned editorial playlists
 * (ids start `37i9dQZF1`), each confirmed to exist on open.spotify.com on
 * 2026-11-10; chunk 97's settings let Sergio swap in his own.
 */

export type PresetId = 'binaural' | 'classical' | 'deep' | 'silence'

export type Preset = {
  id: PresetId
  label: string
  /** `spotify:playlist:<22 chars>`, or `null` for Silence (timer only). */
  uri: string | null
}

/** The shell's own pattern (`valid_uri` in `sound.rs`): nothing else plays. */
export const PLAYLIST_URI = /^spotify:playlist:[A-Za-z0-9]{22}$/

export const PRESETS: readonly Preset[] = [
  // "Binaural Beats: Focus"
  { id: 'binaural', label: 'Binaural', uri: 'spotify:playlist:37i9dQZF1DX7EF8wVxBVhG' },
  // "Classical Focus"
  { id: 'classical', label: 'Classical', uri: 'spotify:playlist:37i9dQZF1DXd5zUwdn6lPb' },
  // "Deep Focus"
  { id: 'deep', label: 'Deep work', uri: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' },
  { id: 'silence', label: 'Silence', uri: null },
]

export const DEFAULT_PRESET: PresetId = 'binaural'

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && PRESETS.some((p) => p.id === v)
}

/** The preset with this id; an unknown id is the default one. */
export function presetById(id: string): Preset {
  return (
    PRESETS.find((p) => p.id === id) ??
    PRESETS.find((p) => p.id === DEFAULT_PRESET)!
  )
}

export type SpotifyStatus =
  | 'ok'
  | 'not_installed'
  | 'not_running'
  | 'denied'
  | 'timeout'
  | 'error'

/** What `spotify_state` and every Spotify write answer (`Spotify::json`). */
export type SpotifyState = {
  status: SpotifyStatus
  playing: boolean
  track: string | null
  artist: string | null
}
