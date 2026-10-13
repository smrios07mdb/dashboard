import { REVIEW_AGE_DAYS } from '@/lib/review'

/*
 * The weekly "review old tasks" prompt (chunk 74 — UX audit #10).
 *
 * One wrapping row in the Recovered card's shell. Prop-driven — the Dashboard
 * derives the candidates, decides whether the review is due, and owns both
 * actions.
 */

const BUTTON =
  'min-h-11 rounded-md border border-line bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

type ReviewPromptProps = {
  /** How many tasks the review would walk. */
  count: number
  onReview: () => void
  onNotNow: () => void
}

export default function ReviewPrompt({
  count,
  onReview,
  onNotNow,
}: ReviewPromptProps) {
  if (count === 0) return null
  return (
    <section
      aria-label="Review old tasks"
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border border-line bg-surface px-5 py-3 shadow-md"
      style={{ borderRadius: 'var(--radius-lg)' }}
    >
      <p className="m-0 min-w-0 flex-[1_1_200px] text-[14px] text-ink">
        {count === 1
          ? `1 task is older than ${REVIEW_AGE_DAYS} days.`
          : `${count} tasks are older than ${REVIEW_AGE_DAYS} days.`}
      </p>
      <button type="button" onClick={onReview} className={BUTTON}>
        Review
      </button>
      <button type="button" onClick={onNotNow} className={BUTTON}>
        Not now
      </button>
    </section>
  )
}
