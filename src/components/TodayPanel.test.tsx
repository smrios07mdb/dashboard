import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import TodayPanel, { type TodayPanelProps } from './TodayPanel'
import type { Category, Subcategory, Task } from '@/db/types'

/*
 * Suggestions in the Today panel (chunk 67, UX audit #9). The panel had no
 * component test before this.
 *
 * Fixtures carry no priority, due date or reminder, so nothing is auto-planned
 * and the plan is exactly the `todaySet` passed in. That also keeps the tests
 * clock-free: the only "today"-dependent output is the header date label.
 */

function cat(id: string, name: 'Work' | 'Personal'): Category {
  return { id, userId: 'u1', name }
}

function sub(id: string, categoryId: string, name: string): Subcategory {
  return { id, userId: 'u1', categoryId, name, sortOrder: 0, archivedAt: null }
}

function task(
  id: string,
  subcategoryId: string,
  createdAt: string,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    userId: 'u1',
    subcategoryId,
    title: id,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

const CATEGORIES = [cat('c-work', 'Work'), cat('c-personal', 'Personal')]
const SUBCATEGORIES = [
  sub('s-work', 'c-work', 'Deals'),
  sub('s-home', 'c-personal', 'Home'),
]

// Suggestion order (lib/todaySuggest): oldest first, categories taking turns —
// Work 1, Home 1, Work 2, Home 2, Work 3.
const TASKS = [
  task('Work 1', 's-work', '2026-08-01T12:00:00.000Z'),
  task('Work 2', 's-work', '2026-08-02T12:00:00.000Z'),
  task('Work 3', 's-work', '2026-08-03T12:00:00.000Z'),
  task('Home 1', 's-home', '2026-08-10T12:00:00.000Z'),
  task('Home 2', 's-home', '2026-08-11T12:00:00.000Z'),
]

function setup(props: Partial<TodayPanelProps> = {}, tasks: Task[] = TASKS) {
  const onToggleToday = vi.fn()
  const onCompleteTask = vi.fn()
  const utils = render(
    <TodayPanel
      data={{ categories: CATEGORIES, subcategories: SUBCATEGORIES, tasks }}
      todaySet={new Set()}
      timeZone="America/New_York"
      onToggleToday={onToggleToday}
      onCompleteTask={onCompleteTask}
      variant="stacked"
      {...props}
    />,
  )
  return { ...utils, onToggleToday, onCompleteTask }
}

const region = () => screen.getByRole('region', { name: 'Suggested for today' })
const queryRegion = () =>
  screen.queryByRole('region', { name: 'Suggested for today' })

/** Suggested task titles, in display order. */
function suggested(): string[] {
  return within(region())
    .getAllByRole('button', { name: /^Add ".*" to today's plan$/ })
    .map((b) => b.getAttribute('aria-label')!.match(/^Add "(.*)" to/)![1])
}

const done = (t: Task): Task => ({
  ...t,
  completedAt: '2026-09-02T12:00:00.000Z',
})

describe('TodayPanel suggestions', () => {
  it('offers three suggestions for an empty stacked plan', () => {
    setup()
    expect(suggested()).toEqual(['Work 1', 'Home 1', 'Work 2'])
    expect(within(region()).getByText('Suggested')).toBeInTheDocument()
    expect(within(region()).getAllByRole('listitem')).toHaveLength(3)
    // Each row names its subcategory and estimate.
    const first = within(region()).getAllByRole('listitem')[0]
    expect(within(first).getByText('Deals')).toBeInTheDocument()
    expect(first.textContent).toContain('30m')
    // The header line is unchanged; the dashed hint gives way to one line.
    expect(screen.getByText('Nothing planned yet.')).toBeInTheDocument()
    expect(screen.getByText(/on any task\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/to plan your day/)).toBeNull()
  })

  it('Add pins that task', async () => {
    const { onToggleToday } = setup()
    await userEvent.click(
      screen.getByRole('button', { name: 'Add "Home 1" to today\'s plan' }),
    )
    expect(onToggleToday).toHaveBeenCalledTimes(1)
    expect(onToggleToday).toHaveBeenCalledWith('Home 1', true)
  })

  it('Add all pins every suggestion, in order', async () => {
    const { onToggleToday } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Add all 3' }))
    expect(onToggleToday.mock.calls).toEqual([
      ['Work 1', true],
      ['Home 1', true],
      ['Work 2', true],
    ])
  })

  it('Skip swaps in the next candidate and writes nothing', async () => {
    const { onToggleToday, onCompleteTask } = setup()
    await userEvent.click(
      screen.getByRole('button', { name: 'Skip "Work 1" for now' }),
    )
    expect(suggested()).toEqual(['Work 2', 'Home 1', 'Work 3'])
    expect(onToggleToday).not.toHaveBeenCalled()
    expect(onCompleteTask).not.toHaveBeenCalled()
  })

  it('offers two when one task is planned', () => {
    setup({ todaySet: new Set(['Work 1']) })
    expect(suggested()).toEqual(['Work 2', 'Home 1'])
    expect(screen.getByRole('button', { name: 'Add all 2' })).toBeInTheDocument()
    // The planned task is a plan row, not a suggestion.
    expect(
      screen.getByRole('button', { name: 'Remove "Work 1" from Today' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Pinned')).toBeInTheDocument()
  })

  it('offers one, without Add all, when two are planned', () => {
    setup({ todaySet: new Set(['Work 1', 'Home 1']) })
    expect(suggested()).toEqual(['Work 2'])
    expect(screen.queryByRole('button', { name: /^Add all/ })).toBeNull()
  })

  it('offers nothing once three are planned', () => {
    setup({ todaySet: new Set(['Work 1', 'Home 1', 'Work 2']) })
    expect(queryRegion()).toBeNull()
  })

  it('offers nothing when the three planned tasks are all done', () => {
    const tasks = TASKS.map((t) =>
      ['Work 1', 'Home 1', 'Work 2'].includes(t.id) ? done(t) : t,
    )
    setup({ todaySet: new Set(['Work 1', 'Home 1', 'Work 2']) }, tasks)
    expect(queryRegion()).toBeNull()
    // Chunk 74: the header line says it; no hint box repeats it.
    expect(
      screen.getByText('Plan cleared — every today task done.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/All done for today\./)).toBeNull()
    expect(screen.queryByText(/to plan your day/)).toBeNull()
  })

  // Chunk 74: nothing to list, nothing to suggest — the header line is enough.
  it('shows only the header line when there is nothing to suggest', () => {
    const { container } = setup({}, TASKS.map(done))
    expect(queryRegion()).toBeNull()
    expect(screen.getByText('Nothing planned yet.')).toBeInTheDocument()
    expect(screen.queryByText(/to plan your day/)).toBeNull()
    expect(screen.queryByText(/on any task/)).toBeNull()
    // The card holds the header and nothing else.
    expect(container.firstElementChild!.children).toHaveLength(1)
  })

  it.each(['stacked', 'rail', 'banner'] as const)(
    'renders the busy node in the %s header, after the date',
    (variant) => {
      setup({ variant, busy: <span>Busy 12–12:30</span> })
      const busy = screen.getByText('Busy 12–12:30')
      const titleRow = screen.getByRole('heading', { name: 'Today' }).parentElement!
      expect(titleRow).toContainElement(busy)
      expect(titleRow.lastElementChild).toBe(busy)
      // Wraps instead of overflowing the narrow rail.
      expect(titleRow).toHaveClass('flex', 'flex-wrap', 'items-center')
      expect(titleRow).toHaveStyle({ rowGap: '2px' })
    },
  )

  it('suggests in rail, not in banner; off renders nothing', () => {
    const rail = setup({ variant: 'rail' })
    expect(suggested()).toEqual(['Work 1', 'Home 1', 'Work 2'])
    rail.unmount()

    const banner = setup({ variant: 'banner' })
    expect(queryRegion()).toBeNull()
    banner.unmount()

    const off = setup({ variant: 'off' })
    expect(off.container).toBeEmptyDOMElement()
  })

  it('sizes the controls for touch', () => {
    setup({ mobile: true })
    expect(
      screen.getByRole('button', { name: 'Add "Work 1" to today\'s plan' }),
    ).toHaveStyle({ minHeight: '44px' })
    expect(screen.getByRole('button', { name: 'Add all 3' })).toHaveStyle({
      minHeight: '44px',
    })
    expect(
      screen.getByRole('button', { name: 'Skip "Work 1" for now' }),
    ).toHaveStyle({ width: '44px', height: '44px' })
  })
})
