/*
 * The Today list (chunk 91, D5) — read-only this chunk. Row order is
 * `resolveToday`'s; nothing here sorts or filters.
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

function Row({ row }: { row: TodayViewRow }) {
  return (
    <li className={row.done ? 'mb-row mb-done' : 'mb-row'}>
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
}: {
  /** `null` until the first load lands. */
  view: TodayView | null
  offline: boolean
  failed: boolean
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
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}
