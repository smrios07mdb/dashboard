import { describe, expect, it } from 'vitest'

import {
  normalizePlaylist,
  PLAYLIST_URI,
  presetById,
  presetFor,
  PRESETS,
  presetsFor,
} from './sound'
import { DEFAULT_SOUND } from './soundPrefs'

describe('sound presets', () => {
  it('has the four presets, in the design order', () => {
    expect(PRESETS.map((p) => [p.id, p.label])).toEqual([
      ['binaural', 'Binaural'],
      ['classical', 'Classical'],
      ['deep', 'Deep work'],
      ['silence', 'Silence'],
    ])
  })

  it('Silence has no playlist', () => {
    expect(presetById('silence').uri).toBeNull()
  })

  it('every playlist URI is a Spotify editorial playlist the shell accepts', () => {
    const playlists = PRESETS.filter((p) => p.id !== 'silence')
    expect(playlists).toHaveLength(3)
    for (const p of playlists) {
      // The shell's own pattern (`valid_uri` in sound.rs).
      expect(p.uri).toMatch(/^spotify:playlist:[A-Za-z0-9]{22}$/)
      expect(p.uri).toMatch(PLAYLIST_URI)
      expect(p.uri).toMatch(/^spotify:playlist:37i9dQZF1/)
    }
    expect(new Set(playlists.map((p) => p.uri)).size).toBe(3)
  })

  it('an unknown id is the default preset', () => {
    expect(presetById('nope').id).toBe('binaural')
  })

  // Chunk 97, D5.
  const ID = '37i9dQZF1DWZeKCadgRdKQ'
  const URI = `spotify:playlist:${ID}`

  it('normalizePlaylist accepts a URI and an open.spotify.com playlist link', () => {
    expect(normalizePlaylist(URI)).toBe(URI)
    expect(normalizePlaylist(`  ${URI} `)).toBe(URI)
    expect(normalizePlaylist(`https://open.spotify.com/playlist/${ID}`)).toBe(URI)
    expect(normalizePlaylist(`https://open.spotify.com/playlist/${ID}?si=x`)).toBe(URI)
    expect(normalizePlaylist(`https://open.spotify.com/playlist/${ID}?si=a1b2c3&pt=9`)).toBe(URI)
    expect(normalizePlaylist(`https://open.spotify.com/intl-de/playlist/${ID}`)).toBe(URI)
    expect(normalizePlaylist(`https://open.spotify.com/intl-de/playlist/${ID}?si=x`)).toBe(URI)
  })

  it('normalizePlaylist refuses anything else', () => {
    for (const s of [
      '',
      'Mine',
      `https://open.spotify.com/track/${ID}`,
      `https://open.spotify.com/track/${ID}?si=x`,
      `https://open.spotify.com/album/${ID}`,
      `spotify:track:${ID}`,
      `spotify:album:${ID}`,
      `http://open.spotify.com/playlist/${ID}`,
      `https://example.com/playlist/${ID}`,
      `https://open.spotify.com.evil.io/playlist/${ID}`,
      `https://open.spotify.com/playlist/${ID}x`,
      `https://open.spotify.com/playlist/${ID.slice(1)}`,
      `https://open.spotify.com/intl-de/x/playlist/${ID}`,
      `https://open.spotify.com/playlist/${ID}/extra`,
    ]) {
      expect(normalizePlaylist(s), s).toBeNull()
    }
  })

  it('presetsFor: built-ins without overrides', () => {
    expect(presetsFor(DEFAULT_SOUND)).toEqual(PRESETS)
  })

  it('presetsFor / presetFor: an override replaces label and URI of its slot', () => {
    const prefs = {
      ...DEFAULT_SOUND,
      playlists: { binaural: { label: 'Mine', uri: URI } },
    }
    const list = presetsFor(prefs)
    expect(list.map((p) => [p.id, p.label, p.uri])).toEqual([
      ['binaural', 'Mine', URI],
      ['classical', 'Classical', 'spotify:playlist:37i9dQZF1DXd5zUwdn6lPb'],
      ['deep', 'Deep work', 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ'],
      ['silence', 'Silence', null],
    ])
    expect(presetFor(prefs, 'binaural')).toEqual({ id: 'binaural', label: 'Mine', uri: URI })
    expect(presetFor(prefs, 'classical')).toEqual(presetById('classical'))
    expect(presetFor(prefs, 'silence').uri).toBeNull()
    // An unknown id is the default slot, with its override.
    expect(presetFor(prefs, 'nope').label).toBe('Mine')
    // The built-in table is untouched.
    expect(presetById('binaural').label).toBe('Binaural')
  })
})
