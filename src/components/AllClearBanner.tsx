import { Check } from 'lucide-react'

/*
 * All-clear empty state (chunk 20 — UX-05; DESIGN_NOTES §3).
 *
 * Jade banner shown above the columns when the board has tasks but nothing
 * outstanding. `role="status"` announces the transition politely when the
 * user completes their last open task. Calm, non-gamified copy (DESIGN_BRIEF
 * — no "Great job!" / streaks). Jade comes from the live --good/--work token,
 * not literal hex.
 */
export default function AllClearBanner() {
  return (
    <div
      role="status"
      className="mb-6 flex items-center gap-3 rounded-md border border-[var(--good)] bg-[var(--work-soft)] px-4 py-3"
    >
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--good)] text-[var(--bg)]"
      >
        <Check className="size-4" />
      </span>
      <div>
        <div className="text-[14px] font-semibold text-foreground">
          All clear
        </div>
        {/*
         * secondary-foreground (not muted-foreground): the jade tint darkens
         * the surface below plain --bg, where muted lands at ~4.45:1 — under
         * the DESIGN_BRIEF ≥4.5:1 bar. secondary clears it (~7:1).
         */}
        <div className="text-[13px] text-secondary-foreground">
          Nothing outstanding right now.
        </div>
      </div>
    </div>
  )
}
