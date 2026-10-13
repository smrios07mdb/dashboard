import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useSession } from '@/lib/auth'
import { isNoteEditorPath } from '@/lib/notes'
import { flushPendingDeletes, resumePendingDeletes } from '@/lib/taskUndo'

import AppShell from './AppShell'
import InstallHint from './InstallHint'
import NotesProvider from './notebook/NotesProvider'
import Protected from './Protected'
import SyncIndicator from './SyncIndicator'
import Tabs from './Tabs'

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
 */
export default function ProtectedLayout() {
  const { pathname } = useLocation()
  const { user } = useSession()
  const userId = user?.id ?? null

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
          headerEnd={<SyncIndicator />}
          bottomNav={!isNoteEditorPath(pathname)}
        >
          <Tabs />
          <div className="pt-6">
            <Outlet />
          </div>
        </AppShell>
      </NotesProvider>
    </Protected>
  )
}
