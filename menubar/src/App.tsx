/*
 * Menu bar popover (chunk 91): sign-in by code, then the focus header
 * (chunk 94) over two tabs — the Today list and the scratchpad (chunk 93),
 * which ⌥H opens from anywhere — and the Sound section (chunk 95) under them.
 * A meditation reminder (chunk 96) sits above it all while one is showing.
 * The footer's Settings button (chunk 97) swaps everything under that
 * reminder for the Settings view. Finished focus and breathing sessions
 * (chunk 98) are written from here, with nothing to show for it.
 */
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'
import { Toaster } from 'sonner'

import { isClientError, repo } from '@/db/repo'
import { useSession } from '@/lib/auth'
import { signOutUser } from '@/lib/signOutCleanup'
import { offerCompleteUndo } from '@/lib/taskUndo'
import { startSyncRunner } from '@/lib/syncRunner'

import { createCheckOff, type CheckOff, type CheckOffState } from './checkOff'
import FocusHeader from './FocusHeader'
import { createHotkeys } from './hotkeys'
import { loadToday } from './loadToday'
import { createMeditation } from './meditation'
import MeditationPanel from './MeditationPanel'
import {
  hidePopover,
  meditationConfigure,
  meditationEnd,
  meditationSkip,
  meditationSnooze,
  meditationStart,
  meditationState,
  openDashboard,
  pomodoroConfigure,
  pomodoroExtend,
  pomodoroPause,
  pomodoroResume,
  pomodoroSkip,
  pomodoroStart,
  pomodoroState,
  pomodoroStop,
  popoverIsShown,
  quitApp,
  registerShortcut,
  sessionsAck,
  sessionsClear,
  sessionsPending,
  setPopoverHeight,
  setTrayTitle,
  showPopover,
  soundConfigure,
  unregisterShortcut,
  watchMeditation,
  watchPomodoro,
  watchPopover,
  watchSessions,
} from './native'
import { createPomodoro } from './pomodoro'
import PopoverTabs from './PopoverTabs'
import { saveTab } from './prefs'
import { createRefresher } from './refresher'
import Scratchpad from './ScratchpadTab'
import {
  NO_LIST,
  sendScratch,
  type ScratchLists,
  type ScratchResult,
} from './scratchpad'
import { createSessionSync } from './sessions'
import SettingsView from './SettingsView'
import SignIn from './SignIn'
import { presetFor } from './sound'
import { readSoundPrefs } from './soundPrefs'
import SoundSection from './SoundSection'
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

type TodayState = {
  view: TodayView | null
  offline: boolean
  failed: boolean
  /** The last load's lists, for the scratchpad (chunk 93). */
  lists: ScratchLists | null
}

const NOT_LOADED: TodayState = {
  view: null,
  offline: false,
  failed: false,
  lists: null,
}

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
      const { view, offline, lists } = await loadToday(
        userId,
        checkOff.getState().kept,
      )
      if (cancelled) return
      last = { userId, view, offline, failed: false, lists }
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
    refresh: () => refresher.refresh(),
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

/** Quit and Sign out wait this long for the saved sessions, then go on. */
const DRAIN_MS = 3000

const IDLE: CheckOffState = {
  optimistic: new Map(),
  failed: false,
  kept: new Set(),
}
const idleSubscribe = () => () => {}
const idleState = () => IDLE

/**
 * The scratchpad hotkey (D6): hide the popover if it is shown; otherwise
 * switch to Scratchpad and focus the pad (committed synchronously, before
 * the window appears), then ask the shell to show it under the tray icon.
 */
