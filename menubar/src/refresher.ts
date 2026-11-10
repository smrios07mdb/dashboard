/*
 * Refresh policy for the popover (chunk 91, D6): load when it is shown and
 * every 5 minutes while it stays open; nothing runs while it is hidden. No
 * realtime subscription — macOS suspends hidden web views.
 */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export type Refresher = {
  /** Tell the refresher whether the popover is on screen. */
  setShown: (shown: boolean) => void
  /** Load now, unless a load is already in flight. */
  refresh: () => Promise<void>
  dispose: () => void
}

export function createRefresher(load: () => Promise<unknown>): Refresher {
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null
  let shown = false
  let disposed = false

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        await load()
      } catch {
        // The loader reports its own failure; the next tick tries again.
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  function stop() {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  return {
    setShown(next) {
      if (disposed || next === shown) return
      shown = next
      stop()
      if (!shown) return
      void refresh()
      timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    },
    refresh,
    dispose() {
      disposed = true
      shown = false
      stop()
    },
  }
}
