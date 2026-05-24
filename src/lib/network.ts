/*
 * Network status watcher.
 *
 * Single source of truth: navigator.onLine + the window online/offline
 * events. Mirrors state into the sync store so the SyncBadge UI (later
 * chunk) and the repo's offline detection share one signal.
 *
 * Module side-effect: the listeners attach on first import. This runs
 * exactly once because ES modules cache exports. SSR is guarded.
 */
import { syncStore } from '@/db/syncStore'

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

function onOnline() {
  const current = syncStore.getState().state
  // Don't overwrite an active sync — the repo/replay loop manages those
  // transitions. Only flip back to `synced` if we were `offline`.
  if (current === 'offline') syncStore.getState().setState('synced')
}

function onOffline() {
  syncStore.getState().setState('offline')
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
}
