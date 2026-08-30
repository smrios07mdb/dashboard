import type { Task } from '@/db/types'
import { catColor } from '@/lib/cat'
import { blockPos, fmtRange } from '@/lib/plannerGeometry'
import type { Proposal } from '@/lib/plannerSchedule'

/*
 * Fill-my-week proposal preview (chunk 38, prototype `ProposalBlock`):
 * not yet real, so no surface — a category-tinted dashed intent at z3
 * with the title and, at ≥40px, `HH:MM–HH:MM · proposed`. `aria-hidden`:
 * the proposals bar (Place all / Clear) is the control, this is a preview.
 *
 * Style rule: the `border` shorthand is the only border key here (no
 * longhand alongside it).
 */

export type ProposalBlockProps = {
  proposal: Proposal & { task: Task; catName: string }
  hourH: number
  windowStartMin: number
  windowEndMin: number
}

export default function ProposalBlock({
  proposal,
  hourH,
  windowStartMin,
  windowEndMin,
}: ProposalBlockProps) {
  const pos = blockPos(
    proposal.startMin,
    proposal.endMin,
    hourH,
    windowStartMin,
    windowEndMin,
  )
  if (!pos) return null
  const c = catColor(proposal.catName)
  return (
    <div
      aria-hidden
      data-testid="proposal-block"
      className="absolute inset-x-[3px] flex flex-col gap-px overflow-hidden rounded"
      style={{
        top: pos.top,
        height: pos.height,
        zIndex: 3,
        border: `1.5px dashed color-mix(in srgb, ${c} 50%, transparent)`,
        background: `color-mix(in srgb, ${c} 6%, var(--surface))`,
        padding: pos.height < 40 ? '3px 7px' : '5px 8px',
      }}
    >
      <span
        className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-medium leading-[1.25]"
        style={{ color: 'var(--ink-2)' }}
      >
        {proposal.task.title}
      </span>
      {pos.height >= 40 && (
        <span className="num mono text-[9.5px]" style={{ color: c }}>
          {fmtRange(proposal.startMin, proposal.endMin)} · proposed
        </span>
      )}
    </div>
  )
}
