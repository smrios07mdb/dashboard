import { useRef, type KeyboardEvent } from 'react'

import { HORIZON_OPTIONS, type HorizonFilter } from '@/lib/horizon'
import { cn } from '@/lib/utils'

/*
 * Near · Long · All segmented control (chunk 76). Sits beside
 * TaskSortControl on the Dashboard columns and both drill-down headers,
 * all against the same global preference (lib/horizon).
 *
 * A radiogroup with roving tabindex: Tab lands on the checked segment;
 * arrows move the checked segment (wrapping at either end), Home/End go
 * to the first/last. Chrome matches TaskSortControl's pill.
 */

export type HorizonControlProps = {
  value: HorizonFilter
  onChange: (f: HorizonFilter) => void
  className?: string
}

export default function HorizonControl({
  value,
  onChange,
  className,
}: HorizonControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(
    0,
    HORIZON_OPTIONS.findIndex((o) => o.value === value),
  )

  function select(index: number) {
    const n = HORIZON_OPTIONS.length
    const i = ((index % n) + n) % n
    onChange(HORIZON_OPTIONS[i].value)
    refs.current[i]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // The Dashboard column header drills on Enter/Space; Space/Enter here
    // activate the segment natively and must not reach it.
    e.stopPropagation()
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = current + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = current - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = HORIZON_OPTIONS.length - 1
    if (next === null) return
    e.preventDefault()
    select(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label="Horizon"
      className={cn(
        'inline-flex items-stretch rounded-sm border border-line font-mono text-[11px] font-medium uppercase tracking-[0.1em]',
        className,
      )}
    >
      {HORIZON_OPTIONS.map((opt, i) => {
        const checked = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            // Headers that double as click/drill targets mount this inside
            // them; keep the click from bubbling into the drill handler.
            onClick={(e) => {
              e.stopPropagation()
              onChange(opt.value)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
            className={cn(
              'px-2 py-1 uppercase first:rounded-l-sm last:rounded-r-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              i > 0 && 'border-l border-line',
              checked ? 'bg-bg-alt text-ink' : 'text-ink-3 hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
