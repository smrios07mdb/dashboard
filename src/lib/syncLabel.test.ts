import { describe, expect, it } from 'vitest'

import type { SyncState } from '@/db/types'

import { syncLabel } from './syncLabel'

describe('syncLabel', () => {
  it('announces a concise label for each sync state', () => {
    const cases: Record<SyncState, string> = {
      synced: 'Synced',
      syncing: 'Syncing…',
      offline: 'Offline',
      sync_issues: 'Sync issues',
    }
    for (const state of Object.keys(cases) as SyncState[]) {
      expect(syncLabel(state)).toBe(cases[state])
    }
  })

  it('uses an ellipsis for the in-progress state so it reads as ongoing', () => {
    expect(syncLabel('syncing')).toBe('Syncing…')
  })

  it('returns a non-empty string for every state (no silent gaps)', () => {
    const states: SyncState[] = ['synced', 'syncing', 'offline', 'sync_issues']
    for (const state of states) {
      expect(syncLabel(state).length).toBeGreaterThan(0)
    }
  })
})
