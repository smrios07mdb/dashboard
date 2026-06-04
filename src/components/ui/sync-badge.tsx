import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * SyncBadge — status dot + label (prototype `SyncBadge`). Presentational and
 * prop-driven; Chunk 24's shell wires `state` to the real connectivity store and
 * supplies the popover `onClick`. Four states per ARCHITECTURE §6.
 *
 * The `syncing` dot pulses via the `sync-pulse` keyframe (src/index.css), tinted
 * to the dot color; `prefers-reduced-motion` disables it globally.
 */
export type SyncState = 'synced' | 'syncing' | 'offline' | 'sync_issues'

const STATES: Record<SyncState, { dot: string; label: string; sub: string }> = {
  synced: { dot: 'var(--good)', label: 'Synced', sub: 'All changes saved' },
  syncing: { dot: 'var(--warn)', label: 'Syncing', sub: 'Saving changes…' },
  offline: { dot: 'var(--offline)', label: 'Offline', sub: 'Changes queued locally' },
  sync_issues: {
    dot: 'hsl(var(--destructive))',
    label: 'Sync issues',
    sub: 'Some changes need attention',
  },
}

export interface SyncBadgeProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  state?: SyncState
}

/**
 * forwardRef + prop spread so it can be a Radix `PopoverTrigger asChild` (Slot
 * injects onClick / aria-expanded / ref) — see SyncIndicator (Chunk 24).
 */
export const SyncBadge = React.forwardRef<HTMLButtonElement, SyncBadgeProps>(
  function SyncBadge({ state = 'synced', className, ...rest }, ref) {
    const it = STATES[state] ?? STATES.synced
    const pulsing = state === 'syncing'
    const dotStyle: React.CSSProperties = pulsing
      ? {
          background: it.dot,
          // CSS var consumed by the `sync-pulse` keyframe for a same-color ripple.
          ['--sync-dot' as string]: `color-mix(in srgb, ${it.dot} 45%, transparent)`,
          animation: 'sync-pulse 1.4s infinite',
        }
      : { background: it.dot }

    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-line bg-surface py-[5px] pl-2 pr-2.5 text-[12px] text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !rest.onClick && 'cursor-default',
          className,
        )}
        {...rest}
        title={it.sub}
        aria-label={`Sync status: ${it.label}`}
      >
        <span aria-hidden className="size-[7px] rounded-full" style={dotStyle} />
        <span>{it.label}</span>
      </button>
    )
  },
)
