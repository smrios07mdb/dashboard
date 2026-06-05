import { Flame } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Streak counter pill (Daylight).
 *
 * Visual contract (matches the prototype chip in
 * hupomnemata_handoff/app/src/screens/routines.jsx):
 *   - `streak > 0`: `accentSoft` fill, a lucide `Flame` + `.num` count in the
 *     accent, then "day"/"days" in `ink-3`. The accent is the routine jewel
 *     (gold / amethyst); a neutral fallback keeps the component reusable.
 *   - `streak === 0`: `bg-alt` fill, mono uppercase "Start today" in `ink-3`.
 *
 * Chunk 28 adopts the prototype's Flame + "N day(s)" form (Decision A). Flame
 * is an SVG icon, not an emoji, so it honors the letter of the chunk-10
 * "no emoji" rule while matching the prototype. The visible trailing word
 * "streak" is dropped; the full "N day streak" lives on in the `aria-label`.
 */

export type StreakBadgeProps = {
  streak: number
  tone?: 'morning' | 'night' | 'neutral'
  className?: string
}

const ACCENT: Record<NonNullable<StreakBadgeProps['tone']>, string> = {
  morning: 'var(--jewel-gold)',
  night: 'var(--jewel-amethyst)',
  neutral: 'var(--ink)',
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
          'inline-flex items-center rounded-full bg-bg-alt px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-3',
          className,
        )}
      >
        Start today
      </span>
    )
  }

  const accent = ACCENT[tone]
  const accentSoft = `color-mix(in srgb, ${accent} 15%, transparent)`

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
        className,
      )}
      style={{ background: accentSoft, color: accent }}
      aria-label={`${streak} day streak`}
    >
      <Flame className="size-3" aria-hidden style={{ color: accent }} />
      <span className="num font-bold" style={{ color: accent }}>
        {streak}
      </span>
      <span className="text-ink-3">day{streak === 1 ? '' : 's'}</span>
    </span>
  )
}
