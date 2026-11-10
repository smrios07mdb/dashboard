import { describe, expect, it } from 'vitest'

import { PLAYLIST_URI, PRESETS, presetById } from './sound'

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
})
