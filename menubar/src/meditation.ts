/*
 * The web view's side of meditation (chunk 96). The shell owns the reminder
 * clock and the session (`menubar/src-tauri/src/meditation.rs`); this file
 * turns the settings into due times, sends commands and holds the last
 * snapshot the shell gave. Nothing here counts time.
 *
 * `createMeditation` takes its backend (`native.ts` under Tauri), so it runs
 * under Vitest and in a browser, where every backend call answers `null`.
 */
import {
  readMeditationPrefs,
  saveMeditationPrefs,
  type MeditationPrefs,
} from './meditationPrefs'
import { dueTimes } from './meditationSchedule'

export type MeditationStatus = 'none' | 'heads_up' | 'due' | 'running'

/** `snapshot_json` in `meditation.rs` — keep the two in step. */
export type MeditationSnapshot = {
  status: MeditationStatus
  /** The reminder that is showing (heads-up or due), epoch ms. */
  dueAt: number | null
  /** Only while a session runs. */
  startedAt: number | null
  endsAt: number | null
  /** Session length in minutes. */
  length: number
  pauseSpotify: boolean
  /** The reminder after the one showing, or the next one. */
  nextDueAt: number | null
}

/** `meditation_configure`'s arguments. */
export type MeditationConfig = {
  /** Epoch ms, in order. */
  due: number[]
  headsUp: number
  length: number
  pauseSpotify: boolean
  /**
   * This Mac's offset from UTC in minutes. The shell has no time-zone code;
   * it uses this only to print a due time in the tray as `h:mm`.
   */
  utcOffset: number
}

export function idleMeditation(prefs: MeditationPrefs): MeditationSnapshot {
  return {
    status: 'none',
    dueAt: null,
    startedAt: null,
    endsAt: null,
    length: prefs.length,
    pauseSpotify: prefs.pauseSpotify,
    nextDueAt: null,
  }
}

/** What the shell is sent for these settings at `now`. */
export function configFor(prefs: MeditationPrefs, now: Date): MeditationConfig {
  return {
    due: dueTimes(prefs, now),
    headsUp: prefs.headsUp,
    length: prefs.length,
    pauseSpotify: prefs.pauseSpotify,
    utcOffset: -now.getTimezoneOffset(),
  }
}

/** `m:ss`, seconds rounded up (`countdown` in `meditation.rs`). */
export function countdownText(leftMs: number): string {
  const s = Math.ceil(Math.max(0, leftMs) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One breath in and out, in ms — the `mb-breathe` animation's length. */
export const CYCLE_MS = 10_000

/**
 * The `animation-delay` (ms, never positive) that puts an overlay at the
 * session's point of the breathing cycle, whenever that window loaded (D13).
 */
export function syncDelay(startedAt: number, now: number): number {
  const into = (((now - startedAt) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS
  return into === 0 ? 0 : -into
}

/** Each call answers the shell's new snapshot — `null` when there is no shell. */
export type MeditationBackend = {
  state: () => Promise<MeditationSnapshot | null>
  configure: (config: MeditationConfig) => Promise<MeditationSnapshot | null>
  start: () => Promise<MeditationSnapshot | null>
  snooze: (minutes: 5 | 15) => Promise<MeditationSnapshot | null>
  skip: () => Promise<MeditationSnapshot | null>
  end: () => Promise<MeditationSnapshot | null>
  /** The shell's `meditation` event: one per state change. */
  watch: (onSnapshot: (s: MeditationSnapshot) => void) => () => void
}

export type MeditationState = {
  snapshot: MeditationSnapshot
  /** When the snapshot arrived (`Date.now()`). */
  at: number
}

export function createMeditation(
  backend: MeditationBackend,
  now: () => Date = () => new Date(),
) {
  let state: MeditationState = {
    snapshot: idleMeditation(readMeditationPrefs()),
    at: now().getTime(),
  }
  let signedIn = false
  const listeners = new Set<() => void>()

  const set = (snapshot: MeditationSnapshot | null) => {
    if (!snapshot) return
    state = { snapshot, at: now().getTime() }
    for (const l of listeners) l()
  }

  async function refresh() {
    try {
      set(await backend.state())
    } catch (e) {
      console.error('menubar: meditation state not read', e)
    }
  }

  /** Send one command; a rejected one (a race with the clock) re-reads. */
  async function run(command: Promise<MeditationSnapshot | null>) {
    try {
      set(await command)
    } catch (e) {
      console.error('menubar: meditation command rejected', e)
      await refresh()
    }
  }

  async function configure(config: MeditationConfig) {
    try {
      set(await backend.configure(config))
    } catch (e) {
      console.error('menubar: meditation config rejected', e)
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
    refresh,
    /** Signed in: the next 14 days of due times go to the shell (D2). */
    signedIn() {
      signedIn = true
      return configure(configFor(readMeditationPrefs(), now()))
    },
    /**
     * Every time the popover is shown the list is sent again. A reminder
     * shows the popover, so the list refills itself while reminders happen.
     */
    async shown() {
      if (signedIn) await configure(configFor(readMeditationPrefs(), now()))
    },
    /** Signed out: any session ends and the schedule is cleared. */
    async signedOut() {
      signedIn = false
      await run(backend.end())
      await configure({ ...configFor(readMeditationPrefs(), now()), due: [] })
    },
    /** For the settings panel (chunk 97): store and reconfigure. */
    savePrefs(prefs: MeditationPrefs) {
      saveMeditationPrefs(prefs)
      return configure(configFor(prefs, now()))
    },
    startSession: () => run(backend.start()),
    snooze: (minutes: 5 | 15) => run(backend.snooze(minutes)),
    skip: () => run(backend.skip()),
    end: () => run(backend.end()),
    /** ⌥⇧M (D8): a session now, due or not. The shell refuses a second one. */
    async hotkey() {
      if (signedIn) await run(backend.start())
    },
    /**
     * ⌥⇧F's guard (D8): while a session runs the focus hotkey does nothing.
     * Decided on the shell's state, read now.
     */
    async unlessRunning(action: () => Promise<void>) {
      let running = false
      try {
        running = (await backend.state())?.status === 'running'
      } catch (e) {
        console.error('menubar: meditation state not read', e)
      }
      if (!running) await action()
    },
  }
}

export type Meditation = ReturnType<typeof createMeditation>
