import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import DayTimeline from './DayTimeline'

/*
 * Mobile day timeline — the second branch a `BusyBlock` renders through
 * (`PLANNER.mHourH = 48`). Chunk 51c: a 30-minute block (22px here) must
 * show its title without the popover; a 15-minute block stays tint-only.
 */

describe('DayTimeline (chunk 51c — tight busy blocks)', () => {
  it('a 30-minute block shows its title at hourH 48; a 15-minute block does not', () => {
    render(
      <DayTimeline
        busy={[
          { day: 2, startMin: 600, endMin: 630, source: 'outlook', title: 'Half hour' },
          { day: 2, startMin: 660, endMin: 675, source: 'icloud', title: 'Quarter hour' },
        ]}
        isToday={false}
        nowMin={0}
        stale={false}
        staleTime={null}
        fetchedAt={Date.now()}
        phase="ready"
        errorMessage={null}
      />,
    )
    const half = screen.getByRole('button', { name: /Half hour/ })
    expect(half.style.height).toBe('22px')
    expect(half).toHaveTextContent('Half hour')
    const quarter = screen.getByRole('button', { name: /Quarter hour/ })
    expect(quarter.style.height).toBe('14px')
    expect(quarter).toHaveTextContent('')
  })
})