async function toggleScratchpad(bump: () => void) {
  try {
    if (await popoverIsShown()) {
      hidePopover()
      return
    }
    saveTab('scratchpad')
    flushSync(bump)
    await showPopover()
  } catch (e) {
    console.error('menubar: hotkey toggle failed', e)
  }
}

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
  // Bumped by the hotkey: forces the Scratchpad tab and focuses the pad.
  const [forceScratch, setForceScratch] = useState(0)
  // The Settings view (chunk 97, D1). Closed by Done, Esc, the popover
  // hiding and ⌥H; closing remounts the Sound section, which rereads.
  const [settings, setSettings] = useState(false)
  const closeSettings = useCallback(() => setSettings(false), [])
  // The pomodoro (chunk 94): the shell owns the timer; this holds its last
  // snapshot and sends commands.
  const [pomodoro] = useState(() =>
    createPomodoro({
      state: pomodoroState,
      configure: pomodoroConfigure,
      start: pomodoroStart,
      pause: pomodoroPause,
      resume: pomodoroResume,
      extend: pomodoroExtend,
      skip: pomodoroSkip,
      stop: pomodoroStop,
      watch: watchPomodoro,
    }),
  )
  const pomo = useSyncExternalStore(pomodoro.subscribe, pomodoro.getState)
  // Meditation (chunk 96): the shell owns the reminder clock and the
  // session; this computes the due times and sends commands.
  const [meditation] = useState(() =>
    createMeditation({
      state: meditationState,
      configure: meditationConfigure,
      start: meditationStart,
      snooze: meditationSnooze,
      skip: meditationSkip,
      end: meditationEnd,
      watch: watchMeditation,
    }),
  )
  const [hotkeys] = useState(() =>
    createHotkeys(
      { register: registerShortcut, unregister: unregisterShortcut },
      {
        scratchpad: () =>
          void toggleScratchpad(() => {
            setSettings(false)
            setForceScratch((n) => n + 1)
          }),
        // Start or pause focus (D10); never opens the popover. While a
        // breathing session runs it does nothing (chunk 96, D8).
        focus: () => void meditation.unlessRunning(() => pomodoro.toggle()),
        // A breathing session now, due or not (chunk 96, D8).
        meditate: () => void meditation.hotkey(),
      },
    ),
  )
  const hk = useSyncExternalStore(hotkeys.subscribe, hotkeys.getState)
  // Saved sessions (chunk 98): the shell keeps each finished focus phase and
  // breathing session until this has written it. Signed in only.
  const sessions = useMemo(
    () =>
      userId
        ? createSessionSync({
            pending: sessionsPending,
            ack: sessionsAck,
            clear: sessionsClear,
            write: (row) => repo.trackedSessions.save(row),
            isClientError,
            userId,
          })
        : null,
    [userId],
  )
  // A session just ended, or the popover is shown: write what is waiting.
  useEffect(() => {
    if (!sessions) return
    const offEvent = watchSessions(() => void sessions.drain())
    const offShown = watchPopover((shown) => {
      if (shown) void sessions.drain()
    })
    return () => {
      offEvent()
      offShown()
    }
  }, [sessions])

  useEffect(() => {
    void hotkeys.start()
    return () => void hotkeys.stop()
  }, [hotkeys])

  async function send(text: string): Promise<ScratchResult> {
    if (!session || !today.lists) {
      return { leftover: text, sent: 0, result: NO_LIST }
    }
    const r = await sendScratch(
      text,
      { ...today.lists, userId: session.userId, now: new Date() },
      (input) => repo.tasks.create(input),
    )
    // A `p1` or `today` line belongs in Today at once; the tray follows.
    if (r.sent > 0) void session.refresh()
    return r
  }

  // Hidden: the Settings view closes (D1).
  useEffect(
    () =>
      watchPopover((shown) => {
        if (!shown) setSettings(false)
      }),
    [],
  )

  useEffect(() => pomodoro.start(), [pomodoro])
  useEffect(() => meditation.start(), [meditation])
  // Every show sends the next 14 days of due times again (chunk 96, D2).
  useEffect(
    () =>
      watchPopover((shown) => {
        if (shown) void meditation.shown()
      }),
    [meditation],
  )

  // Signed in: the stored settings go to the shell (D7). Signed out: any
  // session ends (D11) and the tray falls back to the empty idle title.
  useEffect(() => {
    if (loading) return
    if (userId) {
      void pomodoro.signedIn()
      // Sound (chunk 95, D11): play on focus or not, and the preset.
      const sound = readSoundPrefs()
      // His own playlist behind the preset, if he set one (chunk 97, D5).
      void soundConfigure(sound.auto, presetFor(sound, sound.preset).uri)
      // Meditation (chunk 96, D2): reminders run only while signed in.
      void meditation.signedIn()
      // Saved sessions (chunk 98): whatever a previous run left behind.
      void sessions?.drain()
    } else {
      // The stop and the end can each put one last session in the ledger;
      // it is emptied after them (chunk 98, D15), so the next account never
      // receives this one's entries.
      void Promise.allSettled([
        pomodoro.signedOut(),
        meditation.signedOut(),
      ]).then(() =>
        sessionsClear().catch((e: unknown) =>
          console.error('menubar: sessions not cleared', e),
        ),
      )
    }
  }, [loading, userId, pomodoro, meditation, sessions])

  // Quit and Sign out first stop the focus and end the breathing, so a
  // session still running reaches the ledger (60 s or more, as always), then
  // write what is waiting, giving up after 3 s (chunk 98 gate).
  async function stopRunning() {
    await Promise.allSettled([pomodoro.signedOut(), meditation.signedOut()])
  }
  async function quit() {
    await stopRunning()
    await sessions?.drainWithin(DRAIN_MS)
    quitApp()
  }
  async function signOut() {
    await stopRunning()
    await sessions?.drainWithin(DRAIN_MS)
    await signOutUser()
  }

  useEffect(() => watchSystemTheme(theme), [theme])

  function chooseTheme(next: ThemeChoice) {
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
      // The pad handles its own Esc (and marks it handled).
      if (e.key === 'Escape' && !e.defaultPrevented) hidePopover()
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
        <>
          <MeditationPanel
            meditation={meditation}
            hotkey={hk.bound.meditate}
            hotkeyError={hk.failed.meditate ?? null}
          />
          {settings ? (
            <SettingsView
              pomodoro={pomodoro}
              meditation={meditation}
              hotkeys={hotkeys}
              theme={theme}
              onTheme={chooseTheme}
              onDone={closeSettings}
            />
          ) : (
            <>
              <FocusHeader
                pomodoro={pomodoro}
                timeZone={today.lists?.timeZone ?? 'America/New_York'}
                hotkeyError={hk.failed.focus ?? null}
              />
              <PopoverTabs
                todayCount={view ? `${view.done}/${view.total}` : null}
                forceScratch={forceScratch}
                today={
                  <TodayList
                    view={view}
                    offline={today.offline}
                    failed={today.failed}
                    saveFailed={co.failed}
                    onToggle={(row) => void session?.checkOff.toggle(row.task)}
                    focus={{
                      phase: pomo.snapshot.phase,
                      paused: pomo.snapshot.paused,
                      taskId: pomo.snapshot.task?.id ?? null,
                    }}
                    onFocus={(row) =>
                      void pomodoro.startFocus({ id: row.id, title: row.title })
                    }
                  />
                }
                scratchpad={
                  <Scratchpad
                    lists={today.lists}
                    userId={userId}
                    send={send}
                    hotkeyError={hk.failed.scratchpad ?? null}
                    focusSeq={forceScratch}
                    onHide={hidePopover}
                  />
                }
              />
              <SoundSection />
            </>
          )}
        </>
      ) : (
        <SignIn />
      )}
      <footer className="mb-foot">
        <button type="button" className="mb-foot-btn" onClick={openDashboard}>
          Open dashboard
        </button>
        <span className="mb-sp" />
        {userId ? (
          <>
            {/* Signed in, Theme lives in Settings › General (D3). */}
            <button
              type="button"
              className="mb-foot-btn"
              aria-expanded={settings}
              onClick={() => setSettings((open) => !open)}
            >
              Settings
            </button>
            <button
              type="button"
              className="mb-foot-btn"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            className="mb-foot-btn"
            onClick={() => chooseTheme(nextTheme(theme))}
            aria-label={`Theme: ${THEME_LABEL[theme]}. Change theme`}
            title="Auto follows macOS"
          >
            Theme: {THEME_LABEL[theme]}
          </button>
        )}
        <button type="button" className="mb-foot-btn" onClick={() => void quit()}>
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
