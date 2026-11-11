/*
 * Sound presets (chunk 95, D10) and the shape of the shell's Spotify state.
 * Pure table. The three playlists are Spotify-owned editorial playlists
 * (ids start `37i9dQZF1`), each confirmed to exist on open.spotify.com on
 * 2026-11-10. Chunk 97's settings let Sergio put his own playlist behind
 * any of the three (`soundPrefs.playlists`); `presetsFor` / `presetFor`
 * resolve what actually plays, and this table stays the built-in fallback.
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

/** The three slots a playlist of his own can replace; Silence is fixed. */
export type PlaylistSlot = Exclude<PresetId, 'silence'>
export const PLAYLIST_SLOTS: readonly PlaylistSlot[] = ['binaural', 'classical', 'deep']

/** His own playlist for a slot (chunk 97, D5). */
export type PlaylistOverride = { label: string; uri: string }
export type PlaylistOverrides = Partial<Record<PlaylistSlot, PlaylistOverride>>

const PLAYLIST_LINK =
  /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]{22})(?:\?[^#\s]*)?$/

/**
 * A playlist URI from what was pasted: a `spotify:playlist:<22>` URI as is,
 * or an `open.spotify.com` playlist link (an optional `/intl-xx/`, any
 * `?si=…`). Anything else — a track, an album, another host — is `null`.
 */
export function normalizePlaylist(input: string): string | null {
  const s = input.trim()
  if (PLAYLIST_URI.test(s)) return s
  const m = PLAYLIST_LINK.exec(s)
  return m ? `spotify:playlist:${m[1]}` : null
}

/** The presets as they play for these prefs: overrides over the table. */
export function presetsFor(prefs: { playlists: PlaylistOverrides }): Preset[] {
  return PRESETS.map((p) => {
    const own = p.id === 'silence' ? undefined : prefs.playlists[p.id]
    return own ? { id: p.id, label: own.label, uri: own.uri } : { ...p }
  })
}

/** One preset as it plays; an unknown id is the default slot. */
export function presetFor(
  prefs: { playlists: PlaylistOverrides },
  id: string,
): Preset {
  const list = presetsFor(prefs)
  return list.find((p) => p.id === id) ?? list.find((p) => p.id === DEFAULT_PRESET)!
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
