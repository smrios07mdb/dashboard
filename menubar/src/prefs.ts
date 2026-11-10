/*
 * Per-Mac popover state in the web view's `localStorage` (chunk 93): the
 * last tab used and the scratchpad draft. Never synced. Every access is
 * guarded — without storage the popover still works, it just forgets.
 */

export type PopoverTab = 'today' | 'scratchpad'

export const TAB_KEY = 'hup:mb:tab'
export const DRAFT_KEY = 'hup:mb:scratch'

export function readTab(): PopoverTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'scratchpad' ? 'scratchpad' : 'today'
  } catch {
    return 'today'
  }
}

export function saveTab(tab: PopoverTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // Storage unavailable: the tab is remembered until restart.
  }
}

export function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Storage unavailable: the draft lives as long as the web view.
  }
}
