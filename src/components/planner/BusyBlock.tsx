import type { CSSProperties } from 'react'

import { blockPos, fmtClock, type WeekBusyBlock } from '@/lib/plannerGeometry'

/*
 * Busy overlay block (chunk 36, DESIGN_NOTES §Busy-overlay treatment).
 *
 * Context, not content: no surface, no shadow, no ink-strength text — a
 * tint recessed into the canvas at z1. iCloud = flat tint + inset ring;
 * Outlook = one step cooler + fine 135° hatch (1px stripes, 6px period).
 * Colors come from the `--busy-*` variables, with one exception (chunk
 * 51b, Outlook in 51c): a block whose calendar has a color (`block.color`,
 * see lib/calendarColors) mixes that color into the same recessed tint —
 * the hue identifies the calendar, the opacity keeps it context — and
 * shows a dot of it beside the source tag. An Outlook block keeps its
 * hatch over the tint: the hatch is the source cue, the color the
 * identity cue. Without a color the flat tokens stand.
 *
 * Tight blocks (chunk 51c, D2/D3): a 30-minute block is 24px on desktop
 * (`hourH 52`) and 22px on mobile (`mHourH 48`), so the title renders from
 * 18px with tighter padding and type below 30px. The 14px floor
 * (`blockPos`, 15 minutes) stays text-free — the popover is the reveal.
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
  const calColor = block.color ?? null
  const tint = calColor
    ? `color-mix(in srgb, ${calColor} 16%, transparent)`
    : cool
      ? 'var(--busy-outlook)'
      : 'var(--busy-icloud)'
  const background = cool
    ? `repeating-linear-gradient(135deg, var(--busy-outlook-hatch) 0 1px, transparent 1px 6px), ${tint}`
    : tint
  const ring = calColor
    ? `color-mix(in srgb, ${calColor} 42%, transparent)`
    : cool
      ? 'var(--busy-outlook-ln)'
      : 'var(--busy-icloud-ln)'
  const tight = pos.height < 30

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
      className={`absolute inset-x-px flex flex-col overflow-hidden rounded-sm px-[7px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tight ? 'py-[2px]' : 'py-1'
      }`}
      style={{
        top: pos.top,
        height: pos.height,
        zIndex: 1,
        opacity: isStale ? 0.55 : 1,
        background,
        boxShadow: `inset 0 0 0 1px ${ring}`,
      }}
    >
      {pos.height >= 18 && (
        <span
          className={`overflow-hidden text-ellipsis whitespace-nowrap font-medium ${
            tight ? 'text-[10px] leading-[1.1]' : 'text-[10.5px]'
          }`}
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
