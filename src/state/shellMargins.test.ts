import { beforeEach, describe, expect, it } from 'vitest'

import {
  clampMargins,
  defaultMargins,
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

  it('clampMargins keeps the minimum content width between the sides', () => {
    expect(clampMargins({ side: 400, top: 0, bottom: 0 }, 600).side).toBe(160)
  })
})
