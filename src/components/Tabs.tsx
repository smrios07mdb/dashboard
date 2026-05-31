import { Filter, Sun, Tag, User, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'

/*
 * Primary navigation — URL-driven via NavLink (deliberately not shadcn
 * <Tabs>, which uses internal local state). Active styling comes from
 * NavLink's `isActive` render prop; accessibility is handled by NavLink
 * stamping `aria-current="page"` on the active link.
 *
 * Responsive (ARCHITECTURE §13): a fixed bottom tab bar under 640px
 * (`sm:hidden`, thumb-reachable, safe-area padded) and the top tabs at
 * `>=sm` (`hidden sm:flex`). Both render the same routes; CSS shows exactly
 * one per breakpoint, so only one is in the a11y tree at a time. Bottom-bar
 * labels + icons follow design/src/app.jsx `BottomTabs` / `tabIcons` — note
 * the dashboard tab reads "Tasks" in the bottom bar per that design.
 */

type Tab = {
  to: string
  label: string
  mobileLabel: string
  Icon: LucideIcon
  end: boolean
}

const TABS: readonly Tab[] = [
  { to: '/', label: 'Dashboard', mobileLabel: 'Tasks', Icon: Tag, end: true },
  { to: '/routines', label: 'Routines', mobileLabel: 'Routines', Icon: Sun, end: false },
  { to: '/insights', label: 'Insights', mobileLabel: 'Insights', Icon: Filter, end: false },
  { to: '/settings', label: 'Settings', mobileLabel: 'Settings', Icon: User, end: false },
]

export default function Tabs() {
  return (
    <>
      {/* Desktop / tablet: top tabs (hidden on phones). */}
      <nav
        aria-label="Primary"
        data-testid="primary-nav-top"
        className="-mt-2 mb-2 hidden gap-1 overflow-x-auto border-b border-border sm:flex"
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

      {/* Phones: fixed bottom tab bar (hidden at >=sm). */}
      <nav
        aria-label="Primary"
        data-testid="primary-nav-bottom"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {TABS.map((tab) => {
          const { Icon } = tab
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              <span>{tab.mobileLabel}</span>
            </NavLink>
          )
        })}
      </nav>
    </>
  )
}
