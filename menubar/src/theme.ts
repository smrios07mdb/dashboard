/*
 * Popover theme choice (chunk 91b, supersedes the "no toggle" half of D9).
 *
 * `auto` follows macOS (`prefers-color-scheme`); `light` and `dark` override
 * it. The choice lives in this web view's localStorage — per Mac, never
 * synced, never seen by the PWA. The resolved mode is written to
 * `<html data-mode>`, which `dark.css` keys on.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark'
export type ThemeMode = 'light' | 'dark'

export const THEME_KEY = 'hupo.menubar.theme'

const ORDER: ThemeChoice[] = ['auto', 'light', 'dark']

export const THEME_LABEL: Record<ThemeChoice, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
}

export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]
}

export function resolveMode(
  choice: ThemeChoice,
  systemDark: boolean,
): ThemeMode {
  if (choice === 'auto') return systemDark ? 'dark' : 'light'
  return choice
}

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, choice)
  } catch {
    // Storage unavailable: the choice holds until the popover reloads.
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_QUERY).matches
  )
}

/** Write the resolved mode for `choice` to `<html data-mode>`. */
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.mode = resolveMode(choice, systemDark())
}

/**
 * Keep `<html data-mode>` current for `choice` while macOS switches
 * appearance. Returns the unsubscribe.
 */
export function watchSystemTheme(choice: ThemeChoice): () => void {
  applyTheme(choice)
  if (choice !== 'auto' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mq = window.matchMedia(DARK_QUERY)
  const onChange = () => applyTheme('auto')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
