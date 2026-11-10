/*
 * Menu bar popover (chunk 91): sign-in by code, then the Today list.
 */
import { useEffect, useRef, useState } from 'react'

import { useSession } from '@/lib/auth'
import { signOutUser } from '@/lib/signOutCleanup'

import { loadToday } from './loadToday'
import {
  hidePopover,
  openDashboard,
  quitApp,
  setPopoverHeight,
  setTrayTitle,
  watchPopover,
} from './native'
import { createRefresher } from './refresher'
import SignIn from './SignIn'
import TodayList from './TodayList'
import type { TodayView } from './todayView'

type TodayState = { view: TodayView | null; offline: boolean; failed: boolean }

const NOT_LOADED: TodayState = { view: null, offline: false, failed: false }

function useToday(userId: string | null): TodayState {
  const [state, setState] = useState<{ userId: string | null } & TodayState>({
    userId: null,
    ...NOT_LOADED,
  })

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const refresher = createRefresher(async () => {
      try {
        const { view, offline } = await loadToday(userId)
        if (cancelled) return
        setState({ userId, view, offline, failed: false })
        setTrayTitle(view.trayTitle)
      } catch (e) {
        console.error('menubar: Today load failed', e)
        if (cancelled) return
        setState((s) =>
          s.userId === userId
            ? { ...s, failed: true }
            : { userId, ...NOT_LOADED, failed: true },
        )
      }
    })
    // One load at start, shown or not, so the tray carries the count before
    // the popover is first opened.
    void refresher.refresh()
    const unwatch = watchPopover(refresher.setShown)
    return () => {
      cancelled = true
      unwatch()
      refresher.dispose()
    }
  }, [userId])

  // Another account's list is never shown: state is keyed by user.
  return state.userId === userId ? state : NOT_LOADED
}

export default function App() {
  const { user, loading } = useSession()
  const userId = user?.id ?? null
  const today = useToday(userId)
  const popRef = useRef<HTMLDivElement | null>(null)

  // Signed out: the tray shows no count.
  useEffect(() => {
    if (!loading && !userId) setTrayTitle('')
  }, [loading, userId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') hidePopover()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The window is as tall as its content (the shell clamps it).
  useEffect(() => {
    const el = popRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const report = () =>
      setPopoverHeight(Math.ceil(el.getBoundingClientRect().height))
    const observer = new ResizeObserver(report)
    observer.observe(el)
    report()
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={popRef} className="mb-pop">
      {loading ? (
        <div className="mb-sec">
          <p className="mb-empty">Loading…</p>
        </div>
      ) : userId ? (
        <TodayList
          view={today.view}
          offline={today.offline}
          failed={today.failed}
        />
      ) : (
        <SignIn />
      )}
      <footer className="mb-foot">
        <button type="button" className="mb-foot-btn" onClick={openDashboard}>
          Open dashboard
        </button>
        <span className="mb-sp" />
        {userId ? (
          <button
            type="button"
            className="mb-foot-btn"
            onClick={() => void signOutUser()}
          >
            Sign out
          </button>
        ) : null}
        <button type="button" className="mb-foot-btn" onClick={quitApp}>
          Quit
        </button>
      </footer>
    </div>
  )
}
