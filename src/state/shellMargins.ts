/*
 * The `shellMargins` display preference — the page margins the app shell keeps
 * around its content (sides, top, bottom), in CSS pixels.
 *
 * Client-only VIEW setting like `todayList`: no schema, no synced field. `null`
 * means "use the responsive defaults" declared in `index.css` (`.shell`); a
 * value overrides them as inline CSS custom properties on the shell root.
 *
 * Editing runs through a non-persisted `draft`: `MarginEditor` drags update the
 * draft live, `save()` commits it to localStorage, `cancel()` drops it.
 */
import { create } from 'zustand'

export type ShellMargins = { side: number; top: number; bottom: number }

const STORAGE_KEY = 'hup:shellMargins'

export const MARGIN_LIMITS = {
  /** Keep at least this much content width between the side margins. */
  minContentWidth: 280,
  maxTop: 240,
  maxBottom: 240,
} as const

export function clampMargins(
  m: ShellMargins,
  viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
): ShellMargins {
  const maxSide = Math.max(
    0,
    Math.floor((viewportWidth - MARGIN_LIMITS.minContentWidth) / 2),
  )
  const clamp = (v: number, max: number) =>
    Math.min(max, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)))
  return {
    side: clamp(m.side, maxSide),
    top: clamp(m.top, MARGIN_LIMITS.maxTop),
    bottom: clamp(m.bottom, MARGIN_LIMITS.maxBottom),
  }
}

function isMargins(v: unknown): v is ShellMargins {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.side === 'number' &&
    typeof o.top === 'number' &&
    typeof o.bottom === 'number'
  )
}

function readInitial(): ShellMargins | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isMargins(parsed) ? clampMargins(parsed) : null
  } catch {
    return null
  }
}

function persist(m: ShellMargins | null) {
  try {
    if (m === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
  } catch {
    // Private mode / quota — in-memory value still drives this session.
  }
}

/**
 * The responsive defaults `index.css` applies when `margins` is null. Used to
 * seed the draft so a first drag starts from what is actually on screen.
 */
export function defaultMargins(
  viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
): ShellMargins {
  if (viewportWidth >= 1024) return { side: 40, top: 32, bottom: 32 }
  if (viewportWidth >= 640) return { side: 28, top: 24, bottom: 32 }
  return { side: 16, top: 24, bottom: 32 }
}

type ShellMarginsState = {
  /** Saved margins; null = responsive defaults. */
  margins: ShellMargins | null
  /** Live draft while the editor is open; null when not editing. */
  draft: ShellMargins | null
  startEditing: () => void
  setDraft: (patch: Partial<ShellMargins>) => void
  /** Reset the draft to the responsive defaults (saved on Save). */
  resetDraft: () => void
  save: () => void
  cancel: () => void
}

export const useShellMarginsStore = create<ShellMarginsState>((set, get) => ({
  margins: readInitial(),
  draft: null,
  startEditing: () =>
    set((s) => ({ draft: s.draft ?? s.margins ?? defaultMargins() })),
  setDraft: (patch) =>
    set((s) => {
      if (!s.draft) return s
      return { draft: clampMargins({ ...s.draft, ...patch }) }
    }),
  resetDraft: () => set({ draft: defaultMargins() }),
  save: () => {
    const { draft } = get()
    if (!draft) return
    const next = clampMargins(draft)
    persist(next)
    set({ margins: next, draft: null })
  },
  cancel: () => set({ draft: null }),
}))

/** Margins to render right now: the draft while editing, else the saved set. */
export function useEffectiveMargins(): ShellMargins | null {
  const margins = useShellMarginsStore((s) => s.margins)
  const draft = useShellMarginsStore((s) => s.draft)
  return draft ?? margins
}
