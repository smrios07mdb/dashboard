/*
 * The popover's own start-up, loaded by `main.tsx` for every window but the
 * breathing overlays (chunk 96): they must not create a Supabase client, a
 * sign-out listener or a sync runner, so none of this is in their bundle path.
 */
import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'

import { installSignOutCleanup } from '@/lib/signOutCleanup'

import App from './App'

export function mountPopover(root: Root): void {
  // The PWA's sign-out hygiene, unchanged: wipe the cache mirror on
  // SIGNED_OUT (ARCHITECTURE §14) and keep the outbox user stamp current.
  const stopSignOutCleanup = installSignOutCleanup()
  if (import.meta.hot) import.meta.hot.dispose(() => stopSignOutCleanup())

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
