import { beforeEach, describe, expect, it, vi } from 'vitest'

import css from '../index.css?raw'

import {
  clampMargins,
  defaultMargins,
  MARGIN_LIMITS,
  MARGINS_MIN_VIEWPORT,
  maxSideFor,
  useShellMarginsStore,
} from './shellMargins'

describe('shellMargins store', () => {
  beforeEach(() => {
    localStorage.clear()
    useShellMarginsStore.setState({ margins: null, draft: null })
  })

  it('starts editing from the responsive defaults when nothing is saved', () => {
    useShellMarginsStore.getState().startEditing()
    expect(useShellMarginsStore.getState().draft).toEqual(
      defaultMargins(window.innerWidth),
    )
  })

  it('setDraft clamps and only applies while editing', () => {
    useShellMarginsStore.getState().setDraft({ side: 999 })
    expect(useShellMarginsStore.getState().draft).toBeNull()

    useShellMarginsStore.getState().startEditing()
    useShellMarginsStore.getState().setDraft({ side: -20, top: 9999 })
    const d = useShellMarginsStore.getState().draft!
    expect(d.side).toBe(0)
    expect(d.top).toBe(240)
  })

  it('save persists to localStorage and clears the draft; cancel discards', () => {
    useShellMarginsStore.getState().startEditing()
    useShellMarginsStore.getState().setDraft({ side: 12, top: 8, bottom: 10 })
    useShellMarginsStore.getState().save()
    expect(useShellMarginsStore.getState().draft).toBeNull()
    expect(useShellMarginsStore.getState().margins).toEqual({
      side: 12,
      top: 8,
      bottom: 10,
    })
    expect(JSON.parse(localStorage.getItem('hup:shellMargins')!)).toEqual({
      side: 12,
      top: 8,
      bottom: 10,
    })

    useShellMarginsStore.getState().startEditing()
    useShellMarginsStore.getState().setDraft({ side: 50 })
    useShellMarginsStore.getState().cancel()
    expect(useShellMarginsStore.getState().margins?.side).toBe(12)
    expect(useShellMarginsStore.getState().draft).toBeNull()
  })

  it('saving the responsive defaults (Reset → Save) clears the stored preference', () => {
    useShellMarginsStore.getState().startEditing()
    useShellMarginsStore.getState().setDraft({ side: 5 })
    useShellMarginsStore.getState().save()
    expect(localStorage.getItem('hup:shellMargins')).not.toBeNull()

    useShellMarginsStore.getState().startEditing()
    useShellMarginsStore.getState().resetDraft()
    useShellMarginsStore.getState().save()
    expect(useShellMarginsStore.getState().margins).toBeNull()
    expect(localStorage.getItem('hup:shellMargins')).toBeNull()
  })

  // Chunk 69 (UX audit #1): the floor is what two columns need, and a window
  // too narrow for it falls back to its default side instead of to zero.
  it('clampMargins keeps the minimum content width between the sides', () => {
    expect(MARGIN_LIMITS.minContentWidth).toBe(900)
    const m = { side: 250, top: 0, bottom: 0 }
    expect(clampMargins(m, 1728).side).toBe(250)
    expect(clampMargins(m, 1224).side).toBe(162)
    expect(clampMargins(m, 900).side).toBe(28)
    expect(clampMargins(m, 600).side).toBe(16)
    // Below the cap the value is untouched, including under the default.
    expect(clampMargins({ ...m, side: 0 }, 1224).side).toBe(0)
    expect(maxSideFor(1224)).toBe(162)
  })

  it('a saved side survives a narrow load and the draft starts from what is on screen', async () => {
    localStorage.setItem(
      'hup:shellMargins',
      JSON.stringify({ side: 250, top: 300, bottom: 10 }),
    )
    vi.resetModules()
    const fresh = await import('./shellMargins')
    const store = fresh.useShellMarginsStore
    // Stored side kept (the shell CSS narrows it live); top still sanitised.
    expect(store.getState().margins).toEqual({ side: 250, top: 240, bottom: 10 })

    store.getState().startEditing()
    expect(store.getState().draft?.side).toBe(
      fresh.maxSideFor(window.innerWidth),
    )
    expect(store.getState().draft!.side).toBeLessThan(250)
  })
})

/*
 * jsdom applies neither media nor container queries, so these pin the CSS text
 * that carries the chunk-69 behaviour to the constants the store clamps with.
 */
describe('shell margin CSS (chunk 69)', () => {
  it('caps the saved side with the same floor the store uses', () => {
    expect(css).toContain(
      `calc((100vw - ${MARGIN_LIMITS.minContentWidth}px) / 2)`,
    )
    expect(css).toMatch(
      /--shell-side:\s*min\(\s*var\(--shell-side-saved, var\(--shell-side-default\)\),\s*max\(var\(--shell-side-default\),/,
    )
  })

  it('reads the saved margins only from sm up', () => {
    const base = css.slice(css.indexOf('.shell {'))
    const firstRule = base.slice(0, base.indexOf('}'))
    expect(firstRule).not.toContain('-saved')
    const sm = base.slice(
      base.indexOf(`@media (min-width: ${MARGINS_MIN_VIEWPORT}px)`),
    )
    const smRule = sm.slice(0, sm.indexOf('@media (min-width: 1024px)'))
    expect(smRule).toContain('--shell-top: var(--shell-top-saved,')
    expect(smRule).toContain('--shell-bottom: var(--shell-bottom-saved,')
  })

  it('switches the category grid to two columns on its container, not the viewport', () => {
    expect(css).toMatch(
      /\.category-cols \{\s*container-type: inline-size;\s*container-name: category-cols;/,
    )
    // Default first, then the container rule: same specificity, so order
    // decides.
    const base = css.indexOf(
      '.category-grid {\n    grid-template-columns: minmax(0, 1fr);',
    )
    expect(base).toBeGreaterThan(-1)
    expect(css.indexOf('@container category-cols')).toBeGreaterThan(base)
    expect(css).toMatch(
      /@container category-cols \(min-width: 48rem\) \{\s*\.category-grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    )
  })
})
