/*
 * The one seam between the popover and the Tauri shell (chunk 91).
 *
 * Every call is a no-op when `window.__TAURI_INTERNALS__` is absent, so the
 * same bundle runs in a normal browser (`npm run menubar:dev`) and under
 * Vitest. The commands are defined in `menubar/src-tauri/src/lib.rs`.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  register as registerGlobal,
  unregister as unregisterGlobal,
} from '@tauri-apps/plugin-global-shortcut'

import type { MeditationConfig, MeditationSnapshot } from './meditation'
import type { PomodoroSnapshot, PomodoroTask } from './pomodoro'
import type { PomodoroConfig } from './pomodoroPrefs'
import type { SpotifyState } from './sound'

/** The live PWA — the fallback target when there is no shell to open it. */
export const DASHBOARD_URL = 'https://smrios07mdb.github.io/dashboard/'

export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function call(command: string, args?: Record<string, unknown>): void {
  if (!inTauri()) return
  invoke(command, args).catch((e: unknown) => {
    console.error(`menubar: ${command} failed`, e)
  })
}

/**
 * The idle tray title — the open Today count, `''` for none or signed out.
 * Since chunk 94 the shell only stores it and shows it while no pomodoro
 * phase is on; the tray is never written from here during one.
 */
export function setTrayTitle(title: string): void {
  call('set_tray_title', { title })
}

/** Size the popover to its content (the shell clamps the value). */
export function setPopoverHeight(height: number): void {
  call('set_popover_height', { height })
}

export function hidePopover(): void {
  call('hide_popover')
}

/** Whether the popover is on screen; in a browser, the tab's visibility. */
export async function popoverIsShown(): Promise<boolean> {
  if (!inTauri()) return document.visibilityState === 'visible'
  return invoke<boolean>('popover_is_shown')
}

/**
 * Show the popover under the tray icon without a click (the hotkey, chunk
 * 93). The shell finds the icon's rect itself.
 */
export async function showPopover(): Promise<void> {
  if (!inTauri()) return
  await invoke('show_popover')
}

/**
 * Register a global shortcut (chunk 93, `tauri-plugin-global-shortcut`).
 * `onPress` runs on key down only. A registration left by an earlier load of
 * this web view is dropped first, so a reload does not read as "taken".
 * Rejects when the system refuses the shortcut. Outside Tauri: nothing.
 */
export async function registerShortcut(
  accel: string,
  onPress: () => void,
): Promise<void> {
  if (!inTauri()) return
  await unregisterGlobal(accel).catch(() => {})
  await registerGlobal(accel, (event) => {
    if (event.state === 'Pressed') onPress()
  })
}

export async function unregisterShortcut(accel: string): Promise<void> {
  if (!inTauri()) return
  await unregisterGlobal(accel)
}

export function openDashboard(): void {
  if (inTauri()) call('open_dashboard')
  else window.open(DASHBOARD_URL, '_blank', 'noopener,noreferrer')
}

export function quitApp(): void {
  call('quit_app')
}

/**
 * Report whether the popover is on screen: once at once, then on every
 * change. Under Tauri the shell says so (`popover-shown` / `popover-hidden`),
 * since it is the shell that shows and hides the window; in a browser the
 * tab's visibility stands in.
 */
export function watchPopover(onChange: (shown: boolean) => void): () => void {
  if (!inTauri()) {
    const read = () => onChange(document.visibilityState === 'visible')
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }
  let stopped = false
  const unlisten: Array<() => void> = []
  const on = (event: string, shown: boolean) =>
    listen(event, () => onChange(shown)).then((off) => {
      if (stopped) off()
      else unlisten.push(off)
    })
  // The window starts hidden; ask rather than assume, in case the first
  // show landed before these listeners did.
  void Promise.all([on('popover-shown', true), on('popover-hidden', false)])
    .then(() => invoke<boolean>('popover_is_shown'))
    .then((shown) => {
      if (!stopped) onChange(shown)
    })
    .catch((e: unknown) => console.error('menubar: watchPopover failed', e))
  return () => {
    stopped = true
    for (const off of unlisten) off()
  }
}

/*
 * Pomodoro (chunk 94). The shell owns the timer (`pomodoro.rs`); each
 * command answers its new snapshot and rejects when the shell refuses it.
 * Outside Tauri there is no timer: every call answers `null`.
 */
function pomodoro(
  command: string,
  args?: Record<string, unknown>,
): Promise<PomodoroSnapshot | null> {
  if (!inTauri()) return Promise.resolve(null)
  return invoke<PomodoroSnapshot>(command, args)
}

export const pomodoroState = () => pomodoro('pomodoro_state')

/** Validated by the shell; applies from the next phase. */
export const pomodoroConfigure = (config: PomodoroConfig) =>
  pomodoro('pomodoro_configure', { ...config })

/** Focus on a task, or bare (`null`). Rejected while focus is on. */
export const pomodoroStart = (task: PomodoroTask | null) =>
  pomodoro('pomodoro_start', {
    task: task ? { id: task.id, title: task.title } : null,
  })

