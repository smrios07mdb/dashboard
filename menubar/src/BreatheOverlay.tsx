/*
 * The breathing overlay (chunk 96, D13): what each `breathe-<n>` window
 * shows while a session runs — the prototype's `.veil`. `main.tsx` renders
 * only this when the page is loaded at `#breathe`: no App, no Supabase.
 *
 * The shell owns the session. Every window reads the same `startedAt` and
 * gives its animations a negative delay from it, so all displays breathe
 * together whenever each one loaded. The time left is `endsAt − now`, never
 * counted. Esc ends the session here too, besides the shell's global Esc.
 */
import { type CSSProperties, useEffect, useState } from 'react'

import {
  countdownText,
  syncDelay,
  type MeditationSnapshot,
} from './meditation'
import { meditationEnd, meditationState, watchMeditation } from './native'

type Session = { startedAt: number; endsAt: number; delay: number }

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export default function BreatheOverlay() {
  const [session, setSession] = useState<Session | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [still] = useState(reducedMotion)

  useEffect(() => {
    let live = true
    const take = (s: MeditationSnapshot | null) => {
      if (!live || !s) return
      const { startedAt, endsAt } = s
      if (s.status !== 'running' || startedAt === null || endsAt === null) {
        setSession(null)
        return
      }
      setNow(Date.now())
      // The delay is fixed once per session: a later snapshot of the same
      // one must not shift animations that are already running.
      setSession((prev) =>
        prev && prev.startedAt === startedAt
          ? { ...prev, endsAt }
          : { startedAt, endsAt, delay: syncDelay(startedAt, Date.now()) },
      )
    }
    const unwatch = watchMeditation(take)
    meditationState()
      .then(take)
      .catch((e: unknown) => console.error('menubar: session not read', e))
    return () => {
      live = false
      unwatch()
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      meditationEnd().catch((e: unknown) =>
        console.error('menubar: session not ended', e),
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // One redraw a second, on the second, for the time left.
  const endsAt = session?.endsAt ?? null
  useEffect(() => {
    if (endsAt === null) return
    const redraw = () => setNow(Date.now())
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
  }, [endsAt])

  const style =
    session && !still
      ? ({ '--bo-delay': `${session.delay}ms` } as CSSProperties)
      : undefined

  return (
    <main
      className="bo-veil"
      data-still={still ? 'true' : undefined}
      style={style}
      aria-label="Breathing session"
    >
      {session ? (
        // Keyed by session, so a new one starts its animations afresh.
        <div className="bo-stage" key={session.startedAt}>
          <div className="bo-orbwrap">
            <div className="bo-orb" />
          </div>
          <div className="bo-words">
            <span className="bo-in">Breathe in</span>
            {still ? null : <span className="bo-out">Breathe out</span>}
          </div>
          <div className="bo-left" role="timer">
            {countdownText(session.endsAt - now)} LEFT · ESC TO END
          </div>
        </div>
      ) : null}
    </main>
  )
}
