import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'

/*
 * Top navigation — URL-driven via NavLink (deliberately not shadcn
 * <Tabs>, which uses internal local state). Active styling comes from
 * NavLink's `isActive` render prop; accessibility is handled by
 * NavLink stamping `aria-current="page"` on the active link.
 *
 * Rendered inside <AppShell>'s padded inner container, so this
 * component doesn't repeat max-width / horizontal padding itself.
 *
 * TODO chunk 16: swap to bottom-nav under 640px per ARCHITECTURE §13
 * (responsive breakpoints). The visual / a11y polish for mobile lives
 * in the a11y pass.
 */

const TABS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/routines', label: 'Routines', end: false },
  { to: '/insights', label: 'Insights', end: false },
  { to: '/settings', label: 'Settings', end: false },
] as const

export default function Tabs() {
  return (
    <nav
      aria-label="Primary"
      className="-mt-2 mb-2 flex gap-1 overflow-x-auto border-b border-border"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'relative inline-flex min-h-11 items-center px-3 text-[13px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-secondary-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span>{tab.label}</span>
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-x-2 bottom-[-1px] h-[2px] rounded-sm transition-colors',
                  isActive ? 'bg-foreground' : 'bg-transparent',
                )}
              />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
