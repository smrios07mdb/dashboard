/*
 * Sync indicator state — read by the SyncBadge UI (later chunk) and
 * written by the repo, realtime layer, and network watcher.
 *
 * States (per ARCHITECTURE.md §6):
 *   synced       — outbox empty, online
 *   syncing      — outbox > 0, currently draining
 *   offline      — no network
 *   sync_issues  — one or more rows in the failed bucket
 *
 * Use Zustand's vanilla store (no React import) so non-component code
 * (repo, network, realtime) can subscribe via `syncStore.getState()` /
 * `syncStore.subscribe()` and React components can read via the hook.
 */
import { create } from 'zustand'

import type { SyncState } from './types'

type SyncStoreState = {
  state: SyncState
  lastSyncAt: string | null
  setState: (next: SyncState) => void
  setLastSyncAt: (iso: string | null) => void
}

function initialState(): SyncState {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline'
  return 'synced'
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  state: initialState(),
  lastSyncAt: null,
  setState: (next) => set({ state: next }),
  setLastSyncAt: (iso) => set({ lastSyncAt: iso }),
}))

/** Non-React access for repo/network/realtime modules. */
export const syncStore = useSyncStore
