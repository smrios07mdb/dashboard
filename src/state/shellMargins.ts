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
  /**
   * Keep at least this much content width between the side margins — what the
   * dashboard's two columns need. `.shell` in `index.css` applies the same
   * figure live as the window resizes; keep the two in step.
   */
  minContentWidth: 900,
  maxTop: 240,
  maxBottom: 240,
} as const

/** Below this width (Tailwind `sm`) saved margins are not applied or editable. */
export const MARGINS_MIN_VIEWPORT = 640

/**
 * Largest side margin the shell renders at this width: whatever leaves
 * `minContentWidth`, but never less than the responsive default (a window too
 * narrow for the floor still gets its default side).
 */
export function maxSideFor(viewportWidth: number): number {
  return Math.max(
    defaultMargins(viewportWidth).side,
    Math.floor((viewportWidth - MARGIN_LIMITS.minContentWidth) / 2),
  )
}

export function clampMargins(
  m: ShellMargins,
  viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
): ShellMargins {
  const clamp = (v: number, max: number) =>
    Math.min(max, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)))
  return {
    side: clamp(m.side, maxSideFor(viewportWidth)),
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
    // Sanitised but not clamped to this window: the stored side is a ceiling
    // the shell CSS narrows live, so a wider window later gets it back.
    return isMargins(parsed) ? clampMargins(parsed, Infinity) : null
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
  // The draft starts from what is on screen: the saved set clamped to this
  // window, so the guides sit on the rendered padding edges.
  startEditing: () =>
    set((s) => ({
      draft:
        s.draft ?? (s.margins ? clampMargins(s.margins) : defaultMargins()),
    })),
  setDraft: (patch) =>
    set((s) => {
      if (!s.draft) return s
      return { draft: clampMargins({ ...s.draft, ...patch }) }
    }),
  resetDraft: () => set({ draft: defaultMargins() }),
  save: () => {
    const { draft } = get()
    if (!draft) return
    const clamped = clampMargins(draft)
    const d = defaultMargins()
    // Saving the defaults (e.g. after Reset) stores nothing, so the shell goes
    // back to the responsive defaults instead of pinning today's numbers.
    const next =
      clamped.side === d.side &&
      clamped.top === d.top &&
      clamped.bottom === d.bottom
        ? null
        : clamped
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
