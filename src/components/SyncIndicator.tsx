import { useState } from 'react'
import { format } from 'date-fns'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useSyncStore } from '@/db/syncStore'
import type { SyncState } from '@/db/types'
import { repo } from '@/db/repo'

/**
 * Color + label map for every SyncState (per chunk-06 prompt).
 *
 * `sync_issues` is unreachable until chunk 15 wires the outbox failed
 * bucket — but the indicator handles it explicitly so the dashboard
 * is ready when that lands.
 */
// sync_issues is unreachable until chunk 15 wires the outbox failed bucket
const STATE_META: Record<
  SyncState,
  { label: string; dotClass: string; tone: string }
> = {
  synced: {
    label: 'Synced',
    dotClass: 'bg-[var(--good)]',
    tone: 'text-secondary-foreground',
  },
  syncing: {
    label: 'Syncing',
    dotClass: 'bg-[var(--warn)]',
    tone: 'text-secondary-foreground',
  },
  offline: {
    label: 'Offline',
    dotClass: 'bg-[var(--offline)]',
    tone: 'text-muted-foreground',
  },
  sync_issues: {
    label: 'Sync issues',
    dotClass: 'bg-destructive',
    tone: 'text-destructive',
  },
}

function formatLastSync(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    return format(new Date(iso), "MMM d, h:mm:ss a")
  } catch {
    return iso
  }
}

export default function SyncIndicator() {
  const state = useSyncStore((s) => s.state)
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt)
  const [resyncing, setResyncing] = useState(false)

  const meta = STATE_META[state]

  async function forceResync() {
    setResyncing(true)
    try {
      // Re-reading via the repo's online-first read pattern refreshes
      // the Dexie cache as a side-effect; the repo also stamps
      // `lastSyncAt` so any subscriber re-renders.
      await Promise.all([
        repo.categories.list(),
        repo.subcategories.list(),
        repo.tasks.list(),
        repo.routineItems.list(),
      ])
    } finally {
      setResyncing(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Sync status: ${meta.label}`}
        className="inline-flex min-h-11 items-center gap-2 rounded-[5px] border border-border bg-card px-3 text-[12px] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${meta.dotClass}`}
        />
        <span className={`hidden sm:inline ${meta.tone}`}>{meta.label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 text-[13px]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${meta.dotClass}`}
            />
            <span className="font-medium text-foreground">{meta.label}</span>
          </div>
          <div className="space-y-1">
            <div className="label">Last sync</div>
            <div className="font-mono text-[12px] text-secondary-foreground">
              {formatLastSync(lastSyncAt)}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={forceResync}
            disabled={resyncing}
          >
            {resyncing ? 'Resyncing…' : 'Force resync'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
