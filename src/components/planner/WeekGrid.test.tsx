import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { GetBusyResult } from '@/lib/calendarApi'
import { busyToWeekBlocks, type WeekBusyBlock } from '@/lib/plannerGeometry'
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
      phase="ready"
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

// ============================================================
// Chunk 37 — scheduled task blocks
// ============================================================

import type { Task } from '@/db/types'
import type { GridTaskBlock } from './WeekGrid'

const aTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't-1',
  userId: 'u-1',
  subcategoryId: 'sub-1',
  title: 'Draft launch brief',
  notes: null,
  estimateMinutes: 45,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: 1,
  completedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  ...overrides,
})

const aGridBlock = (
  overrides: Partial<GridTaskBlock> = {},
  blockOverrides: Partial<GridTaskBlock['block']> = {},
): GridTaskBlock => ({
  block: {
    id: 'b-1',
    taskId: 't-1',
    day: 0,
    startMin: 600,
    endMin: 660,
    ...blockOverrides,
  },
  task: aTask(),
  catName: 'Work',
  done: false,
  carry: false,
  ...overrides,
})

describe('WeekGrid (chunk 37 — task blocks)', () => {
  it('renders a task block with title, mono range and the P1 chip', () => {
    renderGrid({ scheduled: [aGridBlock()] })
    const block = screen.getByRole('button', { name: 'Draft launch brief, 10:00–11:00' })
    expect(block).toHaveTextContent('10:00–11:00')
    expect(block).toHaveTextContent('P1')
    expect(block.style.opacity).toBe('1')
  })

  it('done styling: strikethrough, no P1 chip, 72% opacity, "done" in the label', () => {
    renderGrid({ scheduled: [aGridBlock({ done: true })] })
    const block = screen.getByRole('button', {
      name: 'Draft launch brief, 10:00–11:00, done',
    })
    expect(block.style.opacity).toBe('0.72')
    expect(block).not.toHaveTextContent('P1')
    const title = screen.getByText('Draft launch brief') as HTMLElement
    expect(title.style.textDecorationLine).toBe('line-through')
  })

  it('rails count includes a scheduled block past 19:00', () => {
    renderGrid({
      busy: [],
      scheduled: [aGridBlock({}, { startMin: 1110, endMin: 1200 })],
    })
    expect(screen.getByText(/SHOW 19:00 – 21:00/)).toHaveTextContent('· 1 HIDDEN')
  })

  it('hover reveals the action row; × fires onUnschedule, check fires onToggleDone', () => {
    const onUnschedule = vi.fn()
    const onToggleDone = vi.fn()
    renderGrid({ scheduled: [aGridBlock()], onUnschedule, onToggleDone })
    const block = screen.getByRole('button', { name: 'Draft launch brief, 10:00–11:00' })
    expect(screen.queryByRole('button', { name: 'Unschedule' })).not.toBeInTheDocument()
    fireEvent.mouseEnter(block)
    fireEvent.click(screen.getByRole('button', { name: 'Unschedule' }))
    expect(onUnschedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-1' }))
  })

  it('Enter on a block opens the action sheet path (onOpenActions)', () => {
    const onOpenActions = vi.fn()
    renderGrid({ scheduled: [aGridBlock()], onOpenActions })
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Draft launch brief, 10:00–11:00' }),
      { key: 'Enter' },
    )
    expect(onOpenActions).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-1' }))
  })

  it('empty-week copy gates on scheduled blocks only — shows with busy present (R4)', () => {
    const { rerender } = renderGrid({ scheduled: [] })
    expect(screen.getByText('Standup')).toBeInTheDocument()
    expect(screen.getByText('Nothing planned yet.')).toBeInTheDocument()
    expect(
      screen.getByText('Drag a task from the tray onto a time.'),
    ).toBeInTheDocument()
    rerender(
      <WeekGrid
        days={week}
        todayIdx={2}
        nowMin={680}
        busy={[]}
        stale={false}
        staleTime={null}
        fetchedAt={Date.now()}
        phase="ready"
        errorMessage={null}
        dayFree={[540, 540, 390, 540, 540, undefined, undefined]}
        scheduled={[aGridBlock()]}
      />,
    )
    expect(screen.queryByText('Nothing planned yet.')).not.toBeInTheDocument()
  })

  it('empty-week copy is suppressed while cold (no data yet)', () => {
    renderGrid({ busy: [], scheduled: [], phase: 'cold' })
    expect(screen.queryByText('Nothing planned yet.')).not.toBeInTheDocument()
  })

  it('dims only when cold — a background refresh keeps full opacity (R3)', () => {
    const { rerender } = renderGrid({ scheduled: [aGridBlock()], phase: 'refreshing' })
    expect(screen.getByTestId('week-grid-root')).not.toHaveClass('opacity-50')
    expect(screen.getByText('Draft launch brief')).toBeInTheDocument()
    rerender(
      <WeekGrid
        days={week}
        todayIdx={2}
        nowMin={680}
        busy={[]}
        stale={false}
        staleTime={null}
        fetchedAt={null}
        phase="cold"
        errorMessage={null}
        dayFree={[540, 540, 390, 540, 540, undefined, undefined]}
      />,
    )
    expect(screen.getByTestId('week-grid-root')).toHaveClass('opacity-50')
  })

  it('done toggle re-render emits no React style warning (R6)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { rerender } = renderGrid({ scheduled: [aGridBlock()] })
      rerender(
        <WeekGrid
          days={week}
          todayIdx={2}
          nowMin={680}
          busy={busy}
          stale={false}
          staleTime={null}
          fetchedAt={Date.now()}
          phase="ready"
          errorMessage={null}
          dayFree={[540, 540, 390, 540, 540, undefined, undefined]}
          scheduled={[aGridBlock({ done: true })]}
        />,
      )
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('renders the drop preview for a live tray drag, destructive on busy overlap', () => {
    const dragTask = aTask({ id: 't-9', title: 'Dragged' })
    // Over WED 09:15–10:00 → overlaps Standup (09:00–10:30) by 45m.
    renderGrid({
      drag: {
        kind: 'tray',
        task: dragTask,
        catName: 'Work',
        durationMin: 45,
        px: 0,
        py: 0,
        over: { day: 2, startMin: 555, endMin: 600 },
      },
    })
    const slot = screen.getByTestId('drop-slot')
    expect(slot).toHaveTextContent('09:15–10:00')
    expect(slot).toHaveTextContent('OVERLAPS STANDUP · 45M')
    // No empty-week copy while dragging.
    expect(screen.queryByText('Nothing planned yet.')).not.toBeInTheDocument()
  })

  it('applies a live resize preview to the block itself', () => {
    const g = aGridBlock()
    renderGrid({
      scheduled: [g],
      drag: {
        kind: 'resize',
        block: g.block,
        over: { day: 0, startMin: 600, endMin: 690 },
      },
    })
    expect(
      screen.getByRole('button', { name: 'Draft launch brief, 10:00–11:30' }),
    ).toBeInTheDocument()
  })
})

// ============================================================
// Chunk 38 — proposals + carryover
// ============================================================

describe('WeekGrid (chunk 38 — proposals)', () => {
  const proposal = (startMin: number, endMin: number) => ({
    taskId: 't-1',
    day: 0,
    startMin,
    endMin,
    task: aTask(),
    catName: 'Work',
  })

  it('renders a proposal preview with title and "· proposed" at ≥40px', () => {
    renderGrid({ proposals: [proposal(600, 660)] })
    const block = screen.getByTestId('proposal-block')
    expect(block).toHaveTextContent('Draft launch brief')
    expect(block).toHaveTextContent('10:00–11:00 · proposed')
    expect(block).toHaveAttribute('aria-hidden', 'true')
    // Only the `border` shorthand, no longhand next to it.
    expect(block.style.borderLeft).toBe('')
  })

  it('shows the title only under 40px', () => {
    renderGrid({ proposals: [proposal(600, 630)] })
    const block = screen.getByTestId('proposal-block')
    expect(block).toHaveTextContent('Draft launch brief')
    expect(block).not.toHaveTextContent('proposed')
  })

  it('hides the empty-week copy when only proposals exist', () => {
    renderGrid({ proposals: [proposal(600, 660)] })
    expect(screen.queryByText('Nothing planned yet.')).not.toBeInTheDocument()
  })
})

describe('WeekGrid (chunk 38 — carryover)', () => {
  it('carry block: hollow, dashed, "· unfinished", → on hover fires onCarryMove', () => {
    const onCarryMove = vi.fn()
    const g = aGridBlock({ carry: true })
    renderGrid({ scheduled: [g], onCarryMove })
    const block = screen.getByRole('button', {
      name: 'Draft launch brief, 10:00–11:00, unfinished',
    })
    expect(block).toHaveTextContent('10:00–11:00 · unfinished')
    expect(block.className).toContain('border-dashed')
    expect(block.style.opacity).toBe('1')
    expect(block.style.boxShadow).toBe('none')
    expect(block.style.border).toBe('')
    expect(
      screen.queryByRole('button', { name: 'Move to next open slot' }),
    ).not.toBeInTheDocument()
    fireEvent.mouseEnter(block)
    fireEvent.click(screen.getByRole('button', { name: 'Move to next open slot' }))
    expect(onCarryMove).toHaveBeenCalledWith(g.block)
  })

  it('done beats carry: strikethrough, no → control, "done" in the label', () => {
    renderGrid({ scheduled: [aGridBlock({ carry: true, done: true })], onCarryMove: vi.fn() })
    const block = screen.getByRole('button', {
      name: 'Draft launch brief, 10:00–11:00, done',
    })
    fireEvent.mouseEnter(block)
    expect(
      screen.queryByRole('button', { name: 'Move to next open slot' }),
    ).not.toBeInTheDocument()
    expect(block).not.toHaveTextContent('unfinished')
    const title = screen.getByText('Draft launch brief') as HTMLElement
    expect(title.style.textDecorationLine).toBe('line-through')
  })

  it('D15: toggling plain → carry → done logs no conflicting-style console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { rerender } = renderGrid({ scheduled: [aGridBlock()] })
      const again = (g: GridTaskBlock) =>
        rerender(
          <WeekGrid
            days={week}
            todayIdx={2}
            nowMin={680}
            busy={busy}
            stale={false}
            staleTime={null}
            fetchedAt={Date.now()}
            phase="ready"
            errorMessage={null}
            dayFree={[540, 540, 390, 540, 540, undefined, undefined]}
            scheduled={[g]}
          />,
        )
      again(aGridBlock({ carry: true }))
      again(aGridBlock({ carry: true, done: true }))
      again(aGridBlock())
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('WeekGrid (chunk 39 — planner mirror)', () => {
  it('a plannerEvents entry from getBusy is never rendered as a BusyBlock', () => {
    // The proxy keeps hupo-block- events out of `busy` and reports them on
    // the side; the client feeds only the array through busyToWeekBlocks.
    const fromProxy: GetBusyResult = Object.assign(
      [
        {
          start: new Date(2026, 4, 6, 9, 0).toISOString(),
          end: new Date(2026, 4, 6, 10, 30).toISOString(),
          source: 'icloud' as const,
          title: 'Dentist',
        },
      ],
      {
        plannerEvents: [
          {
            uid: 'hupo-block-1',
            start: new Date(2026, 4, 6, 14, 0).toISOString(),
            end: new Date(2026, 4, 6, 15, 0).toISOString(),
          },
        ],
      },
    )
    const week0 = new Date(2026, 4, 4)
    const weekBusy = busyToWeekBlocks(fromProxy, week0)
    expect(weekBusy).toHaveLength(1)
    renderGrid({ busy: weekBusy, scheduled: [] })
    expect(screen.getByText('Dentist')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /dentist/i })).toHaveLength(1)
    // Nothing on the grid for the mirror's 14:00–15:00.
    expect(screen.queryByText(/14:00–15:00/)).toBeNull()
  })
})
