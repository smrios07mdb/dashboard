/*
 * The one seam between the popover and the Tauri shell (chunk 91).
 *
 * Every call is a no-op when `window.__TAURI_INTERNALS__` is absent, so the
 * same bundle runs in a normal browser (`npm run menubar:dev`) and under
 * Vitest. The commands are defined in `menubar/src-tauri/src/lib.rs`.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

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

/** The tray title — the open Today count, `''` for none or signed out. */
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
