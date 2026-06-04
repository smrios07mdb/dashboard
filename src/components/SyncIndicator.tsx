import { useState } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SyncBadge } from '@/components/ui/sync-badge'
import { useSyncStore } from '@/db/syncStore'
import { syncLabel } from '@/lib/syncLabel'
import { useUIStore } from '@/state/uiStore'

/**
 * Wired sync status. The trigger visual is the Chunk-23 `SyncBadge` primitive
 * (which owns the dot colors + `sync-pulse` keyframe); this component keeps all
 * the shipped behavior: the popover (last sync + Force resync), the
 * `sync_issues → /settings` click-through, and the `sr-only` live region.
 *
 * State comes from `useSyncStore` (fed by the already-mounted `@/lib/network`
 * side-effect import). No new connectivity listeners are added here.
 */
function formatLastSync(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    return format(new Date(iso), 'MMM d, h:mm:ss a')
  } catch {
    return iso
  }
}

export default function SyncIndicator() {
  const state = useSyncStore((s) => s.state)
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt)
  const [resyncing, setResyncing] = useState(false)
  const navigate = useNavigate()

  // Polite SR announcement of every transition (UX-06). Reaches the a11y tree
  // even when the visual label is below the sm breakpoint; polite so it never
  // stomps ReconnectBanner's role="alert" connectivity alert (left untouched).
  const liveRegion = (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {syncLabel(state)}
    </span>
  )

  // Failed bucket: a single click straight into Settings → Sync issues (the
  // recovery UI), no popover. SyncBadge renders the destructive dot + label.
  if (state === 'sync_issues') {
    return (
      <>
        {liveRegion}
        <SyncBadge state={state} onClick={() => navigate('/settings')} />
      </>
    )
  }

  function forceResync() {
    setResyncing(true)
    try {
      // Bump the dashboard refresh counter; the Dashboard's effect subscribes
      // and re-runs the repo reads (online-first), re-hydrating Dexie.
      useUIStore.getState().forceDashboardRefresh()
    } finally {
      setResyncing(false)
    }
  }

  return (
    <>
      {liveRegion}
      <Popover>
        <PopoverTrigger asChild>
          <SyncBadge state={state} />
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-64 text-[13px]">
          <div className="space-y-3">
            <div className="font-medium text-foreground">{syncLabel(state)}</div>
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
    </>
  )
}
