import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import Tabs from './Tabs'

/*
 * Tabs now composes the TopTabs / BottomTabs primitives (Chunk 24). jsdom
 * doesn't apply CSS breakpoints, so BOTH navs render in the DOM; we assert the
 * router-wired contract (labels, aria-current parity incl. exact-`/` and the
 * no-active drill-down case, and click-to-navigate) rather than computed
 * visibility (that's the on-device check).
 */
function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Tabs />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('Tabs — primary nav (Chunk 24)', () => {
  it('renders all five routes across the top + bottom navs', () => {
    renderAt('/')
    // 5 top + 5 bottom = 10 tab buttons (Planner chunk 36, Notebook chunk 58,
    // Routines folded into Today chunk 78)
    expect(screen.getAllByRole('button')).toHaveLength(10)
    // Dashboard reads "Dashboard" on top, "Tasks" in the bottom bar
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    // The shared labels appear once per nav
    expect(screen.getAllByText('Planner')).toHaveLength(2)
    expect(screen.queryByText('Routines')).not.toBeInTheDocument()
    expect(screen.getAllByText('Insights')).toHaveLength(2)
    expect(screen.getAllByText('Notebook')).toHaveLength(2)
    expect(screen.getAllByText('Settings')).toHaveLength(2)
  })

  it('orders both navs Dashboard · Planner · Insights · Notebook · Settings', () => {
    renderAt('/')
    const [top, bottom] = screen.getAllByRole('navigation', { name: 'Primary' })
    const labels = (nav: HTMLElement) =>
      Array.from(nav.querySelectorAll('button')).map((b) => b.textContent)
    expect(labels(top)).toEqual([
      'Dashboard',
      'Planner',
      'Insights',
      'Notebook',
      'Settings',
    ])
    expect(labels(bottom)).toEqual([
      'Tasks',
      'Planner',
      'Insights',
      'Notebook',
      'Settings',
    ])
  })

  it('marks Notebook active on the list and on a note', () => {
    renderAt('/notebook')
    expect(screen.getAllByRole('button', { current: 'page' })).toHaveLength(2)
  })

  // The bottom bar is the <640px nav (`sm:hidden`); jsdom applies no
  // breakpoints, so "under 640px only" is asserted as: the bottom bar is the
  // one that goes, and the top tabs (the >=640px nav) stay.
  it('drops the bottom nav on /notebook/:noteId only, keeping the top tabs', () => {
    const { unmount } = renderAt('/notebook/n1')
    const navs = screen.getAllByRole('navigation', { name: 'Primary' })
    expect(navs).toHaveLength(1)
    expect(navs[0]).not.toHaveClass('fixed')
    expect(navs[0].querySelectorAll('button')).toHaveLength(5)
    expect(
      screen.getByRole('button', { current: 'page' }),
    ).toHaveTextContent('Notebook')
    unmount()

    for (const path of ['/notebook', '/', '/planner', '/settings']) {
      const view = renderAt(path)
      expect(
        screen.getAllByRole('navigation', { name: 'Primary' }),
      ).toHaveLength(2)
      view.unmount()
    }
  })

  it('exposes two labelled "Primary" nav landmarks', () => {
    renderAt('/')
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(2)
  })

  it('marks Dashboard active only on an exact `/` (both navs)', () => {
    renderAt('/')
    const current = screen.getAllByRole('button', { current: 'page' })
    expect(current).toHaveLength(2)
    const labels = current.map((b) => b.textContent)
    expect(labels).toContain('Dashboard')
    expect(labels).toContain('Tasks')
  })

  it('marks the matching tab active on a top-level route', () => {
    renderAt('/insights')
    const current = screen.getAllByRole('button', { current: 'page' })
    expect(current).toHaveLength(2)
    current.forEach((b) => expect(b).toHaveTextContent(/insights/i))
  })

  it('marks NO tab active on the drill-down routes', () => {
    renderAt('/category/abc')
    expect(screen.queryAllByRole('button', { current: 'page' })).toHaveLength(0)

    renderAt('/subcategory/xyz')
    expect(screen.queryAllByRole('button', { current: 'page' })).toHaveLength(0)
  })

  // Chunk 68: narrow tablets still scroll the tab row sideways, but the bar
  // must never scroll vertically (UX audit #17, scrollbar).
  it('lets the top nav scroll sideways only', () => {
    renderAt('/')
    const [top, bottom] = screen.getAllByRole('navigation', { name: 'Primary' })
    expect(top).toHaveClass('overflow-x-auto', 'overflow-y-hidden')
    expect(bottom).not.toHaveClass('overflow-y-hidden')
  })

  it('navigates to the route when a tab is clicked', () => {
    renderAt('/')
    fireEvent.click(screen.getAllByText('Insights')[0])
    expect(screen.getByTestId('pathname')).toHaveTextContent('/insights')
  })
})