export const pomodoroPause = () => pomodoro('pomodoro_pause')
export const pomodoroResume = () => pomodoro('pomodoro_resume')
/** +5 minutes to the current phase. */
export const pomodoroExtend = () => pomodoro('pomodoro_extend')
/** Focus → its break now; a break → idle. */
export const pomodoroSkip = () => pomodoro('pomodoro_skip')
/** Idle from anywhere; the session is not counted. */
export const pomodoroStop = () => pomodoro('pomodoro_stop')

/** The shell's `pomodoro` event: one snapshot per state change. */
export function watchPomodoro(
  onSnapshot: (s: PomodoroSnapshot) => void,
): () => void {
  if (!inTauri()) return () => {}
  let stopped = false
  let off: (() => void) | null = null
  listen<PomodoroSnapshot>('pomodoro', (event) => onSnapshot(event.payload))
    .then((unlisten) => {
      if (stopped) unlisten()
      else off = unlisten
    })
    .catch((e: unknown) => console.error('menubar: watchPomodoro failed', e))
  return () => {
    stopped = true
    off?.()
  }
}

/*
 * Sound (chunk 95). The shell drives Spotify on this Mac (`sound.rs`) with
 * its own fixed AppleScript; nothing here carries script text. Each Spotify
 * call answers the fresh state. Outside Tauri: `null`, and nothing is sent.
 */
function spotify(
  command: string,
  args?: Record<string, unknown>,
): Promise<SpotifyState | null> {
  if (!inTauri()) return Promise.resolve(null)
  return invoke<SpotifyState>(command, args)
}

/** A read: never launches Spotify. */
export const spotifyState = () => spotify('spotify_state')
export const spotifyPlayPause = () => spotify('spotify_play_pause')
/** Pause, never the toggle; does not launch a closed Spotify. */
export const spotifyPause = () => spotify('spotify_pause')
export const spotifyNext = () => spotify('spotify_next')
export const spotifyPrevious = () => spotify('spotify_previous')
/** Play a playlist now (may launch Spotify). The shell validates the URI. */
export const spotifyPlayPreset = (uri: string) =>
  spotify('spotify_play_preset', { uri })

/** Play on focus or not, and the preset's playlist (`null` = Silence). */
export async function soundConfigure(
  auto: boolean,
  uri: string | null,
): Promise<void> {
  if (!inTauri()) return
  try {
    await invoke('sound_configure', { auto, uri })
  } catch (e) {
    console.error('menubar: sound_configure failed', e)
  }
}

/** System Settings → Privacy & Security → Automation (a fixed URL). */
export function openAutomationSettings(): void {
  call('open_automation_settings')
}

/*
 * Meditation (chunk 96). The shell owns the reminder clock and the session
 * (`meditation.rs`); each command answers its new snapshot and rejects when
 * the shell refuses it. Outside Tauri: `null`, and nothing is sent.
 */
function meditation(
  command: string,
  args?: Record<string, unknown>,
): Promise<MeditationSnapshot | null> {
  if (!inTauri()) return Promise.resolve(null)
  return invoke<MeditationSnapshot>(command, args)
}

export const meditationState = () => meditation('meditation_state')

/** The due times and settings. Validated by the shell; `due: []` clears it. */
export const meditationConfigure = (config: MeditationConfig) =>
  meditation('meditation_configure', {
    due: config.due,
    headsUp: config.headsUp,
    length: config.length,
    pauseSpotify: config.pauseSpotify,
    utcOffset: config.utcOffset,
  })

/** A session now, due or not. Rejected while one runs. */
export const meditationStart = () => meditation('meditation_start')
/** The reminder showing comes due again in 5 or 15 minutes. */
export const meditationSnooze = (minutes: 5 | 15) =>
  meditation('meditation_snooze', { minutes })
export const meditationSkip = () => meditation('meditation_skip')
/** End the session; without one, nothing happens. */
export const meditationEnd = () => meditation('meditation_end')

/** The shell's `meditation` event: one snapshot per state change. */
export function watchMeditation(
  onSnapshot: (s: MeditationSnapshot) => void,
): () => void {
  if (!inTauri()) return () => {}
  let stopped = false
  let off: (() => void) | null = null
  listen<MeditationSnapshot>('meditation', (event) => onSnapshot(event.payload))
    .then((unlisten) => {
      if (stopped) unlisten()
      else off = unlisten
    })
    .catch((e: unknown) => console.error('menubar: watchMeditation failed', e))
  return () => {
    stopped = true
    off?.()
  }
}

/*
 * Open at login (chunk 97, D12). The shell writes or removes one LaunchAgent
 * plist (`login.rs`); both commands answer the state. Outside Tauri: `null`.
 */
export type LoginItemStatus = 'on' | 'off' | 'other' | 'unavailable'
export type LoginItemState = { status: LoginItemStatus; path: string | null }

export async function loginItemState(): Promise<LoginItemState | null> {
  if (!inTauri()) return null
  return invoke<LoginItemState>('login_item_state')
}

/** Rejected with `unavailable` when this is not the installed app. */
export async function loginItemSet(on: boolean): Promise<LoginItemState | null> {
  if (!inTauri()) return null
  return invoke<LoginItemState>('login_item_set', { on })
}
