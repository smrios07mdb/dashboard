import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { isNoteEditorPath } from '@/lib/notes'
import { useUIStore } from '@/state/uiStore'

/*
 * Global capture shortcuts (chunk 73). Called once, in ProtectedLayout; one
 * `keydown` listener on `window`.
 *
 *   N        quick capture     }  bare keys: only when nothing else could
 *   /        task search       }  want the keystroke
 *   ⌘K / ^K  quick capture, from anywhere — inputs included
 *
 * A bare key is ignored while typing, with a modifier, on auto-repeat, in the
 * Notebook editor, and while a dialog or menu is open. Closed Radix layers
 * that are still in the DOM (`data-state="closed"`, e.g. the sync popover
 * mid-exit) do not count as open.
 */

const OPEN_LAYER =
  '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    // jsdom does not implement `isContentEditable`; the attribute is the same test.
    target.closest('[contenteditable=""], [contenteditable="true"]') !== null
  )
}

export function useCaptureShortcuts(enabled = true): void {
  const { pathname } = useLocation()

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const { capture, openCapture } = useUIStore.getState()

      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        if (capture) return
        e.preventDefault()
        openCapture('add')
        return
      }

      const mode =
        e.key === 'n' || e.key === 'N' ? 'add' : e.key === '/' ? 'search' : null
      if (!mode) return
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target)) return
      if (isNoteEditorPath(pathname)) return
      if (capture || document.querySelector(OPEN_LAYER)) return
      e.preventDefault()
      openCapture(mode)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, pathname])
}
