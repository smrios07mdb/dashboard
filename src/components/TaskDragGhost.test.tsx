import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { subColor } from '@/lib/gamify'

import TaskDragGhost from './TaskDragGhost'

/*
 * Chunk 88 (D4): the overlay a task drag renders, so the row is never clipped
 * by its column card. One line: the list's hue dot and the title.
 */
describe('TaskDragGhost (chunk 88)', () => {
  it('shows the title on one line and the list hue dot', () => {
    render(<TaskDragGhost title="Atlas launch" subcategoryId="s1" width={300} />)
    const title = screen.getByText('Atlas launch')
    expect(title).toHaveClass('truncate')
    const ghost = screen.getByTestId('task-drag-ghost')
    const dot = ghost.querySelector('[data-hue-dot]') as HTMLElement
    expect(dot).not.toBeNull()
    expect(dot.style.background).toBe(subColor('s1'))
    expect(ghost).toHaveClass('bg-surface', 'border', 'border-line', 'rounded-md', 'shadow-md')
    expect(ghost.style.width).toBe('300px')
  })

  it('caps the width at 420 px', () => {
    render(<TaskDragGhost title="Wide" subcategoryId="s1" width={900} />)
    expect(screen.getByTestId('task-drag-ghost').style.width).toBe('420px')
  })
})
