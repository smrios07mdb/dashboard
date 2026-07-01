/*
 * The `todayList` display preference — which Today layout the dashboard shows.
 *
 * This is a client-only VIEW setting (like the resizable Today height), not a
 * synced data field: no schema migration, no `settings` row. It persists across
 * reloads via localStorage so the choice sticks on a device, and lives in a
 * tiny Zustand store so the Settings writer and the Dashboard reader stay in
 * sync across routes without a prop drill.
 *
 * (The separate `uiStore` is deliberately non-persisted; a durable display
 * preference doesn't belong there, so it gets its own store.)
 */
import { create } from 'zustand'

export type TodayListVariant = 'stacked' | 'rail' | 'banner' | 'off'

export const TODAY_LIST_VARIANTS: readonly TodayListVariant[] = [
  'stacked',
  'rail',
  'banner',
  'off',
]

const STORAGE_KEY = 'hup:todayList'
const DEFAULT_VARIANT: TodayListVariant = 'stacked'

function isVariant(v: string | null): v is TodayListVariant {
  return v !== null && (TODAY_LIST_VARIANTS as readonly string[]).includes(v)
}

function readInitial(): TodayListVariant {
  if (typeof localStorage === 'undefined') return DEFAULT_VARIANT
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isVariant(v) ? v : DEFAULT_VARIANT
  } catch {
    return DEFAULT_VARIANT
  }
}

type TodayListState = {
  todayList: TodayListVariant
  setTodayList: (variant: TodayListVariant) => void
}

export const useTodayListStore = create<TodayListState>((set) => ({
  todayList: readInitial(),
  setTodayList: (variant) => {
    try {
      localStorage.setItem(STORAGE_KEY, variant)
    } catch {
      // Private mode / quota / SSR shim — the in-memory value still drives this
      // session; we just can't persist it. Quiet failure is fine for a view pref.
    }
    set({ todayList: variant })
  },
}))
