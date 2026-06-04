/*
 * Pure SyncState → announced label (chunk 20 — UX-06).
 *
 * Drives the SyncIndicator's aria-live region so screen readers hear every
 * transition (offline / syncing / synced / sync_issues), including below the
 * `sm` breakpoint where the visual label is `hidden`. Kept separate from the
 * visual STATE_META map: the announced "Syncing…" carries an ellipsis to read
 * as ongoing, whereas the compact pill stays "Syncing".
 */
import type { SyncState } from '@/db/types'

const ANNOUNCED: Record<SyncState, string> = {
  synced: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline',
  sync_issues: 'Sync issues',
}

export function syncLabel(state: SyncState): string {
  return ANNOUNCED[state]
}
