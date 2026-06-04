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
  it('renders all four routes across the top + bottom navs', () => {
    renderAt('/')
    // 4 top + 4 bottom = 8 tab buttons
    expect(screen.getAllByRole('button')).toHaveLength(8)
    // Dashboard reads "Dashboard" on top, "Tasks" in the bottom bar
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    // The shared labels appear once per nav
    expect(screen.getAllByText('Routines')).toHaveLength(2)
    expect(screen.getAllByText('Insights')).toHaveLength(2)
    expect(screen.getAllByText('Settings')).toHaveLength(2)
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
    renderAt('/routines')
    const current = screen.getAllByRole('button', { current: 'page' })
    expect(current).toHaveLength(2)
    current.forEach((b) => expect(b).toHaveTextContent(/routines/i))
  })

  it('marks NO tab active on the drill-down routes', () => {
    renderAt('/category/abc')
    expect(screen.queryAllByRole('button', { current: 'page' })).toHaveLength(0)

    renderAt('/subcategory/xyz')
    expect(screen.queryAllByRole('button', { current: 'page' })).toHaveLength(0)
  })

  it('navigates to the route when a tab is clicked', () => {
    renderAt('/')
    fireEvent.click(screen.getAllByText('Insights')[0])
    expect(screen.getByTestId('pathname')).toHaveTextContent('/insights')
  })
})
