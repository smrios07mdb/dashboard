import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { WeekBusyBlock } from '@/lib/plannerGeometry'
import WeekGrid, { type WeekGridProps } from './WeekGrid'

/*
 * Desktop week grid (chunk 36) — component-level checks for the pieces a
 * unit test can pin without a browser: busy-block rendering per source,
 * the stale-feed conditional (55% blocks + `OUTLOOK · HH:MM` cache tag),
 * the popover open / Escape-close cycle with its fresh-vs-stale sync
 * line, and the collapsed-window clip stamp. Geometry itself is covered
 * in lib/plannerGeometry.test.ts; pixel fidelity is the on-device check.
 */

const week = [4, 5, 6, 7, 8, 9, 10].map((n) => new Date(2026, 4, n))

const busy: WeekBusyBlock[] = [
  // Tall enough (90m ≥ 46px) for the source tag to render.
  { day: 2, startMin: 540, endMin: 630, source: 'outlook', title: 'Standup' },
  { day: 3, startMin: 600, endMin: 690, source: 'icloud', title: 'Dentist' },
]

function renderGrid(overrides: Partial<WeekGridProps> = {}) {
  return render(
    <WeekGrid
      days={week}
      todayIdx={2}
      nowMin={680}
      busy={busy}
      stale={false}
      staleTime={null}
      fetchedAt={Date.now()}
      loading={false}
      errorMessage={null}
      dayFree={[540, 540, 390, 540, 540, undefined, undefined]}
      {...overrides}
    />,
  )
}

describe('WeekGrid (chunk 36)', () => {
  it('renders busy blocks from both sources with their source tags', () => {
    renderGrid()
    expect(screen.getByText('Standup')).toBeInTheDocument()
    expect(screen.getByText('Dentist')).toBeInTheDocument()
    expect(screen.getByText('OUTLOOK')).toBeInTheDocument()
    expect(screen.getByText('ICLOUD')).toBeInTheDocument()
  })

  it('renders per-day free figures and the past/weekend variants', () => {
    renderGrid({ dayFree: [null, 540, 390, 540, 540, undefined, undefined] })
    // 1 past day + 2 weekend days all get the same placeholder.
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.getByText('6h 30m free')).toBeInTheDocument() // today from now
  })

  it('stale feed: Outlook blocks dim to 55% and tag the cache time; iCloud untouched', () => {
    renderGrid({ stale: true, staleTime: '09:14' })
    const outlookBlock = screen
      .getByText('OUTLOOK · 09:14')
      .closest('button') as HTMLElement
    expect(outlookBlock.style.opacity).toBe('0.55')
    const icloudBlock = screen.getByText('ICLOUD').closest('button') as HTMLElement
    expect(icloudBlock.style.opacity).toBe('1')
  })

  it('opens the popover on click with the fresh sync line, closes on Escape', () => {
    renderGrid({ fetchedAt: Date.now() - 12 * 60_000 })
    fireEvent.click(screen.getByText('Standup'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('OUTLOOK · WORK FEED')
    expect(dialog).toHaveTextContent('09:00–10:30')
    expect(dialog).toHaveTextContent('Synced 12m ago')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stale popover shows the amber cached line instead', () => {
    renderGrid({ stale: true, staleTime: '09:14' })
    fireEvent.click(screen.getByText('Standup'))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Cached at 09:14 — feed unreachable',
    )
  })

  it('clamps a block crossing the collapsed top edge and stamps ↑ HH:MM', () => {
    renderGrid({
      busy: [{ day: 2, startMin: 450, endMin: 510, source: 'icloud', title: 'Gym' }],
    })
    expect(screen.getByText('↑ 07:30')).toBeInTheDocument()
    // Expanding the top window to 07:00 removes the clamp stamp.
    fireEvent.click(screen.getByText(/SHOW 07:00 – 08:00/))
    expect(screen.queryByText('↑ 07:30')).not.toBeInTheDocument()
  })

  it('stretches the expanded window to reach blocks outside 07:00–21:00', () => {
    // 05:00–06:00 block: invisible collapsed, counted by the top rail, and
    // reachable once expanded (the fixed 07:00 floor left it unreachable).
    renderGrid({
      busy: [
        { day: 1, startMin: 300, endMin: 360, source: 'icloud', title: 'Early' },
      ],
    })
    expect(screen.queryByText('Early')).not.toBeInTheDocument()
    const rail = screen.getByText(/SHOW 05:00 – 08:00/)
    expect(rail).toHaveTextContent('· 1 HIDDEN')
    fireEvent.click(rail)
    expect(screen.getByText('Early')).toBeInTheDocument()
  })

  it('rails show hidden-block counts per edge', () => {
    renderGrid({
      busy: [
        { day: 0, startMin: 450, endMin: 495, source: 'icloud' },
        { day: 3, startMin: 1140, endMin: 1260, source: 'icloud' },
      ],
    })
    const rails = screen.getAllByText(/· 1 HIDDEN/)
    expect(rails).toHaveLength(2)
  })

  it('renders the quiet inline notice on busy-fetch error', () => {
    renderGrid({
      busy: [],
      errorMessage: 'Could not reach the calendar service — retry.',
    })
    expect(
      screen.getByText(/Could not reach the calendar service/),
    ).toBeInTheDocument()
  })
})
