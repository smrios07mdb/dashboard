import { beforeEach, describe, expect, it } from 'vitest'

import { BLOCKER_KEY, readBlockerPrefs, saveBlockerPrefs } from './blockerPrefs'

describe('blocker prefs (chunk 99, D18)', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to on', () => {
    expect(BLOCKER_KEY).toBe('hup:mb:blocker')
    expect(readBlockerPrefs()).toEqual({ enabled: true })
  })

  it('round-trips', () => {
    saveBlockerPrefs({ enabled: false })
    expect(localStorage.getItem(BLOCKER_KEY)).toBe('{"enabled":false}')
    expect(readBlockerPrefs()).toEqual({ enabled: false })
  })

  it('a malformed value falls back to the default', () => {
    for (const bad of ['not json', '{"enabled":"no"}', 'null', '[]']) {
      localStorage.setItem(BLOCKER_KEY, bad)
      expect(readBlockerPrefs()).toEqual({ enabled: true })
    }
  })
})
