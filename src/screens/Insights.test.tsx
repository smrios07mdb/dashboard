import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

/*
 * Behavioral guard for the Insights screen's *derived* surfaces — the Chunk 29
 * additions (4 headline stat cards + the trend chip) and the new empty-state
 * copy — plus the preserved toggle + chart-a11y wiring.
 *
 * It asserts derived TEXT / roles / aria, never colors or the recharts SVG
 * (zero-width ResponsiveContainer under jsdom is unreliable; width/act warnings
 * from it are expected and non-fatal). The aggregation core (lib/insights.ts)
 * stays untested-here — it has its own unit suite.
 */

const { tasksList, subsList, catsList } = vi.hoisted(() => ({
  tasksList: vi.fn(),
  subsList: vi.fn(),
  catsList: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    tasks: { listCompletedInRange: tasksList },
    subcategories: { list: subsList },
    categories: { list: catsList },
  },
}))

import Insights from './Insights'

// ---------- fixtures ----------

/** UTC date key `n` days before today — mirrors the screen's own lastNDays. */
function dayKeyAgo(n: number): string {
  const now = new Date()
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n),
  )
  return d.toISOString().slice(0, 10)
}

const cat = (id: string, name: 'Work' | 'Personal'): Category => ({
  id,
  userId: 'u1',
  name,
})

const sub = (id: string, categoryId: string, name: string): Subcategory => ({
  id,
  userId: 'u1',
  categoryId,
  name,
  sortOrder: 0,
  archivedAt: null,
})

let taskSeq = 0
const task = (
  subcategoryId: string,
  estimateMinutes: number,
  daysAgo: number,
): Task => ({
  id: `t${taskSeq++}`,
  userId: 'u1',
  subcategoryId,
  title: 't',
  notes: null,
  estimateMinutes,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: `${dayKeyAgo(daysAgo)}T12:00:00.000Z`,
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
})

const CATS = [cat('c-work', 'Work'), cat('c-personal', 'Personal')]
const SUBS = [
  sub('s1', 'c-work', 'Project Atlas'),
  sub('s2', 'c-work', 'Email'),
  sub('s3', 'c-personal', 'Gym'),
]

/*
 * Default range is 30 days; half = 15. First half = 29..15 days ago, second
 * half = 14..0 days ago. Loading the recent half heavier makes the trend a
 * clean, date-independent +200%:
 *   first half:  60 (s1 @20d) + 60 (s3 @25d) = 120 → firstAvg 120/15 = 8
 *   second half: 240 (s1 @2d) + 120 (s2 @3d)  = 360 → lastAvg  360/15 = 24
 *   trend = round((24-8)/8 * 100) = +200%
 * Totals: s1 300, s2 120, s3 60 → grand 480 (fmt "8h"), daily avg 16 ("16m"),
 * 3 active subs, most-touched "Project Atlas".
 */
const POPULATED: Task[] = [
  task('s1', 60, 20),
  task('s1', 120, 2),
  task('s1', 120, 2),
  task('s2', 120, 3),
  task('s3', 60, 25),
]

function setup(tasks: Task[]) {
  tasksList.mockResolvedValue(tasks)
  subsList.mockResolvedValue(SUBS)
  catsList.mockResolvedValue(CATS)
}

/** The stat card containing `label` (label + value + hint are siblings). */
function cardFor(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement
}

describe('Insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('(a) renders the four headline stat cards with derived values', async () => {
    setup(POPULATED)
    render(<Insights />)

    // total time logged
    expect(
      within((await screen.findByText('Last 30 days')).parentElement!).getByText(
        '8h',
      ),
    ).toBeInTheDocument()
    // daily average = round(480 / 30)
    expect(within(cardFor('Daily average')).getByText('16m')).toBeInTheDocument()
    // active subcategory count (= subs with ≥1 completed task)
    expect(
      within(cardFor('Active subcategories')).getByText('3'),
    ).toBeInTheDocument()
    // most-touched = top sub by minutes
    expect(
      within(cardFor('Most-touched')).getByText('Project Atlas'),
    ).toBeInTheDocument()
  })

  it('(b) shows a positive trend chip when the recent half is heavier', async () => {
    setup(POPULATED)
    render(<Insights />)

    const chip = await screen.findByLabelText(/trend/i)
    expect(chip.textContent).toContain('+')
    expect(chip.textContent).toContain('%')
  })

  it('(c) shows the empty state when no tasks are completed in range', async () => {
    setup([])
    render(<Insights />)

    expect(await screen.findByText('No time logged yet.')).toBeInTheDocument()
    // The trend chip is gated on having data — it must be absent here.
    expect(screen.queryByLabelText(/trend/i)).not.toBeInTheDocument()
  })

  it('(d) range and category pills toggle aria-pressed', async () => {
    const user = userEvent.setup()
    setup(POPULATED)
    render(<Insights />)
    await screen.findByRole('img') // settle the initial async load

    const btn90 = screen.getByRole('button', { name: '90 days' })
    await user.click(btn90)
    await waitFor(() =>
      expect(btn90).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    const work = screen.getByRole('button', { name: 'Work' })
    await user.click(work)
    expect(work).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('(e) exposes the chart as a single labeled role="img" (chunk-20 a11y)', async () => {
    setup(POPULATED)
    render(<Insights />)

    const img = await screen.findByRole('img')
    const label = img.getAttribute('aria-label')
    expect(label).toBeTruthy()
    expect(label!.length).toBeGreaterThan(0)
  })
})
