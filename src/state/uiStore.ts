/*
 * UI store — ephemeral view state only.
 *
 * Per ARCHITECTURE.md §2: Zustand is for UI state, never cached data.
 * The data layer's mirrors live in Dexie; sync state lives in
 * `syncStore`. This store holds purely-presentational state that
 * doesn't need to survive a reload — currently just the dashboard's
 * "I have N minutes" input.
 *
 * No persistence by design: defaults are sensible enough that the cost
 * of forgetting on reload is lower than the cost of localStorage
 * quirks on iOS PWAs.
 */
import { create } from 'zustand'

type UIStoreState = {
  /** Minutes the user has available right now, for the "What's next?" triage. */
  availableMinutes: number
  setAvailableMinutes: (n: number) => void
}

export const useUIStore = create<UIStoreState>((set) => ({
  availableMinutes: 30,
  setAvailableMinutes: (n) => set({ availableMinutes: n }),
}))
