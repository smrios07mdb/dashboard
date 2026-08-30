/*
 * UI store — ephemeral view state only.
 *
 * Per ARCHITECTURE.md §2: Zustand is for UI state, never cached data.
 * The data layer's mirrors live in Dexie; sync state lives in
 * `syncStore`. This store holds purely-presentational state that
 * doesn't need to survive a reload — currently just the dashboard's
 * "I have N minutes" input.
 *
 * No persistence by design: defaults are sensible enough that the cost
 * of forgetting on reload is lower than the cost of localStorage
 * quirks on iOS PWAs.
 */
import { create } from 'zustand'

type UIStoreState = {
  /** Minutes the user has available right now, for the "What's next?" triage. */
  availableMinutes: number
  setAvailableMinutes: (n: number) => void
  /**
   * Monotonic counter the Dashboard subscribes to as its effect dep.
   *
   * The repo's `markSyncedNow()` ticks `syncStore.lastSyncAt` on every
   * successful read, so we can't use `lastSyncAt` as a refetch trigger
   * without spinning into an infinite read loop. Instead, anything that
   * wants the Dashboard to refetch (today: the Force-resync button)
   * calls `forceDashboardRefresh()` to bump this counter.
   */
  dashboardRefreshKey: number
  forceDashboardRefresh: () => void
  /**
   * Monotonic counter the Planner's busy fetch subscribes to (chunk 37
   * revisions, R2).
   *
   * Busy is proxy-backed and expensive, so its per-week cache runs on a
   * 5-minute TTL + window focus instead of `dashboardRefreshKey` (which
   * every planner write bumps through its realtime echo). Explicit
   * resyncs — the sync pill, cache wipe, import, calendar connect /
   * disconnect — call `forceBusyRefresh()` alongside
   * `forceDashboardRefresh()` to drop that cache.
   */
  busyRefreshKey: number
  forceBusyRefresh: () => void
}

export const useUIStore = create<UIStoreState>((set) => ({
  availableMinutes: 30,
  setAvailableMinutes: (n) => set({ availableMinutes: n }),
  dashboardRefreshKey: 0,
  forceDashboardRefresh: () =>
    set((s) => ({ ...s, dashboardRefreshKey: s.dashboardRefreshKey + 1 })),
  busyRefreshKey: 0,
  forceBusyRefresh: () =>
    set((s) => ({ ...s, busyRefreshKey: s.busyRefreshKey + 1 })),
}))
