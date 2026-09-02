import type { CSSProperties } from 'react'

import { blockPos, fmtClock, type WeekBusyBlock } from '@/lib/plannerGeometry'

/*
 * Busy overlay block (chunk 36, DESIGN_NOTES §Busy-overlay treatment).
 *
 * Context, not content: no surface, no shadow, no ink-strength text — a
 * tint recessed into the canvas at z1. iCloud = flat tint + inset ring;
 * Outlook = one step cooler + fine 135° hatch (1px stripes, 6px period).
 * Colors come from the `--busy-*` variables, with one exception (chunk
 * 51b): an iCloud block whose calendar has a color (`block.color`, see
 * lib/calendarColors) mixes that color into the same recessed tint — the
 * hue identifies the calendar, the opacity keeps it context — and shows a
 * dot of it beside the source tag.
 *
 * Renders a <button> so the popover is keyboard-reachable (chunk-36
 * acceptance). Stale Outlook: 55% opacity, source tag becomes
 * `OUTLOOK · HH:MM` from the feed's cache time.
 */

const clipMarkStyle = (dir: 'up' | 'down'): CSSProperties => ({
  position: 'absolute',
  right: 5,
  fontSize: 8,
  color: 'var(--ink-3)',
  ...(dir === 'up' ? { top: 2 } : { bottom: 2 }),
})

export type BusyBlockProps = {
  block: WeekBusyBlock
  hourH: number
  windowStartMin: number
  windowEndMin: number
  /** Outlook feed is serving cached data (sources.outlook.status === 'stale'). */
  stale: boolean
  /** Local `HH:MM` of the Outlook cache time (from sources.outlook.fetchedAt). */
  staleTime: string | null
  onOpen: (block: WeekBusyBlock, pos: { top: number; height: number }) => void
}

export default function BusyBlock({
  block,
  hourH,
  windowStartMin,
  windowEndMin,
  stale,
  staleTime,
  onOpen,
}: BusyBlockProps) {
  const pos = blockPos(
    block.startMin,
    block.endMin,
    hourH,
    windowStartMin,
    windowEndMin,
  )
  if (!pos) return null

  const cool = block.source === 'outlook'
  const isStale = stale && cool
  const sourceTag = cool
    ? isStale && staleTime
      ? `OUTLOOK · ${staleTime}`
      : 'OUTLOOK'
    : 'ICLOUD'
  const calColor = !cool && block.color ? block.color : null
  const background = cool
    ? 'repeating-linear-gradient(135deg, var(--busy-outlook-hatch) 0 1px, transparent 1px 6px), var(--busy-outlook)'
    : calColor
      ? `color-mix(in srgb, ${calColor} 16%, transparent)`
      : 'var(--busy-icloud)'
  const ring = cool
    ? 'var(--busy-outlook-ln)'
    : calColor
      ? `color-mix(in srgb, ${calColor} 42%, transparent)`
      : 'var(--busy-icloud-ln)'

  return (
    <button
      type="button"
      aria-label={`Busy ${fmtClock(block.startMin)} to ${fmtClock(block.endMin)}${
        block.title ? ` — ${block.title}` : ''
      } (${cool ? 'Outlook' : block.calendar ? `iCloud · ${block.calendar}` : 'iCloud'})`}
      data-calendar-color={calColor ?? undefined}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(block, pos)
      }}
      className="absolute inset-x-px flex flex-col overflow-hidden rounded-sm px-[7px] py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        top: pos.top,
        height: pos.height,
        zIndex: 1,
        opacity: isStale ? 0.55 : 1,
        background,
        boxShadow: `inset 0 0 0 1px ${ring}`,
      }}
    >
      {pos.height >= 26 && (
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] font-medium"
          style={{ color: 'var(--ink-3)' }}
        >
          {block.title}
        </span>
      )}
      {pos.height >= 46 && (
        <span
          className="label mt-auto inline-flex items-center gap-1"
          style={{ fontSize: 8.5, letterSpacing: '.14em', opacity: 0.8 }}
        >
          {calColor && (
            <span
              aria-hidden
              className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
              style={{ background: calColor }}
            />
          )}
          {sourceTag}
        </span>
      )}
      {pos.clipTop && (
        <span className="num mono" style={clipMarkStyle('up')}>
          ↑ {fmtClock(block.startMin)}
        </span>
      )}
      {pos.clipBottom && !pos.clipTop && (
        <span className="num mono" style={clipMarkStyle('down')}>
          ↓ {fmtClock(block.endMin)}
        </span>
      )}
    </button>
  )
}
