/*
 * Global hotkeys (chunk 93, D6; focus added chunk 94). The one place a
 * binding is chosen: the
 * table lives in `localStorage['hup:mb:hotkeys']` over `DEFAULT_HOTKEYS`, and
 * `createHotkeys` registers it through a backend (`native.ts` under Tauri).
 * A later settings panel (chunk 97) rebinds through `rebind` — the shell has
 * no say in which keys are used.
 *
 * Accelerators use the global-shortcut plugin's syntax (`Alt+H`,
 * `CommandOrControl+Shift+K`).
 */

export const HOTKEYS_KEY = 'hup:mb:hotkeys'

export const DEFAULT_HOTKEYS = {
  scratchpad: 'Alt+H',
  /** Start or pause focus (chunk 94, D10). */
  focus: 'Alt+Shift+F',
} as const

export type HotkeyAction = keyof typeof DEFAULT_HOTKEYS
export type HotkeyMap = Record<HotkeyAction, string>

const ACTIONS = Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[]

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
    /** Move one action to a new accelerator and remember it. */
    async rebind(action: HotkeyAction, accel: string) {
      await release(state.bound[action])
      const bound = { ...state.bound, [action]: accel }
      saveHotkeys(bound)
      set({ ...state, bound })
      await bind(action, accel, generation)
    },
  }
}

export type Hotkeys = ReturnType<typeof createHotkeys>
