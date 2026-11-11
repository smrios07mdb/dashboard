/*
 * Global hotkeys (chunk 93, D6; focus added chunk 94, meditate chunk 96).
 * The one place a binding is chosen: the
 * table lives in `localStorage['hup:mb:hotkeys']` over `DEFAULT_HOTKEYS`, and
 * `createHotkeys` registers it through a backend (`native.ts` under Tauri).
 * The Settings view (chunk 97) rebinds through `rebind` and `resetDefaults`,
 * which keep the old key when the new one cannot be had — the shell has no
 * say in which keys are used.
 *
 * Accelerators use the global-shortcut plugin's syntax (`Alt+H`,
 * `CommandOrControl+Shift+K`).
 */

export const HOTKEYS_KEY = 'hup:mb:hotkeys'

export const DEFAULT_HOTKEYS = {
  scratchpad: 'Alt+H',
  /** Start or pause focus (chunk 94, D10). */
  focus: 'Alt+Shift+F',
  /** Start a breathing session now (chunk 96, D8). */
  meditate: 'Alt+Shift+M',
} as const

export type HotkeyAction = keyof typeof DEFAULT_HOTKEYS
export type HotkeyMap = Record<HotkeyAction, string>

const ACTIONS = Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[]

/** What each action is called in Settings (chunk 97, D8). */
export const ACTION_LABEL: Record<HotkeyAction, string> = {
  scratchpad: 'Open scratchpad',
  focus: 'Start or pause focus',
  meditate: 'Start meditation',
}

export function readHotkeys(): HotkeyMap {
  const map: HotkeyMap = { ...DEFAULT_HOTKEYS }
  try {
    const raw = localStorage.getItem(HOTKEYS_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (stored && typeof stored === 'object') {
      for (const action of ACTIONS) {
        const v = (stored as Record<string, unknown>)[action]
        if (typeof v === 'string' && v.trim()) map[action] = v.trim()
      }
    }
  } catch {
    // Unreadable or malformed: the defaults stand.
  }
  return map
}

export function saveHotkeys(map: HotkeyMap): void {
  try {
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable: the binding holds until restart.
  }
}

const SYMBOL: Record<string, string> = {
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  control: '⌃',
  ctrl: '⌃',
  command: '⌘',
  cmd: '⌘',
  super: '⌘',
  meta: '⌘',
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  commandorctrl: '⌘',
  cmdorcontrol: '⌘',
  space: 'Space',
}

/** `Alt+H` → `⌥H`, `CommandOrControl+Shift+Space` → `⌘⇧Space`. */
export function hotkeyLabel(accel: string): string {
  return accel
    .split('+')
    .map((part) => {
      const p = part.trim()
      const sym = SYMBOL[p.toLowerCase()]
      if (sym) return sym
      return p.replace(/^Key(?=[A-Z]$)/, '').replace(/^Digit(?=\d$)/, '').toUpperCase()
    })
    .join('')
}

export function takenMessage(accel: string): string {
  return `${hotkeyLabel(accel)} is taken by another app`
}

function keptMessage(wanted: string, kept: string): string {
  return `${takenMessage(wanted)} — kept ${hotkeyLabel(kept)}`
}

/**
 * The accelerator a key press records (chunk 97, D9), from `e.code` — never
 * `e.key`, which ⌥ changes on a Mac. Keys: A–Z, 0–9, Space, F1–F12; any
 * other key is `null` (keep recording). Modifiers in the plugin's names and
 * order, `Control+Alt+Shift+Command+<key>`, at least one of ⌃ ⌥ ⌘.
 */
export function accelFromEvent(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string | null {
  const c = e.code
  let key: string | null = null
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3)
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5)
  else if (c === 'Space') key = 'Space'
  else if (/^F(?:[1-9]|1[0-2])$/.test(c)) key = c
  if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return null
  const mods = [
    e.ctrlKey && 'Control',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
    e.metaKey && 'Command',
  ].filter((m): m is string => Boolean(m))
  return [...mods, key].join('+')
}

const CANON: Record<string, string> = {
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  control: 'control',
  ctrl: 'control',
  command: 'command',
  cmd: 'command',
  super: 'command',
  meta: 'command',
  commandorcontrol: 'command',
  cmdorctrl: 'command',
  commandorctrl: 'command',
  cmdorcontrol: 'command',
}
const MOD_ORDER = ['control', 'alt', 'shift', 'command']

