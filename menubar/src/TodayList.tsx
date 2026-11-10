/*
 * The Today list (chunk 91, D5). Row order is `resolveToday`'s; nothing
 * here sorts or filters. Each row checks off (chunk 92) through `onToggle`.
 * A not-done row starts a focus session on itself (chunk 94, D9) through
 * `onFocus`; the row being focused shows the design's bars instead.
 */
import PriorityChip from '@/components/PriorityChip'
import { catColor, fmtMin } from '@/lib/cat'
import type { WhenTone } from '@/lib/whenLabel'

import type { PomodoroPhase } from './pomodoro'
import type { TodayView, TodayViewRow } from './todayView'

/** What the rows need of the pomodoro (chunk 94). */
export type TodayFocus = {
  phase: PomodoroPhase
  paused: boolean
  /** The task a session was started on; null for a bare one. */
  taskId: string | null
}

const NO_FOCUS: TodayFocus = { phase: 'idle', paused: false, taskId: null }

// TaskRow's when-chip tones.
const WHEN_COLOR: Record<WhenTone, string> = {
  late: 'hsl(var(--destructive))',
  today: 'var(--accent-ink)',
  soon: 'var(--ink-2)',
  later: 'var(--ink-2)',
}

function Row({
  row,
  focus,
  onToggle,
  onFocus,
}: {
  row: TodayViewRow
  focus: TodayFocus
  onToggle: (row: TodayViewRow) => void
  onFocus: (row: TodayViewRow) => void
}) {
  const inFocus = focus.phase === 'focus'
  // Checking the task off does not end its session: the bars stay.
  const focusing = inFocus && focus.taskId === row.id
  const className = ['mb-row', row.done && 'mb-done', focusing && 'mb-cur']
    .filter(Boolean)
    .join(' ')
  return (
    <li className={className}>
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
      {focusing ? (
        <span
          className={focus.paused ? 'mb-eq mb-eq-still' : 'mb-eq'}
          role="img"
          aria-label="Focusing"
        >
          <i />
          <i />
          <i />
        </span>
      ) : !row.done && !inFocus ? (
        // Idle or in a break; hidden while focus is running or paused.
        <button
          type="button"
          className="mb-go"
          aria-label={`Focus on ${row.title}`}
          onClick={() => onFocus(row)}
        >
          <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true">
            <path d="M1 .8v8.4L8.2 5z" fill="currentColor" />
          </svg>
        </button>
      ) : (
        // Keeps the chips in one column.
        <span className="mb-go-gap" aria-hidden="true" />
      )}
    </li>
  )
}

export default function TodayList({
  view,
  offline,
  failed,
  saveFailed,
  onToggle,
  focus = NO_FOCUS,
  onFocus,
}: {
  /** `null` until the first load lands. */
  view: TodayView | null
  offline: boolean
  failed: boolean
  /** The last check-off write failed. */
  saveFailed: boolean
  onToggle: (row: TodayViewRow) => void
  focus?: TodayFocus
  /** Start a focus session on this row's task. */
  onFocus: (row: TodayViewRow) => void
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
            <Row
              key={row.id}
              row={row}
              focus={focus}
              onToggle={onToggle}
              onFocus={onFocus}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
