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
    expect(DEFAULT_SOUND).toEqual({ auto: true, preset: 'binaural' })
    expect(readSoundPrefs()).toEqual(DEFAULT_SOUND)
  })

  it('reads a stored choice', () => {
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: false, preset: 'deep' }))
    expect(readSoundPrefs()).toEqual({ auto: false, preset: 'deep' })
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: true, preset: 'silence' }))
    expect(readSoundPrefs()).toEqual({ auto: true, preset: 'silence' })
  })

  it('falls back field by field', () => {
    // A non-boolean `auto` falls back on its own; the preset stays.
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: 'yes', preset: 'classical' }))
    expect(readSoundPrefs()).toEqual({ auto: true, preset: 'classical' })
    // And the other way round.
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: false }))
    expect(readSoundPrefs()).toEqual({ auto: false, preset: 'binaural' })
  })

  it('an unknown preset falls back to the default', () => {
    for (const preset of ['jazz', '', 7, null, 'toString', '__proto__']) {
      localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: false, preset }))
      expect(readSoundPrefs()).toEqual({ auto: false, preset: 'binaural' })
    }
  })

  it('survives malformed storage', () => {
    for (const raw of ['{', 'null', '"x"', '[]', '7']) {
      localStorage.setItem(SOUND_KEY, raw)
      expect(readSoundPrefs()).toEqual(DEFAULT_SOUND)
    }
  })

  it('saves what it reads back', () => {
    saveSoundPrefs({ auto: false, preset: 'silence' })
    expect(JSON.parse(localStorage.getItem(SOUND_KEY)!)).toEqual({
      auto: false,
      preset: 'silence',
    })
    expect(readSoundPrefs()).toEqual({ auto: false, preset: 'silence' })
  })
})
