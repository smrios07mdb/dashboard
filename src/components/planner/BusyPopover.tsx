import { useEffect, useRef } from 'react'

import { fmtRange, type WeekBusyBlock } from '@/lib/plannerGeometry'

/*
 * Busy-block popover (chunk 36, README §Interactions "Busy popover").
 *
 * Read-only but inspectable: title (when the feed provides one), mono
 * range, source line, sync state. The prototype's "Open in Outlook /
 * Apple Calendar" deep link is deliberately omitted — the proxy returns
 * no event URLs (chunk-36 prompt).
 *
 * Closes on Escape, outside pointer-down, or the grid's own click-away.
 * Focus moves into the dialog on open so Escape works from keyboard
 * flows that opened it via the block's <button>.
 */

export type BusyPopoverProps = {
  block: WeekBusyBlock
  stale: boolean
  /** Local `HH:MM` of the Outlook cache time (stale line). */
  staleTime: string | null
  /** Whole minutes since the busy fetch (fresh "Synced Xm ago" line). */
  syncedAgoMin: number | null
  top: number
  alignRight: boolean
  onClose: () => void
}

export default function BusyPopover({
  block,
  stale,
  staleTime,
  syncedAgoMin,
  top,
  alignRight,
  onClose,
}: BusyPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const cool = block.source === 'outlook'
  const isStale = stale && cool
  const syncLine = isStale
    ? `Cached at ${staleTime ?? '—'} — feed unreachable`
    : syncedAgoMin === null
      ? 'Synced just now'
      : syncedAgoMin < 1
        ? 'Synced just now'
        : `Synced ${syncedAgoMin}m ago`

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={`Busy details${block.title ? ` — ${block.title}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-[25] w-[216px] rounded border border-line bg-surface px-[13px] py-[11px] shadow-md outline-none"
      style={{ top, [alignRight ? 'right' : 'left']: 2 }}
    >
      {block.title && (
        <div className="text-[13px] font-medium text-ink">{block.title}</div>
      )}
      <div className="num mono mt-0.5 text-[11px] text-ink-3">
        {fmtRange(block.startMin, block.endMin)}
      </div>
      <hr className="my-[9px] border-line" />
      <div className="label" style={{ fontSize: 8.5 }}>
        {cool
          ? 'OUTLOOK · WORK FEED'
          : `ICLOUD · ${(block.calendar ?? 'Calendar').toUpperCase()}`}
      </div>
      <div
        className="num mono mt-1 text-[11px]"
        style={{
          color: isStale
            ? 'color-mix(in srgb, var(--warn) 62%, var(--ink))'
            : 'var(--ink-3)',
        }}
      >
        {syncLine}
      </div>
    </div>
  )
}
