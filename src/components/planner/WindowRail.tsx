import { ChevronDown, ChevronUp } from '@/components/icons'
import { cn } from '@/lib/utils'

/*
 * Collapsed-hour rail (chunk 36) — the quiet `SHOW 07:00 – 08:00 · N HIDDEN`
 * expander above/below the grid. Ported from the prototype's `WindowRail`.
 */

export type WindowRailProps = {
  expanded: boolean
  onToggle: () => void
  /** e.g. `07:00 – 08:00` (desktop) or `07 – 08` (mobile). */
  label: string
  hiddenCount: number
  side: 'top' | 'bottom'
}

export default function WindowRail({
  expanded,
  onToggle,
  label,
  hiddenCount,
  side,
}: WindowRailProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'mono flex w-full items-center justify-center gap-1.5 py-[5px] text-[9px] font-medium uppercase tracking-[.12em] text-ink-3 transition-colors hover:text-ink-2',
        side === 'bottom' && 'border-t border-line',
      )}
    >
      {expanded ? (
        <ChevronUp size={10} aria-hidden />
      ) : (
        <ChevronDown size={10} aria-hidden />
      )}
      {expanded ? `HIDE ${label}` : `SHOW ${label}`}
      {!expanded && hiddenCount > 0 && (
        <span className="text-ink-4">· {hiddenCount} HIDDEN</span>
      )}
    </button>
  )
}
