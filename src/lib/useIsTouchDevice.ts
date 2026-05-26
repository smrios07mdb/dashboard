import { useState } from 'react'

/*
 * Mount-time touch-device detection.
 *
 * `matchMedia('(hover: none)')` is the canonical CSS Media Queries 4
 * signal for "the primary input cannot hover" — true on iOS Safari,
 * Android Chrome; false on a desktop browser with a trackpad/mouse.
 *
 * Evaluated once at component mount. We don't subscribe to changes
 * because users rarely change input modality mid-session; the chunk-8
 * pre-flight notes confirm this as the project's chosen tradeoff.
 *
 * SSR-safe: returns false when `window` is undefined (no PWA SSR yet,
 * but cheap to handle).
 */
export function useIsTouchDevice(): boolean {
  const [isTouch] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(hover: none)').matches
  })
  return isTouch
}
