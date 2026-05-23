import type { ReactNode } from 'react'

import AccountMenu from './AccountMenu'

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
  return (
    <div className="min-h-svh bg-background text-foreground">
      {topBanner}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-7">
          <div
            className="inline-flex items-baseline gap-[2px] text-[18px] font-semibold text-foreground"
            style={{ letterSpacing: '-0.02em' }}
          >
            <span>hupomnemata</span>
            <span style={{ color: 'var(--jewel-jade)' }}>.</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {headerEnd}
            <AccountMenu />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-7">
        {children}
      </div>
    </div>
  )
}
