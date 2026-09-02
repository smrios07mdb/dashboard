import type { ReactNode } from 'react'

import { useEffectiveMargins } from '@/state/shellMargins'

import AccountMenu from './AccountMenu'
import { HupoMark } from './HupoMark'
import MarginEditor from './MarginEditor'

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
  // Page margins: `.shell` in index.css declares the responsive defaults as
  // `--shell-side` / `--shell-top` / `--shell-bottom`; a saved (or in-edit
  // draft) preference overrides them inline. The header, InstallHint and the
  // content wrapper all read the same variables.
  const margins = useEffectiveMargins()
  const vars = margins
    ? ({
        '--shell-side': `${margins.side}px`,
        '--shell-top': `${margins.top}px`,
        '--shell-bottom': `${margins.bottom}px`,
      } as React.CSSProperties)
    : undefined

  // Safe-area top on the shell so BOTH the topBanner (e.g. InstallHint, which
  // renders above the header) and the header itself clear the notch / Dynamic
  // Island under `viewport-fit=cover` (UX-04).
  return (
    <div
      className="shell flex min-h-svh flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground"
      style={vars}
    >
      {topBanner}
      <header className="border-b border-border">
        <div className="flex w-full items-center justify-between gap-4 px-[var(--shell-side)] py-3">
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
      {/* Bottom padding on phones adds the fixed bottom nav (min-h-14 bar +
          its safe-area inset) so no content hides behind it (UX-01). Just the
          margin at >=sm where the bottom nav is hidden. `relative` + `flex-1`
          so the MarginEditor guides sit on this wrapper's padding edges and
          the bottom guide lands at the bottom of the page. */}
      <div className="relative w-full flex-1 px-[var(--shell-side)] pt-[var(--shell-top)] pb-[calc(var(--shell-bottom)+3.5rem+env(safe-area-inset-bottom))] sm:pb-[var(--shell-bottom)]">
        <MarginEditor />
        {children}
      </div>
    </div>
  )
}
