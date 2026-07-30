import { DAY_LABELS } from '@/lib/plannerGeometry'

/*
 * Mobile day-selector strip (chunk 36, README §2): 7 chips — `.label`
 * day + mono date, selected = `--ink` fill, today = emerald dot. 44pt
 * touch targets via min-height.
 */

export type DayStripProps = {
  days: Date[]
  selected: number
  todayIdx: number
  onSelect: (day: number) => void
}

export default function DayStrip({
  days,
  selected,
  todayIdx,
  onSelect,
}: DayStripProps) {
  return (
    <div className="flex gap-1 pb-2">
      {days.map((d, i) => {
        const isSelected = i === selected
        const isToday = i === todayIdx
        return (
          <button
            key={i}
            type="button"
            aria-pressed={isSelected}
            aria-label={`${DAY_LABELS[i]} ${d.getDate()}${isToday ? ' (today)' : ''}`}
            onClick={() => onSelect(i)}
            className="flex min-h-11 flex-1 flex-col items-center gap-0.5 rounded py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              background: isSelected ? 'var(--ink)' : 'transparent',
            }}
          >
            <span
              className="label"
              style={{
                fontSize: 8.5,
                color: isSelected ? 'var(--bg)' : 'var(--ink-3)',
              }}
            >
              {DAY_LABELS[i]}
            </span>
            <span
              className="num mono text-[13px] font-semibold"
              style={{ color: isSelected ? 'var(--bg)' : 'var(--ink-2)' }}
            >
              {d.getDate()}
            </span>
            <span
              aria-hidden
              className="rounded-full"
              style={{
                width: 4,
                height: 4,
                background: isToday
                  ? isSelected
                    ? 'var(--bg)'
                    : 'var(--work)'
                  : 'transparent',
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
