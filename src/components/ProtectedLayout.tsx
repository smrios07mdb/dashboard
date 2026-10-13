import { Suspense, lazy, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'

import { useSession } from '@/lib/auth'
import { isNoteEditorPath } from '@/lib/notes'
import { flushPendingDeletes, resumePendingDeletes } from '@/lib/taskUndo'
import { useUIStore } from '@/state/uiStore'

import AppShell from './AppShell'
import { useCaptureShortcuts } from './capture/useCaptureShortcuts'
import InstallHint from './InstallHint'
import NotesProvider from './notebook/NotesProvider'
import Protected from './Protected'
import SyncIndicator from './SyncIndicator'
import Tabs from './Tabs'

// The capture and search dialogs (chunk 73) load on first use, like the lazy
// screens in App.tsx: only the shortcuts and the two buttons are eager.
const QuickCapture = lazy(() => import('./capture/QuickCapture'))
const TaskSearch = lazy(() => import('./capture/TaskSearch'))

/**
 * Single layout route used by every signed-in screen.
 *
 * Replaces the per-route wrapping that existed prior to chunk 6 — that
 * pattern duplicated <Protected><AppShell> for every page and made it
 * easy to mount the InstallHint banner twice. Now those concerns live
 * in one place; child routes render inside <Outlet />.
 *
 * Also the lifecycle owner for deferred task deletes (chunk 72): leftovers
 * from a killed session are committed once a user is present, and anything
 * still inside its undo window is committed on `pagehide`. Deliberately not
 * `visibilitychange` — backgrounding the PWA must not cost the Undo.
 *
 * And the home of global capture (chunk 73): the `N` / `/` / `⌘K` shortcuts,
 * the header `New task` button (>=sm), the floating + (phones) and the two
 * dialogs they open, so capture and search work from every signed-in screen.
 */
export default function ProtectedLayout() {
  const { pathname } = useLocation()
  const { user } = useSession()
  const userId = user?.id ?? null
  const captureOpen = useUIStore((s) => s.capture !== null)
  const openCapture = useUIStore((s) => s.openCapture)
  const noteEditor = isNoteEditorPath(pathname)
  // Latched on the first open so the dialogs then stay mounted and can run
  // their close transition and hand focus back.
  const [captureUsed, setCaptureUsed] = useState(false)
  if (captureOpen && !captureUsed) setCaptureUsed(true)

  useCaptureShortcuts(userId !== null)

  useEffect(() => {
    if (!userId) return
    resumePendingDeletes()
    window.addEventListener('pagehide', flushPendingDeletes)
    return () => window.removeEventListener('pagehide', flushPendingDeletes)
  }, [userId])

  return (
    <Protected>
      {/* Every note, plus the task notes sheet, for every screen (chunk 59). */}
      <NotesProvider>
        <AppShell
          topBanner={<InstallHint />}
          headerEnd={
            <>
              <button
                type="button"
                aria-label="New task"
                aria-keyshortcuts="N"
                onClick={() => openCapture('add')}
                className="hidden h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
              >
                <Plus className="size-3.5" aria-hidden />
                New task
                <kbd className="rounded-sm border border-line px-1 font-mono text-[10px] leading-4 text-ink-3">
                  N
                </kbd>
              </button>
              <SyncIndicator />
            </>
          }
          bottomNav={!noteEditor}
        >
          <Tabs />
          <div className="pt-6">
            <Outlet />
          </div>
        </AppShell>
        {/* Phones: floating +, clear of the bottom tab bar (3.5rem + inset). */}
        {!noteEditor && !captureOpen && (
          <button
            type="button"
            aria-label="New task"
            data-testid="capture-fab"
            onClick={() => openCapture('add')}
            className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+16px)] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:hidden"
          >
            <Plus className="size-6" aria-hidden />
          </button>
        )}
        {captureUsed && (
          <Suspense fallback={null}>
            <QuickCapture />
            <TaskSearch />
          </Suspense>
        )}
      </NotesProvider>
    </Protected>
  )
}
