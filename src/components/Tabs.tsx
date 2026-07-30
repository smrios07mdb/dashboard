import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Calendar, Filter, Sun, Tag, User } from '@/components/icons'
import { BottomTabs, TopTabs, type NavItem } from '@/components/ui/nav-tabs'

/*
 * Primary navigation — composes the Chunk-23 `TopTabs` / `BottomTabs` primitives
 * wired to react-router (the primitives are presentational).
 *
 * Active id derives from the pathname: exact `/` for Dashboard (replicating the
 * old `NavLink end`), own-path for the others. Drill-down routes
 * (`/category/:id`, `/subcategory/:id`) are NOT in the tab set → no active tab
 * (`value=''`). The primitives stamp `aria-current="page"` on the active item.
 *
 * Responsive (ARCHITECTURE §13): `TopTabs` at >=sm (`hidden sm:flex`), fixed
 * `BottomTabs` below 640px (`sm:hidden`) — exactly one in the a11y tree per
 * breakpoint. Bottom-bar dashboard label is "Tasks" per design/src/app.jsx.
 */

type Tab = {
  to: string
  label: string
  mobileLabel: string
  icon: ReactNode
}

const TABS: readonly Tab[] = [
  { to: '/', label: 'Dashboard', mobileLabel: 'Tasks', icon: <Tag size={20} /> },
  { to: '/planner', label: 'Planner', mobileLabel: 'Planner', icon: <Calendar size={20} /> },
  { to: '/routines', label: 'Routines', mobileLabel: 'Routines', icon: <Sun size={20} /> },
  { to: '/insights', label: 'Insights', mobileLabel: 'Insights', icon: <Filter size={20} /> },
  { to: '/settings', label: 'Settings', mobileLabel: 'Settings', icon: <User size={20} /> },
]

/** Exact `/` for Dashboard; own-path for the rest; `''` on drill-down routes. */
function activeId(pathname: string): string {
  if (pathname === '/') return '/'
  const match = TABS.find((t) => t.to !== '/' && pathname.startsWith(t.to))
  return match ? match.to : ''
}

export default function Tabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const value = activeId(pathname)

  const topItems: NavItem[] = TABS.map((t) => ({ id: t.to, label: t.label }))
  const bottomItems: NavItem[] = TABS.map((t) => ({
    id: t.to,
    label: t.mobileLabel,
    icon: t.icon,
  }))

  return (
    <>
      {/* Desktop / tablet: top tabs (hidden on phones). */}
      <TopTabs
        ariaLabel="Primary"
        items={topItems}
        value={value}
        onChange={(id) => navigate(id)}
        className="-mt-2 mb-2 hidden overflow-x-auto sm:flex"
      />
      {/* Phones: fixed bottom tab bar (hidden at >=sm). */}
      <BottomTabs
        ariaLabel="Primary"
        items={bottomItems}
        value={value}
        onChange={(id) => navigate(id)}
        className="sm:hidden"
      />
    </>
  )
}
