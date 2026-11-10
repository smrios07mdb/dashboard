/*
 * The web view's side of the pomodoro (chunk 94). The shell owns the timer
 * (`menubar/src-tauri/src/pomodoro.rs`): this file only sends commands,
 * holds the last snapshot the shell gave, and formats it. Nothing here
 * counts time, and nothing about a running session is stored — a snapshot
 * carries a wall-clock `endsAt`, and what is left is always `endsAt − now`.
 *
 * `createPomodoro` takes its backend (`native.ts` under Tauri), so it runs
 * under Vitest and in a browser, where every backend call answers `null`
 * and the state stays idle.
 */
import {
  readPomodoroPrefs,
  savePomodoroPrefs,
  type PomodoroConfig,
} from './pomodoroPrefs'

export type PomodoroPhase = 'idle' | 'focus' | 'short_break' | 'long_break'

export type PomodoroTask = { id: string; title: string }

/** `snapshot_json` in `pomodoro.rs` — keep the two in step. */
export type PomodoroSnapshot = {
  phase: PomodoroPhase
  /** Only in focus and the breaks. */
  paused: boolean
  /** Epoch ms; null unless a phase is running. */
  endsAt: number | null
  /** The phase's whole length, for the ring. */
  phaseLenMs: number
  /** Time left when the snapshot was taken; what a paused phase shows. */
  remainingMs: number
  /** 1..=`config.every`. */
  cyclePos: number
  task: PomodoroTask | null
  config: PomodoroConfig
}

export function idleSnapshot(config: PomodoroConfig): PomodoroSnapshot {
  return {
    phase: 'idle',
    paused: false,
    endsAt: null,
    phaseLenMs: 0,
    remainingMs: 0,
    cyclePos: 1,
    task: null,
    config,
  }
}

/** Time left at `now`: from `endsAt` while running, frozen otherwise. */
export function remainingAt(s: PomodoroSnapshot, now: number): number {
  if (s.phase === 'idle') return 0
  if (s.paused || s.endsAt === null) return s.remainingMs
  return Math.max(0, s.endsAt - now)
}

/** The tray's format (`clock` in `pomodoro.rs`): seconds rounded up. */
export function clockText(remainingMs: number): string {
  const s = Math.ceil(Math.max(0, remainingMs) / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
  }
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`
}

/** Each call answers the shell's new snapshot — `null` when there is no shell. */
export type PomodoroBackend = {
  state: () => Promise<PomodoroSnapshot | null>
  configure: (config: PomodoroConfig) => Promise<PomodoroSnapshot | null>
  start: (task: PomodoroTask | null) => Promise<PomodoroSnapshot | null>
  pause: () => Promise<PomodoroSnapshot | null>
  resume: () => Promise<PomodoroSnapshot | null>
  extend: () => Promise<PomodoroSnapshot | null>
  skip: () => Promise<PomodoroSnapshot | null>
  stop: () => Promise<PomodoroSnapshot | null>
  /** The shell's `pomodoro` event: one per state change. */
  watch: (onSnapshot: (s: PomodoroSnapshot) => void) => () => void
}

export type PomodoroState = {
  snapshot: PomodoroSnapshot
  /** When the snapshot arrived (`Date.now()`), so a draw is never behind it. */
  at: number
}

export function createPomodoro(
  backend: PomodoroBackend,
  now: () => number = () => Date.now(),
) {
  let state: PomodoroState = {
    snapshot: idleSnapshot(readPomodoroPrefs()),
    at: now(),
  }
  let signedIn = false
  const listeners = new Set<() => void>()

  const set = (snapshot: PomodoroSnapshot | null) => {
    if (!snapshot) return
    state = { snapshot, at: now() }
    for (const l of listeners) l()
  }

  async function refresh() {
    try {
      set(await backend.state())
    } catch (e) {
      console.error('menubar: pomodoro state not read', e)
    }
  }

  /** Send one command; a rejected one (a race with the timer) re-reads. */
  async function run(command: Promise<PomodoroSnapshot | null>) {
    try {
      set(await command)
    } catch (e) {
      console.error('menubar: pomodoro command rejected', e)
      await refresh()
    }
  }

  async function configure(config: PomodoroConfig) {
    try {
      const snapshot = await backend.configure(config)
      // No shell (a browser): the idle row still follows the settings.
      set(snapshot ?? { ...state.snapshot, config })
    } catch (e) {
      console.error('menubar: pomodoro config rejected', e)
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Follow the shell's events and read the state once. Restartable. */
    start() {
      const unwatch = backend.watch(set)
      void refresh()
      return unwatch
    },
    /** Re-read — on every popover show, since an event may have been missed. */
    refresh,
    /** Signed in: the stored settings go to the shell (D7). */
    signedIn() {
      signedIn = true
      return configure(readPomodoroPrefs())
    },
    /** Signed out: any session ends (D11). */
    signedOut() {
      signedIn = false
      return run(backend.stop())
    },
    saveConfig(config: PomodoroConfig) {
      savePomodoroPrefs(config)
      return configure(config)
    },
    startFocus: (task: PomodoroTask | null) => run(backend.start(task)),
    pause: () => run(backend.pause()),
    resume: () => run(backend.resume()),
    extend: () => run(backend.extend()),
    skip: () => run(backend.skip()),
    stop: () => run(backend.stop()),
    /**
     * The hotkey (D10): paused → resume; focus running → pause; idle or a
     * break → a bare focus. Decided on the shell's state, read now — this
     * web view may have been suspended since its last snapshot.
     */
    async toggle() {
      if (!signedIn) return
      let s = state.snapshot
      try {
        s = (await backend.state()) ?? s
      } catch (e) {
        console.error('menubar: pomodoro state not read', e)
      }
      if (s.phase !== 'idle' && s.paused) await run(backend.resume())
      else if (s.phase === 'focus') await run(backend.pause())
      else await run(backend.start(null))
    },
  }
}

export type Pomodoro = ReturnType<typeof createPomodoro>
