import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * P1 / P2 / P3 chip (chunk 33, DESIGN_NOTES.md § Priority system).
 *
 * Plex Mono 9.5px, .1em tracking, --radius-sm, 2×6px padding. Tints:
 *   P1  --destructive-soft wash / hsl(var(--destructive)) text
 *   P2  color-mix --warn 16% wash / --warn 62% into --ink text
 *   P3  --bg-alt / --ink-3
 *
 * `--destructive` is a space-separated HSL triplet (shadcn convention),
 * so it's only ever consumed through hsl(); the raw rgba wash lives in
 * `--destructive-soft`. `--warn`, `--bg-alt`, `--ink-3` are raw values.
 *
 * With `onClick` the chip renders as a <button> (the picker entry
 * point) with a centered ::before hit area — 24px base, and TaskRow
 * widens it to 44px on touch, the same pattern as ui/checkbox. Without
 * `onClick` it's a plain <span> (picker option rows, planner blocks).
 *
 * forwardRef + rest spread so the button form works as a Radix
 * `asChild` child (PopoverTrigger injects its toggle handler and ref
 * via Slot).
 */

export type PriorityValue = 1 | 2 | 3

const PRIORITY_STYLES: Record<
  PriorityValue,
  { background: string; color: string }
> = {
  1: {
    background: 'var(--destructive-soft)',
    color: 'hsl(var(--destructive))',
  },
  2: {
    background: 'color-mix(in srgb, var(--warn) 16%, transparent)',
    color: 'color-mix(in srgb, var(--warn) 62%, var(--ink))',
  },
  3: {
    background: 'var(--bg-alt)',
    color: 'var(--ink-3)',
  },
}

export type PriorityChipProps = {
  priority: PriorityValue
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  className?: string
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'className' | 'style'
>

const chipClass =
  'mono inline-flex shrink-0 items-center rounded-sm px-1.5 py-[2px] text-[9.5px] font-semibold leading-[14px] tracking-[0.1em]'

const PriorityChip = forwardRef<HTMLButtonElement, PriorityChipProps>(
  function PriorityChip({ priority, onClick, className, ...rest }, ref) {
    const style = PRIORITY_STYLES[priority]
    const text = `P${priority}`

    if (!onClick) {
      return (
        <span className={cn(chipClass, className)} style={style}>
          {text}
        </span>
      )
    }

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={`Priority ${priority} — change priority`}
        className={cn(
          chipClass,
          "relative before:absolute before:left-1/2 before:top-1/2 before:size-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        style={style}
        {...rest}
      >
        {text}
      </button>
    )
  },
)

export default PriorityChip
