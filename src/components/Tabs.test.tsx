import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import Tabs from './Tabs'

/*
 * UX-01: <640px gets a fixed, thumb-reachable bottom nav; >=sm keeps the top
 * tabs. jsdom doesn't apply CSS breakpoints, so these assert the responsive
 * class CONTRACT (sm:hidden / hidden sm:flex) + aria-current, not computed
 * visibility (that's the on-device check).
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Tabs />
    </MemoryRouter>,
  )
}

describe('Tabs — responsive nav (UX-01)', () => {
  it('top nav is hidden below sm; bottom nav is fixed and hidden at sm+', () => {
    renderAt('/')
    const top = screen.getByTestId('primary-nav-top')
    const bottom = screen.getByTestId('primary-nav-bottom')
    expect(top.className).toContain('hidden')
    expect(top.className).toContain('sm:flex')
    expect(bottom.className).toContain('fixed')
    expect(bottom.className).toContain('sm:hidden')
  })

  it('renders all four routes in both navs', () => {
    renderAt('/')
    for (const testid of ['primary-nav-top', 'primary-nav-bottom']) {
      const region = screen.getByTestId(testid)
      expect(within(region).getAllByRole('link')).toHaveLength(4)
    }
  })

  it('marks the active route with aria-current="page" in both navs', () => {
    renderAt('/routines')
    const current = screen.getAllByRole('link', { current: 'page' })
    expect(current).toHaveLength(2)
    current.forEach((link) => expect(link).toHaveTextContent(/routines/i))
  })

  it('the fixed bottom bar pads for the home-indicator safe area', () => {
    renderAt('/')
    expect(screen.getByTestId('primary-nav-bottom').className).toContain(
      'env(safe-area-inset-bottom)',
    )
  })
})
