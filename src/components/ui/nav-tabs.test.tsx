import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TopTabs } from './nav-tabs'

/*
 * Chunk 68 (UX audit #17, scrollbar): the active underline sits inside the nav
 * box. At `-bottom-px` it hung one pixel below it, which was 1px of vertical
 * overflow and a scrollbar thumb on every page.
 */
describe('TopTabs — active underline (chunk 68)', () => {
  it('keeps the underline inside the nav (bottom-0, not -bottom-px)', () => {
    render(
      <TopTabs
        ariaLabel="Primary"
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        value="a"
        onChange={() => {}}
      />,
    )
    const active = screen.getByRole('button', { current: 'page' })
    expect(active).toHaveTextContent('Alpha')
    const underline = active.querySelector('span[aria-hidden]') as HTMLElement
    expect(underline).toHaveClass('bottom-0', 'h-0.5')
    expect(underline).not.toHaveClass('-bottom-px')

    // The inactive tab's (transparent) underline occupies the same box.
    const idle = screen
      .getByRole('button', { name: 'Beta' })
      .querySelector('span[aria-hidden]') as HTMLElement
    expect(idle).toHaveClass('bottom-0')
    expect(idle).not.toHaveClass('-bottom-px')

    expect(screen.getByRole('navigation', { name: 'Primary' })).toHaveClass(
      'border-b',
    )
  })
})
