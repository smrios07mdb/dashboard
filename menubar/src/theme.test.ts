import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyTheme,
  nextTheme,
  readTheme,
  resolveMode,
  saveTheme,
  THEME_KEY,
  watchSystemTheme,
} from './theme'

function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>()
  const mq = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => mq)
  return {
    set(next: boolean) {
      mq.matches = next
      listeners.forEach((fn) => fn())
    },
    listeners,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.mode
})

describe('theme choice', () => {
  it('cycles auto → light → dark → auto', () => {
    expect(nextTheme('auto')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('auto')
  })

  it('auto follows the system; light and dark override it', () => {
    expect(resolveMode('auto', true)).toBe('dark')
    expect(resolveMode('auto', false)).toBe('light')
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
  })

  it('round-trips through storage; auto clears the key', () => {
    expect(readTheme()).toBe('auto')
    saveTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(readTheme()).toBe('dark')
    saveTheme('auto')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(readTheme()).toBe('auto')
  })

  it('reads an unknown stored value as auto', () => {
    localStorage.setItem(THEME_KEY, 'sepia')
    expect(readTheme()).toBe('auto')
  })
})

describe('applying the theme', () => {
  it('writes the resolved mode to <html data-mode>', () => {
    stubSystem(true)
    applyTheme('light')
    expect(document.documentElement.dataset.mode).toBe('light')
    applyTheme('auto')
    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('on auto, follows a macOS appearance change until unsubscribed', () => {
    const sys = stubSystem(false)
    const stop = watchSystemTheme('auto')
    expect(document.documentElement.dataset.mode).toBe('light')
    sys.set(true)
    expect(document.documentElement.dataset.mode).toBe('dark')
    stop()
    expect(sys.listeners.size).toBe(0)
  })

  it('on a fixed choice, ignores macOS appearance changes', () => {
    const sys = stubSystem(false)
    watchSystemTheme('dark')
    expect(sys.listeners.size).toBe(0)
    sys.set(false)
    expect(document.documentElement.dataset.mode).toBe('dark')
  })
})
