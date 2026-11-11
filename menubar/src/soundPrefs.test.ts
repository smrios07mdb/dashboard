import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SOUND,
  readSoundPrefs,
  saveSoundPrefs,
  SOUND_KEY,
} from './soundPrefs'

describe('sound prefs', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to play on focus with Binaural', () => {
    expect(SOUND_KEY).toBe('hup:mb:sound')
    expect(DEFAULT_SOUND).toEqual({ auto: true, preset: 'binaural', playlists: {} })
    expect(readSoundPrefs()).toEqual(DEFAULT_SOUND)
  })

  it('reads a stored choice', () => {
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: false, preset: 'deep' }))
    expect(readSoundPrefs()).toEqual({ auto: false, preset: 'deep', playlists: {} })
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: true, preset: 'silence' }))
    expect(readSoundPrefs()).toEqual({ auto: true, preset: 'silence', playlists: {} })
  })

  it('falls back field by field', () => {
    // A non-boolean `auto` falls back on its own; the preset stays.
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: 'yes', preset: 'classical' }))
    expect(readSoundPrefs()).toEqual({ auto: true, preset: 'classical', playlists: {} })
    // And the other way round.
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: false }))
    expect(readSoundPrefs()).toEqual({ auto: false, preset: 'binaural', playlists: {} })
  })

  it('an unknown preset falls back to the default', () => {
    for (const preset of ['jazz', '', 7, null, 'toString', '__proto__']) {
      localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: false, preset }))
      expect(readSoundPrefs()).toEqual({ auto: false, preset: 'binaural', playlists: {} })
    }
  })

  it('survives malformed storage', () => {
    for (const raw of ['{', 'null', '"x"', '[]', '7']) {
      localStorage.setItem(SOUND_KEY, raw)
      expect(readSoundPrefs()).toEqual(DEFAULT_SOUND)
    }
  })

  it('saves what it reads back', () => {
    saveSoundPrefs({ auto: false, preset: 'silence', playlists: {} })
    expect(JSON.parse(localStorage.getItem(SOUND_KEY)!)).toEqual({
      auto: false,
      preset: 'silence',
      playlists: {},
    })
    expect(readSoundPrefs()).toEqual({ auto: false, preset: 'silence', playlists: {} })
  })

  // Chunk 97, D5: his own playlists behind the three presets.
  const MINE = { label: 'Mine', uri: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' }

  it('playlists: none stored is none', () => {
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: true, preset: 'deep' }))
    expect(readSoundPrefs().playlists).toEqual({})
  })

  it('playlists: a valid override is kept, trimmed', () => {
    localStorage.setItem(
      SOUND_KEY,
      JSON.stringify({
        auto: true,
        preset: 'binaural',
        playlists: { binaural: { ...MINE, label: '  Mine  ' }, deep: MINE },
      }),
    )
    expect(readSoundPrefs().playlists).toEqual({ binaural: MINE, deep: MINE })
  })

  it('playlists: an invalid label or URI drops that slot only', () => {
    const bad = [
      { label: '', uri: MINE.uri },
      { label: '   ', uri: MINE.uri },
      { label: 'x'.repeat(21), uri: MINE.uri },
      { label: 7, uri: MINE.uri },
      { label: 'Mine', uri: 'spotify:track:37i9dQZF1DWZeKCadgRdKQ' },
      { label: 'Mine', uri: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ' },
      { label: 'Mine', uri: 'spotify:playlist:short' },
      { label: 'Mine' },
      'Mine',
      null,
    ]
    for (const slot of bad) {
      localStorage.setItem(
        SOUND_KEY,
        JSON.stringify({ preset: 'binaural', playlists: { binaural: slot, classical: MINE } }),
      )
      expect(readSoundPrefs().playlists).toEqual({ classical: MINE })
    }
    // Silence has no slot, and junk keys are ignored.
    localStorage.setItem(
      SOUND_KEY,
      JSON.stringify({ playlists: { silence: MINE, jazz: MINE } }),
    )
    expect(readSoundPrefs().playlists).toEqual({})
    // A 20-character label is the longest kept.
    const twenty = { label: 'x'.repeat(20), uri: MINE.uri }
    localStorage.setItem(SOUND_KEY, JSON.stringify({ playlists: { deep: twenty } }))
    expect(readSoundPrefs().playlists).toEqual({ deep: twenty })
    for (const raw of [[], 'x', 3]) {
      localStorage.setItem(SOUND_KEY, JSON.stringify({ playlists: raw }))
      expect(readSoundPrefs().playlists).toEqual({})
    }
  })
})
