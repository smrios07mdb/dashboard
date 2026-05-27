import { cn } from '@/lib/utils'

/**
 * Streak counter pill. Text only — no emoji per the chunk-10 prompt's
 * "5 day streak — text, no emoji" requirement.
 *
 * Visual contract:
 *   - `streak > 0`: filled pill with "N day streak" in mono num + UI label.
 *   - `streak === 0`: muted "Start today" label, monospace, all-caps.
 *
 * Color hint optionally bumps via `tone`. Default tone is neutral so the
 * component is reusable beyond Morning/Night should a future surface
 * need it.
 */

export type StreakBadgeProps = {
  streak: number
  tone?: 'morning' | 'night' | 'neutral'
  className?: string
}

export default function StreakBadge({
  streak,
  tone = 'neutral',
  className,
}: StreakBadgeProps) {
  if (streak <= 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground',
          className,
        )}
      >
        Start today
      </span>
    )
  }

  const toneClass =
    tone === 'morning'
      ? 'bg-[hsl(40_70%_60%/0.15)] text-[hsl(40_70%_75%)]'
      : tone === 'night'
        ? 'bg-[hsl(260_75%_75%/0.15)] text-[hsl(260_70%_82%)]'
        : 'bg-secondary text-foreground'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
        toneClass,
        className,
      )}
      aria-label={`${streak} day streak`}
    >
      <span className="font-mono tabular-nums">{streak}</span>
      <span className="text-muted-foreground">
        day{streak === 1 ? '' : 's'} streak
      </span>
    </span>
  )
}
