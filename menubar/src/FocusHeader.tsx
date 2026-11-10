/*
 * The focus header (chunk 94, D8), above the tabs. Idle: one slim row with
 * the focus length and Start focus. In a session: the design's block — ring,
 * `n OF every`, label, the big countdown, the task, the controls.
 *
 * The shell owns the timer. This only draws its last snapshot: the countdown
 * is `endsAt − now`, redrawn once a second and only while the popover is
 * shown; hidden, no timer runs here. Every show re-reads the state, since an
 * event may have been missed while the web view was suspended.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

import { timeText } from '@/lib/whenLabel'

import { watchPopover } from './native'
import {
  clockText,
  remainingAt,
  type Pomodoro,
  type PomodoroPhase,
} from './pomodoro'

const PHASE_NAME: Record<Exclude<PomodoroPhase, 'idle'>, string> = {
  focus: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
}

/** The ring's circumference: r 36 in the 84 px view box. */
const RING = 226.2

export default function FocusHeader({
  pomodoro,
  timeZone,
  hotkeyError,
}: {
  pomodoro: Pomodoro
  /** The Settings zone, for the `ends …` time. */
  timeZone: string
  /** `⌥⇧F is taken by another app`, shown in the idle row. */
  hotkeyError: string | null
}) {
  const { snapshot: s, at } = useSyncExternalStore(
    pomodoro.subscribe,
    pomodoro.getState,
  )
  const [shown, setShown] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(
    () =>
      watchPopover((isShown) => {
        setShown(isShown)
        if (!isShown) return
        setTick(Date.now())
        void pomodoro.refresh()
      }),
    [pomodoro],
  )

  // One redraw a second, on the second, while shown and running.
  const endsAt = s.phase !== 'idle' && !s.paused ? s.endsAt : null
  useEffect(() => {
    if (!shown || endsAt === null) return
    const redraw = () => setTick(Date.now())
    let interval: number | undefined
    const toNextSecond = (((endsAt - Date.now()) % 1000) + 1000) % 1000
    const lead = window.setTimeout(() => {
      redraw()
      interval = window.setInterval(redraw, 1000)
    }, toNextSecond)
    return () => {
      window.clearTimeout(lead)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [shown, endsAt])

  if (s.phase === 'idle') {
    return (
      <section className="mb-focus mb-focus-idle" aria-label="Focus">
        <span className="mb-lab">Focus · {s.config.focus} min</span>
        {hotkeyError ? (
          <span className="mb-focus-warn" role="status">
            {hotkeyError}
          </span>
        ) : null}
        <button
          type="button"
          className="mb-fbtn mb-fbtn-pri"
          onClick={() => void pomodoro.startFocus(null)}
        >
          Start focus
        </button>
      </section>
    )
  }

  const focus = s.phase === 'focus'
  const left = remainingAt(s, Math.max(tick, at))
  const done = s.phaseLenMs > 0 ? 1 - Math.min(1, left / s.phaseLenMs) : 0
  const label =
    s.paused || s.endsAt === null
      ? 'Paused'
      : `${PHASE_NAME[s.phase]} · ends ${timeText(new Date(s.endsAt), timeZone)}`
  const title = s.task?.title ?? (focus ? 'Focus' : 'Break')

  return (
    <section
      className="mb-focus"
      data-phase={focus ? 'focus' : 'break'}
      aria-label={focus ? 'Focus session' : 'Break'}
    >
      <div className="mb-ring">
        <svg viewBox="0 0 84 84" aria-hidden="true">
          <defs>
            <linearGradient id="mb-ring-g">
              <stop className="mb-ring-s1" offset="0" />
              <stop className="mb-ring-s2" offset="1" />
            </linearGradient>
          </defs>
          <circle
            className="mb-ring-track"
            cx="42"
            cy="42"
            r="36"
            fill="none"
            strokeWidth="7"
          />
          <circle
            className="mb-ring-prog"
            cx="42"
            cy="42"
            r="36"
            fill="none"
            stroke="url(#mb-ring-g)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={(RING * (1 - done)).toFixed(1)}
          />
        </svg>
        <div className="mb-ring-mid">
          <span className="mb-ring-n">{s.cyclePos}</span>
          <span className="mb-ring-of">OF {s.config.every}</span>
        </div>
      </div>
      <div className="mb-fbody">
        <span className="mb-lab">{label}</span>
        <span className="mb-time" role="timer" aria-label="Time left">
          {clockText(left)}
        </span>
        <span className="mb-ftask" title={title}>
          {title}
        </span>
        <div className="mb-fctl">
          <button
            type="button"
            className="mb-fbtn mb-fbtn-pri"
            onClick={() =>
              void (s.paused ? pomodoro.resume() : pomodoro.pause())
            }
          >
            {s.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="mb-fbtn"
            onClick={() => void pomodoro.extend()}
          >
            +5 min
          </button>
          <button
            type="button"
            className="mb-fbtn"
            onClick={() => void pomodoro.skip()}
          >
            {focus ? 'Skip to break' : 'Skip break'}
          </button>
          {focus ? (
            <button
              type="button"
              className="mb-fbtn"
              onClick={() => void pomodoro.stop()}
            >
              End
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
