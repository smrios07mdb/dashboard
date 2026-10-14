import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { DOT_GRID_DAYS } from '@/lib/streak'
import RoutineDotGrid from './RoutineDotGrid'

/*
 * Chunk 75a — the weekday letters are text, so they use `--ink-3`
 * (>= 4.5:1), never `--ink-4`.
 */

describe('RoutineDotGrid (chunk 75a)', () => {
  it('renders every weekday letter in text-ink-3', () => {
    render(
      <RoutineDotGrid
        routine="morning"
        items={[]}
        logs={[]}
        todayKey="2026-10-13"
        timezone="America/New_York"
      />,
    )
    const letters = screen
      .getAllByRole('listitem')
      .map((cell) => within(cell).getByText(/^[SMTWF]$/))
    expect(letters).toHaveLength(DOT_GRID_DAYS)
    for (const letter of letters) {
      expect(letter.className).toContain('text-ink-3')
      expect(letter.className).not.toContain('text-ink-4')
    }
  })
})
