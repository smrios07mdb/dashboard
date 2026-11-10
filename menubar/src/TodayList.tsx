/*
 * The Today list (chunk 91, D5). Row order is `resolveToday`'s; nothing
 * here sorts or filters. Each row checks off (chunk 92) through `onToggle`.
 */
import PriorityChip from '@/components/PriorityChip'
import { catColor, fmtMin } from '@/lib/cat'
import type { WhenTone } from '@/lib/whenLabel'

import type { TodayView, TodayViewRow } from './todayView'

// TaskRow's when-chip tones.
const WHEN_COLOR: Record<WhenTone, string> = {
  late: 'hsl(var(--destructive))',
  today: 'var(--accent-ink)',
  soon: 'var(--ink-2)',
  later: 'var(--ink-2)',
}

function Row({
  row,
  onToggle,
}: {
  row: TodayViewRow
  onToggle: (row: TodayViewRow) => void
}) {
  return (
    <li className={row.done ? 'mb-row mb-done' : 'mb-row'}>
      <button
        type="button"
        className="mb-chk"
        role="checkbox"
        aria-checked={row.done}
        aria-label={`Mark task ${row.done ? 'not done' : 'done'}: ${row.title}`}
        onClick={() => onToggle(row)}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 5.2l2 2 4-4.4" />
        </svg>
      </button>
      <i
        className="mb-dot"
        style={{ background: catColor(row.catName) }}
        aria-hidden="true"
      />
      <span className="mb-ttl" title={row.title}>
        {row.done ? <span className="sr-only">Done: </span> : null}
        {row.title}
      </span>
      {row.priority ? <PriorityChip priority={row.priority} /> : null}
      {row.when ? (
        <span
          className="mb-chip"
          style={{ color: WHEN_COLOR[row.when.tone] }}
          title={row.when.long}
        >
          {row.when.text}
        </span>
      ) : null}
      <span className="mb-chip">{fmtMin(row.minutes)}</span>
    </li>
  )
}

export default function TodayList({
  view,
  offline,
  failed,
  saveFailed,
  onToggle,
}: {
  /** `null` until the first load lands. */
  view: TodayView | null
  offline: boolean
  failed: boolean
  /** The last check-off write failed. */
  saveFailed: boolean
  onToggle: (row: TodayViewRow) => void
}) {
  const done = view?.done ?? 0
  const total = view?.total ?? 0
  return (
    <section className="mb-sec mb-today" aria-labelledby="mb-today-h">
      <div className="mb-thead">
        <h1 id="mb-today-h" className="mb-h">
          Today
        </h1>
        {view && total > 0 ? (
          <span className="mb-cnt">
            {done} of {total} done
          </span>
        ) : null}
      </div>
      <div
        className="mb-bar"
        role="progressbar"
        aria-label="Today progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <i style={{ width: total ? `${(100 * done) / total}%` : '0%' }} />
      </div>
      {saveFailed ? (
        <p className="mb-note mb-err" role="alert">
          Could not save — retry
        </p>
      ) : null}
      {offline ? (
        <p className="mb-note">Offline — showing the last list</p>
      ) : failed ? (
        <p className="mb-note" role="alert">
          Could not refresh — showing the last list
        </p>
      ) : null}
      {view === null ? (
        <p className="mb-empty">Loading…</p>
      ) : total === 0 ? (
        <p className="mb-empty">Nothing planned today.</p>
      ) : (
        <ul className="mb-tasks">
          {view.rows.map((row) => (
            <Row key={row.id} row={row} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </section>
  )
}
