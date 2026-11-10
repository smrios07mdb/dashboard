/*
 * Menu bar popover (chunk 91): sign-in by code, then the Today list.
 */
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Toaster } from 'sonner'

import { repo } from '@/db/repo'
import { useSession } from '@/lib/auth'
import { signOutUser } from '@/lib/signOutCleanup'
import { offerCompleteUndo } from '@/lib/taskUndo'
import { startSyncRunner } from '@/lib/syncRunner'

import { createCheckOff, type CheckOff, type CheckOffState } from './checkOff'

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
import {
  nextTheme,
  readTheme,
  saveTheme,
  THEME_LABEL,
  watchSystemTheme,
  type ThemeChoice,
} from './theme'
import TodayList from './TodayList'
import { applyOptimistic, type TodayView } from './todayView'

type TodayState = { view: TodayView | null; offline: boolean; failed: boolean }

const NOT_LOADED: TodayState = { view: null, offline: false, failed: false }

type Loaded = { userId: string } & TodayState

/**
 * One signed-in user's popover state: the Today refresher and the check-off
 * controller (chunk 92), built together so a check-off can refresh the list
 * and the list keeps what was checked off here. Building it starts nothing;
 * `start` does, and its cleanup stops it.
 */
function createSession(userId: string, onLoaded: (l: Loaded) => void) {
  let cancelled = false
  const checkOff: CheckOff = createCheckOff({
    write: (id, completed) => repo.tasks.markComplete(id, completed),
    refresh: () => refresher.refresh(),
    // Undo is the Dashboard's own toast (lib/taskUndo).
    onCompleted: (before) =>
      offerCompleteUndo({
        before: [before],
        onRestored: () => void refresher.refresh(),
      }),
  })
  let last: Loaded = { userId, ...NOT_LOADED }
  const refresher = createRefresher(async () => {
    try {
      const { view, offline } = await loadToday(
        userId,
        checkOff.getState().kept,
      )
      if (cancelled) return
      last = { userId, view, offline, failed: false }
      onLoaded(last)
      setTrayTitle(view.trayTitle)
    } catch (e) {
      console.error('menubar: Today load failed', e)
      if (cancelled) return
      last = { ...last, failed: true }
      onLoaded(last)
    }
  })
  return {
    userId,
    checkOff,
    /** Restartable (StrictMode runs effects twice): stop pauses, never disposes. */
    start() {
      cancelled = false
      // One load at start, shown or not, so the tray carries the count
      // before the popover is first opened.
      void refresher.refresh()
      const unwatch = watchPopover(refresher.setShown)
      return () => {
        cancelled = true
        unwatch()
        refresher.setShown(false)
      }
    },
  }
}

const IDLE: CheckOffState = {
  optimistic: new Map(),
  failed: false,
  kept: new Set(),
}
const idleSubscribe = () => () => {}
const idleState = () => IDLE

export default function App() {
  const { user, loading } = useSession()
  const userId = user?.id ?? null
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const session = useMemo(
    () => (userId ? createSession(userId, setLoaded) : null),
    [userId],
  )
  useEffect(() => session?.start(), [session])
  const co = useSyncExternalStore(
    session?.checkOff.subscribe ?? idleSubscribe,
    session?.checkOff.getState ?? idleState,
  )
  // Another account's list is never shown: state is keyed by user.
  const today: TodayState =
    loaded && loaded.userId === userId ? loaded : NOT_LOADED
  const popRef = useRef<HTMLDivElement | null>(null)
  const [theme, setTheme] = useState<ThemeChoice>(readTheme)

  useEffect(() => watchSystemTheme(theme), [theme])

  function cycleTheme() {
    const next = nextTheme(theme)
    saveTheme(next)
    setTheme(next)
  }

  // Writes made offline sit in this web view's own outbox (its IndexedDB is
  // not the PWA's), so the popover replays them itself (chunk 92).
  useEffect(() => {
    if (!userId) return
    const runner = startSyncRunner()
    return () => runner.stop()
  }, [userId])

  const view =
    today.view && applyOptimistic(today.view, co.optimistic)

  // The tray follows a check-off at once, before the refresh lands.
  useEffect(() => {
    if (view) setTrayTitle(view.trayTitle)
  }, [view])

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
          view={view}
          offline={today.offline}
          failed={today.failed}
          saveFailed={co.failed}
          onToggle={(row) => void session?.checkOff.toggle(row.task)}
        />
      ) : (
        <SignIn />
      )}
      <footer className="mb-foot">
        <button type="button" className="mb-foot-btn" onClick={openDashboard}>
          Open dashboard
        </button>
        <span className="mb-sp" />
        <button
          type="button"
          className="mb-foot-btn"
          onClick={cycleTheme}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Change theme`}
          title="Auto follows macOS"
        >
          Theme: {THEME_LABEL[theme]}
        </button>
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
      {/* The Dashboard's Undo toast (chunk 92). Top of the popover: the
          window is only as tall as its content. */}
      <Toaster
        theme={theme === 'auto' ? 'system' : theme}
        position="top-center"
        offset={8}
        closeButton
        // sonner's default 356 px is wider than the 340 px popover.
        style={{ '--width': '316px' } as CSSProperties}
      />
    </div>
  )
}
