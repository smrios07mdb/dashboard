import { Outlet } from 'react-router-dom'

import AppShell from './AppShell'
import InstallHint from './InstallHint'
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
 */
export default function ProtectedLayout() {
  return (
    <Protected>
      <AppShell
        topBanner={<InstallHint />}
        headerEnd={<SyncIndicator />}
      >
        <Tabs />
        <div className="pt-6">
          <Outlet />
        </div>
      </AppShell>
    </Protected>
  )
}
