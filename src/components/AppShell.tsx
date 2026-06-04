import type { ReactNode } from 'react'

import AccountMenu from './AccountMenu'
import { HupoMark } from './HupoMark'

type AppShellProps = {
  /**
   * Slot for status indicators that sit next to the account menu in the
   * top-right (e.g. SyncBadge, landing in chunk 5+).
   */
  headerEnd?: ReactNode
  /**
   * Slot for full-width banners that sit above the header — currently the
   * PWA install hint. Renders nothing when null/undefined.
   */
  topBanner?: ReactNode
  children: ReactNode
}

export default function AppShell({
  headerEnd,
  topBanner,
  children,
}: AppShellProps) {
  // Safe-area top on the shell so BOTH the topBanner (e.g. InstallHint, which
  // renders above the header) and the header itself clear the notch / Dynamic
  // Island under `viewport-fit=cover` (UX-04).
  return (
    <div className="min-h-svh bg-background pt-[env(safe-area-inset-top)] text-foreground">
      {topBanner}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-7">
          {/* Brand lockup (brand/README "App header"): the HupoMark — whose
              emerald point is the wordmark's period — beside the serif
              "hupomnemata" wordmark. The mark carries the point, so the wordmark
              drops its trailing dot (no double point). Point tracks live --work. */}
          <div className="inline-flex items-center gap-2">
            <HupoMark size={22} />
            <span className="font-display text-[19px] font-semibold lowercase tracking-[-0.02em] text-ink">
              hupomnemata
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {headerEnd}
            <AccountMenu />
          </div>
        </div>
      </header>
      {/* Bottom padding on phones clears the fixed bottom nav (min-h-14 bar +
          its safe-area inset) so no content hides behind it (UX-01). Restored
          to the normal py-6 at >=sm where the bottom nav is hidden. */}
      <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:px-7 sm:pb-6">
        {children}
      </div>
    </div>
  )
}
