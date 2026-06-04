import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Pill — small rounded status chip (prototype `Pill`; DESIGN_NOTES §6 maps it to
 * Badge, but the cat-aware filled/soft semantics warrant a dedicated component).
 *
 * - `filled` → solid color + light text + soft shadow (the "N OPEN" pill).
 * - default (soft) → tinted wash + colored text (streak/level/count chips).
 *
 * Colors are CSS vars (never hex) so Work/Personal track the live `data-catpalette`.
 */
export type PillTone =
  | 'neutral'
  | 'accent'
  | 'work'
  | 'personal'
  | 'warn'
  | 'danger'

const SOFT: Record<PillTone, React.CSSProperties> = {
  neutral: { background: 'var(--bg-alt)', color: 'var(--ink-2)' },
  accent: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
  work: { background: 'var(--work-soft)', color: 'var(--work)' },
  personal: { background: 'var(--personal-soft)', color: 'var(--personal)' },
  warn: {
    background: 'color-mix(in srgb, var(--warn) 16%, transparent)',
    color: 'color-mix(in srgb, var(--warn) 62%, var(--ink))',
  },
  danger: { background: 'var(--destructive-soft)', color: 'var(--destructive)' },
}

const FILLED: Record<PillTone, React.CSSProperties> = {
  neutral: { background: 'var(--ink)', color: 'var(--surface)' },
  accent: { background: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' },
  work: { background: 'var(--work)', color: 'var(--surface)' },
  personal: { background: 'var(--personal)', color: 'var(--surface)' },
  warn: { background: 'var(--warn)', color: 'var(--surface)' },
  danger: {
    background: 'hsl(var(--destructive))',
    color: 'hsl(var(--destructive-foreground))',
  },
}

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone
  filled?: boolean
}

export function Pill({
  tone = 'neutral',
  filled = false,
  className,
  style,
  children,
  ...rest
}: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-[0.01em]',
        filled && 'shadow-sm',
        className,
      )}
      style={{ ...(filled ? FILLED : SOFT)[tone], ...style }}
      {...rest}
    >
      {children}
    </span>
  )
}
