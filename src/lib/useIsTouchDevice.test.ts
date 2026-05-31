import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useIsTouchDevice } from './useIsTouchDevice'

/*
 * The touch gate (UX-02): row controls only grow to the ≥44pt hit target on a
 * device whose primary input can't hover. `(hover: none)` is the canonical
 * signal. This locks the hook's contract so a future refactor can't silently
 * flip the gate.
 */
function mockMatchMedia(hoverNoneMatches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(hover: none)' ? hoverNoneMatches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('useIsTouchDevice', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns true when (hover: none) matches (touch device)', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(true)
  })

  it('returns false when (hover: none) does not match (pointer device)', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(false)
  })
})
