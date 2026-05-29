import { useState } from 'react'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useSyncStore } from '@/db/syncStore'
import type { SyncState } from '@/db/types'
import { useUIStore } from '@/state/uiStore'

/**
 * Color + label map for every SyncState (per chunk-06 prompt).
 *
 * Chunk 15 wires the last two states to real behavior: `syncing` shows a
 * spinner while the outbox drains, and `sync_issues` becomes a click-through
 * to Settings → Sync issues (the failed bucket lives there).
 */
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

const TRIGGER_CLASS =
  'inline-flex min-h-11 items-center gap-2 rounded-[5px] border border-border bg-card px-3 text-[12px] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function formatLastSync(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    return format(new Date(iso), 'MMM d, h:mm:ss a')
  } catch {
    return iso
  }
}

/** A spinner while syncing, otherwise the state's colored dot. */
function StateGlyph({ state }: { state: SyncState }) {
  if (state === 'syncing') {
    return (
      <Loader2
        aria-hidden
        className="size-3 animate-spin text-[var(--warn)]"
      />
    )
  }
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${STATE_META[state].dotClass}`}
    />
  )
}

export default function SyncIndicator() {
  const state = useSyncStore((s) => s.state)
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt)
  const [resyncing, setResyncing] = useState(false)
  const navigate = useNavigate()

  const meta = STATE_META[state]

  // Failed bucket: the indicator is a direct link into Settings → Sync issues
  // rather than a popover, so a single click takes the user to the recovery UI.
  if (state === 'sync_issues') {
    return (
      <button
        type="button"
        aria-label="Sync issues — open Settings to resolve"
        onClick={() => navigate('/settings')}
        className={TRIGGER_CLASS}
      >
        <StateGlyph state={state} />
        <span className={`hidden sm:inline ${meta.tone}`}>{meta.label}</span>
      </button>
    )
  }

  async function forceResync() {
    setResyncing(true)
    try {
      // Bump the dashboard refresh counter; the Dashboard's effect
      // subscribes to this and re-runs the repo reads, which
      // re-hydrate Dexie via the online-first read pattern.
      useUIStore.getState().forceDashboardRefresh()
    } finally {
      setResyncing(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Sync status: ${meta.label}`}
        className={TRIGGER_CLASS}
      >
        <StateGlyph state={state} />
        <span className={`hidden sm:inline ${meta.tone}`}>{meta.label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 text-[13px]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StateGlyph state={state} />
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