/** One spelling per combo: `Shift+Option+KeyF` and `Alt+Shift+F` agree. */
function canonical(accel: string): string {
  const mods = new Set<string>()
  let key = ''
  for (const part of accel.split('+')) {
    const p = part.trim().toLowerCase()
    if (CANON[p]) mods.add(CANON[p])
    else key = p.replace(/^key(?=[a-z]$)/, '').replace(/^digit(?=\d$)/, '')
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+')
}

/** The other action already bound to `accel`, or `null`. */
export function usedBy(
  map: HotkeyMap,
  action: HotkeyAction,
  accel: string,
): HotkeyAction | null {
  const want = canonical(accel)
  return ACTIONS.find((a) => a !== action && canonical(map[a]) === want) ?? null
}

export type HotkeyBackend = {
  /** Rejects when the system will not give us the shortcut. */
  register: (accel: string, onPress: () => void) => Promise<void>
  unregister: (accel: string) => Promise<void>
}

export type HotkeysState = {
  bound: HotkeyMap
  /** Per action: the user-facing message when registration failed. */
  failed: Partial<Record<HotkeyAction, string>>
}

export function createHotkeys(
  backend: HotkeyBackend,
  handlers: Record<HotkeyAction, () => void>,
) {
  let state: HotkeysState = { bound: readHotkeys(), failed: {} }
  const registered = new Set<string>()
  const listeners = new Set<() => void>()
  let generation = 0

  const set = (next: HotkeysState) => {
    state = next
    for (const l of listeners) l()
  }

  async function bind(action: HotkeyAction, accel: string, gen: number) {
    try {
      await backend.register(accel, () => handlers[action]())
    } catch (e) {
      console.error(`menubar: hotkey ${accel} not registered`, e)
      if (gen === generation) {
        set({ ...state, failed: { ...state.failed, [action]: takenMessage(accel) } })
      }
      return
    }
    // Stopped (or restarted) while registering: give the key back.
    if (gen !== generation) {
      await backend.unregister(accel).catch(() => {})
      return
    }
    registered.add(accel)
    const failed = { ...state.failed }
    delete failed[action]
    set({ ...state, failed })
  }

  /** Register one key for an action; false when the system refuses it. */
  async function take(action: HotkeyAction, accel: string): Promise<boolean> {
    try {
      await backend.register(accel, () => handlers[action]())
    } catch (e) {
      console.error(`menubar: hotkey ${accel} not registered`, e)
      return false
    }
    registered.add(accel)
    return true
  }

  async function release(accel: string) {
    if (!registered.delete(accel)) return
    await backend.unregister(accel).catch((e: unknown) => {
      console.error(`menubar: hotkey ${accel} not unregistered`, e)
    })
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Register every binding from storage. */
    async start() {
      const gen = ++generation
      set({ bound: readHotkeys(), failed: {} })
      await Promise.all(ACTIONS.map((a) => bind(a, state.bound[a], gen)))
    },
    /** Unregister everything this controller registered. */
    async stop() {
      generation++
      await Promise.all([...registered].map(release))
    },
    /**
     * Move one action to a new accelerator (chunk 97, D10): release the old
     * key, try the new one. If the system will not give it, the old key is
     * registered again, the stored map is unchanged, and the row says so.
     * Answers whether it took.
     */
    async rebind(action: HotkeyAction, accel: string): Promise<boolean> {
      const old = state.bound[action]
      await release(old)
      if (await take(action, accel)) {
        const bound = { ...state.bound, [action]: accel }
        saveHotkeys(bound)
        const failed = { ...state.failed }
        delete failed[action]
        set({ bound, failed })
        return true
      }
      await take(action, old)
      set({ ...state, failed: { ...state.failed, [action]: keptMessage(accel, old) } })
      return false
    },
    /**
     * Every action back to `DEFAULT_HOTKEYS`, each the way `rebind` does it.
     * All changed keys are released first, so swapped keys do not collide.
     */
    async resetDefaults() {
      const changed = ACTIONS.filter((a) => state.bound[a] !== DEFAULT_HOTKEYS[a])
      const old = { ...state.bound }
      await Promise.all(changed.map((a) => release(old[a])))
      const bound = { ...state.bound }
      const failed = { ...state.failed }
      const lost: HotkeyAction[] = []
      for (const a of changed) {
        if (await take(a, DEFAULT_HOTKEYS[a])) {
          bound[a] = DEFAULT_HOTKEYS[a]
          delete failed[a]
        } else {
          lost.push(a)
        }
      }
      for (const a of lost) {
        // Back to the old key, unless another action now holds it (a swap).
        // Then nothing is kept: store the default, unbound, and say so.
        if (!usedBy(bound, a, old[a])) {
          await take(a, old[a])
          failed[a] = keptMessage(DEFAULT_HOTKEYS[a], old[a])
        } else {
          bound[a] = DEFAULT_HOTKEYS[a]
          failed[a] = takenMessage(DEFAULT_HOTKEYS[a])
        }
      }
      saveHotkeys(bound)
      set({ bound, failed })
    },
  }
}

export type Hotkeys = ReturnType<typeof createHotkeys>
