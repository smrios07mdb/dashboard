import { catColor } from '@/lib/cat'
import { blockPos, fmtRange } from '@/lib/plannerGeometry'

/*
 * Drop-target / preview slot (chunk 37, prototype `DropSlot`).
 *
 * z4, pointer-events none. Category tint when clear (1.5px dashed 55% mix
 * + 7% fill, mono range in the category color); destructive when the
 * candidate range overlaps busy, with the `OVERLAPS {TITLE} · {m}M` /
 * `CONFLICTS WITH BUSY` note (D8 — advisory, the drop still lands).
 */

export type DropSlotProps = {
  startMin: number
  endMin: number
  catName: string
  kind: 'valid' | 'conflict'
  hourH: number
  windowStartMin: number
  windowEndMin: number
  /** Conflict note; defaults to `CONFLICTS WITH BUSY`. */
  note?: string | null
}

export default function DropSlot({
  startMin,
  endMin,
  catName,
  kind,
  hourH,
  windowStartMin,
  windowEndMin,
  note,
}: DropSlotProps) {
  const pos = blockPos(startMin, endMin, hourH, windowStartMin, windowEndMin)
  if (!pos) return null
  const c = kind === 'conflict' ? 'hsl(var(--destructive))' : catColor(catName)
  return (
    <div
      data-testid="drop-slot"
      aria-hidden
      className="pointer-events-none absolute inset-x-[3px] flex flex-col gap-0.5 overflow-hidden rounded px-2 py-1"
      style={{
        top: pos.top,
        height: pos.height,
        zIndex: 4,
        border: `1.5px dashed color-mix(in srgb, ${c} 55%, transparent)`,
        background: `color-mix(in srgb, ${c} 7%, transparent)`,
      }}
    >
      <span className="num mono text-[10px] font-semibold" style={{ color: c }}>
        {fmtRange(startMin, endMin)}
      </span>
      {kind === 'conflict' && (
        <span
          className="label whitespace-normal leading-[1.35]"
          style={{
            fontSize: 8.5,
            letterSpacing: '.12em',
            color: 'hsl(var(--destructive))',
          }}
        >
          {note || 'CONFLICTS WITH BUSY'}
        </span>
      )}
    </div>
  )
}
