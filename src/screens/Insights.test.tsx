import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory, Task, TrackedSession } from '@/db/types'

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

const { tasksList, subsList, catsList, liveTasksList, sessionsList } =
  vi.hoisted(() => ({
  liveTasksList: vi.fn(),
  sessionsList: vi.fn(),
  tasksList: vi.fn(),
  subsList: vi.fn(),
  catsList: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    tasks: { listCompletedInRange: tasksList, list: liveTasksList },
    trackedSessions: { listInRange: sessionsList },
    subcategories: { list: subsList },
    categories: { list: catsList },
  },
}))

vi.mock('@/lib/userTimezone', () => ({
  browserTimezone: () => 'UTC',
  loadUserTimezone: async () => 'UTC',
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

const ALL_TIME_FROM = '1970-01-01T00:00:00.000Z'

/** `tasks` answers the range query; `allTime` the chunk-70 last-completion one. */
function setup(tasks: Task[], allTime: Task[] = []) {
  tasksList.mockImplementation(async (from: string) =>
    from === ALL_TIME_FROM ? allTime : tasks,
  )
  subsList.mockResolvedValue(SUBS)
  catsList.mockResolvedValue(CATS)
  // Chunk 98: no tracked sessions unless a test says so.
  sessionsList.mockResolvedValue([])
  liveTasksList.mockResolvedValue([])
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

    // Chunk 70: the lead card counts completed tasks; time moved to its own
    // "Estimated time" card.
    expect(
      within((await screen.findByText('Last 30 days')).parentElement!).getByText(
        '5',
      ),
    ).toBeInTheDocument()
    expect(within(cardFor('Last 30 days')).getByText('tasks completed')).toBeInTheDocument()
    expect(within(cardFor('Estimated time')).getByText('8h')).toBeInTheDocument()
    // daily average = round(480 / 30)
    expect(within(cardFor('Daily average')).getByText('16m')).toBeInTheDocument()
    // Chunk 70: the "Active subcategories" card is removed.
    expect(screen.queryByText('Active subcategories')).not.toBeInTheDocument()
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
    // Chunk 75a: the suffix sits on the --work-soft wash, so ink-2.
    expect(within(chip).getByText('vs first half').className).toContain('text-ink-2')
  })

  it('(c) shows the empty state when no tasks are completed in range', async () => {
    setup([])
    render(<Insights />)

    // Chunk 70: new empty title.
    expect(
      await screen.findByText('Nothing completed in the last 30 days.'),
    ).toBeInTheDocument()
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

  it('(f) names the last completion and offers 90 days when the range is empty (chunk 70)', async () => {
    const user = userEvent.setup()
    setup([], [
      { ...task('s1', 30, 0), completedAt: '2026-08-11T09:00:00.000Z' },
      { ...task('s1', 30, 0), completedAt: '2026-09-02T15:00:00.000Z' },
    ])
    render(<Insights />)

    // Prefix only: the year is appended once the run date leaves 2026.
    expect(
      await screen.findByText(/^Last completion was Sep 2(, 2026)?\.$/),
    ).toBeInTheDocument()
    // The lookup runs once, after the empty range query.
    expect(
      tasksList.mock.calls.filter(([from]) => from === ALL_TIME_FROM),
    ).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Show 90 days' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '90 days' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    // At 90 days there is no wider range to offer.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Show 90 days' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('(g) falls back to the generic body when nothing was ever completed (chunk 70)', async () => {
    setup([], [])
    render(<Insights />)

    expect(
      await screen.findByText(
        'Complete a task and it shows up here. Try a wider range or another category.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Last completion/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show 90 days' })).toBeInTheDocument()
  })

  it('(h) skips the last-completion lookup when the range has tasks (chunk 70)', async () => {
    setup(POPULATED)
    render(<Insights />)
    await screen.findByRole('img')

    expect(
      tasksList.mock.calls.filter(([from]) => from === ALL_TIME_FROM),
    ).toHaveLength(0)
    expect(screen.getByText('Est. time')).toBeInTheDocument()
    expect(screen.getByText('What got done')).toBeInTheDocument()
  })
})

/*
 * Chunk 98 — the tracked section under the estimates: focus and breathing
 * sessions saved by the menu bar app. As above, derived text and roles only.
 */
describe('Insights — Focus and breathing (chunk 98)', () => {
  let sessionSeq = 0
  const tracked = (over: Partial<TrackedSession> = {}): TrackedSession => {
    sessionSeq += 1
    return {
      id: `ts-${sessionSeq}`,
      userId: 'u1',
      kind: 'focus',
      startedAt: `${dayKeyAgo(2)}T12:00:00.000Z`,
      endedAt: `${dayKeyAgo(2)}T12:25:00.000Z`,
      plannedSeconds: 1500,
      activeSeconds: 1500,
      outcome: 'completed',
      taskId: null,
      taskTitle: null,
      createdAt: `${dayKeyAgo(2)}T12:25:01.000Z`,
      ...over,
    }
  }

  const liveTask = (id: string, subcategoryId: string, title: string): Task => ({
    ...task(subcategoryId, 0, 1),
    id,
    title,
    completedAt: null,
  })

  /** 60 min of focus on a Work task, 10 on a Personal one, a bare 25 and 5 of breathing. */
  const SESSIONS: TrackedSession[] = [
    tracked({ taskId: 'lt-atlas', taskTitle: 'Old title' }),
    tracked({
      taskId: 'lt-atlas',
      taskTitle: 'Old title',
      activeSeconds: 2100,
      outcome: 'skipped',
    }),
    tracked({
      taskId: 'lt-gym',
      taskTitle: 'Stretch',
      activeSeconds: 600,
      outcome: 'stopped',
    }),
    tracked(),
    tracked({
      kind: 'meditation',
      outcome: 'ended',
      plannedSeconds: 300,
      activeSeconds: 300,
    }),
  ]
  const LIVE = [
    liveTask('lt-atlas', 's1', 'Ship the Atlas deck'),
    liveTask('lt-gym', 's3', 'Stretch'),
  ]

  const section = () =>
    screen.findByRole('region', { name: 'Focus and breathing' })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the heading, the four cards and the chart', async () => {
    setup(POPULATED)
    sessionsList.mockResolvedValue(SESSIONS)
    liveTasksList.mockResolvedValue(LIVE)
    render(<Insights />)

    const s = within(await section())
    expect(
      s.getByRole('heading', { name: 'Focus and breathing' }),
    ).toBeInTheDocument()
    expect(s.getByText('Tracked in the menu bar app')).toBeInTheDocument()

    // 25 + 35 + 10 + 25 = 95 min of focus.
    const focus = within(s.getByText('Focus time').parentElement!)
    expect(focus.getByText('1h 35m')).toBeInTheDocument()
    expect(focus.getByText('tracked, pauses excluded')).toBeInTheDocument()

    const count = within(s.getByText('Focus sessions').parentElement!)
    expect(count.getByText('4')).toBeInTheDocument()
    expect(count.getByText('2 ran to the end')).toBeInTheDocument()

    const breathing = within(
      s.getAllByText('Breathing')[0].parentElement as HTMLElement,
    )
    expect(breathing.getByText('5m')).toBeInTheDocument()
    expect(breathing.getByText('1 sessions')).toBeInTheDocument()

    // The live title, not the one the session saved.
    const most = within(s.getByText('Most focused').parentElement!)
    expect(most.getByText('Ship the Atlas deck')).toBeInTheDocument()
    expect(most.getByText('by tracked time')).toBeInTheDocument()
    expect(s.queryByText('Old title')).not.toBeInTheDocument()

    // The chart, labelled, with its two-series legend.
    expect(
      s.getByRole('img', {
        name: 'Tracked focus and breathing minutes per day for the last 30 days.',
      }),
    ).toBeInTheDocument()
    expect(s.getByText('Focus')).toBeInTheDocument()
    expect(s.getAllByText('Breathing')).toHaveLength(2)
    // Under All there is no category note.
    expect(
      s.queryByText('Bare focus sessions and breathing show under All.'),
    ).not.toBeInTheDocument()
  })

  it('reads the sessions for the same window as the estimates', async () => {
    setup(POPULATED)
    render(<Insights />)
    await section()
    expect(sessionsList).toHaveBeenCalledTimes(1)
    const [from, to] = sessionsList.mock.calls[0]
    expect([from, to]).toEqual(tasksList.mock.calls[0].slice(0, 2))
    expect(from).toBe(`${dayKeyAgo(29)}T00:00:00.000Z`)
  })

  it('a category keeps only focus on its live tasks, and says so', async () => {
    setup(POPULATED)
    sessionsList.mockResolvedValue(SESSIONS)
    liveTasksList.mockResolvedValue(LIVE)
    const user = userEvent.setup()
    render(<Insights />)
    await section()

    await user.click(screen.getByRole('button', { name: 'Work' }))
    let s = within(await section())
    expect(
      s.getByText('Bare focus sessions and breathing show under All.'),
    ).toBeInTheDocument()
    expect(
      within(s.getByText('Focus time').parentElement!).getByText('1h'),
    ).toBeInTheDocument()
    expect(
      within(s.getByText('Focus sessions').parentElement!).getByText('2'),
    ).toBeInTheDocument()
    expect(
      within(s.getAllByText('Breathing')[0].parentElement as HTMLElement).getByText(
        '0m',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Personal' }))
    s = within(await section())
    expect(
      within(s.getByText('Focus time').parentElement!).getByText('10m'),
    ).toBeInTheDocument()
    expect(
      within(s.getByText('Most focused').parentElement!).getByText('Stretch'),
    ).toBeInTheDocument()
  })

  it('a category with no session on its tasks shows the empty line and the note', async () => {
    setup(POPULATED)
    // Only a bare focus and breathing: nothing belongs to a category.
    sessionsList.mockResolvedValue([SESSIONS[3], SESSIONS[4]])
    liveTasksList.mockResolvedValue(LIVE)
    const user = userEvent.setup()
    render(<Insights />)
    const all = within(await section())
    expect(all.getByText('Focus time')).toBeInTheDocument()
    expect(
      within(all.getByText('Most focused').parentElement!).getByText('—'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Work' }))
    const s = within(await section())
    expect(
      s.getByText(
        'No focus or breathing sessions in the last 30 days. Sessions from the menu bar app show here.',
      ),
    ).toBeInTheDocument()
    expect(s.queryByText('Focus time')).not.toBeInTheDocument()
    expect(s.queryByRole('img')).not.toBeInTheDocument()
    expect(
      s.getByText('Bare focus sessions and breathing show under All.'),
    ).toBeInTheDocument()
  })

  it('with no sessions: the empty line, no cards, no chart', async () => {
    setup(POPULATED)
    render(<Insights />)
    const s = within(await section())
    expect(
      s.getByText(
        'No focus or breathing sessions in the last 30 days. Sessions from the menu bar app show here.',
      ),
    ).toBeInTheDocument()
    expect(s.queryByText('Focus time')).not.toBeInTheDocument()
    expect(s.queryByText('Most focused')).not.toBeInTheDocument()
    expect(s.queryByRole('img')).not.toBeInTheDocument()
    // The estimate chart is still the page's one chart.
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('the empty line follows the range', async () => {
    setup(POPULATED)
    const user = userEvent.setup()
    render(<Insights />)
    await section()
    await user.click(screen.getByRole('button', { name: '7 days' }))
    expect(
      await screen.findByText(
        'No focus or breathing sessions in the last 7 days. Sessions from the menu bar app show here.',
      ),
    ).toBeInTheDocument()
  })

  it('a failed sessions read leaves the estimate cards intact', async () => {
    setup(POPULATED)
    sessionsList.mockRejectedValue(new Error('tracked_sessions unreachable'))
    liveTasksList.mockRejectedValue(new Error('tasks unreachable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Insights />)

    await screen.findByText('Estimated time')
    expect(within(cardFor('Estimated time')).getByText('8h')).toBeInTheDocument()
    expect(
      within(cardFor('Most-touched')).getByText('Project Atlas'),
    ).toBeInTheDocument()
    expect(within(cardFor('Last 30 days')).getByText('5')).toBeInTheDocument()
    // The tracked section falls back to its empty line.
    expect(
      within(await section()).getByText(/No focus or breathing sessions/),
    ).toBeInTheDocument()
    expect(error).toHaveBeenCalledWith(
      'Insights tracked sessions load failed',
      expect.any(Error),
    )
    error.mockRestore()
  })

  it('the headline cards and their wording do not change', async () => {
    setup(POPULATED)
    sessionsList.mockResolvedValue(SESSIONS)
    liveTasksList.mockResolvedValue(LIVE)
    render(<Insights />)
    await section()
    expect(within(cardFor('Estimated time')).getByText('sum of task estimates')).toBeInTheDocument()
    expect(
      within(cardFor('Daily average')).getByText('estimated, across all categories'),
    ).toBeInTheDocument()
    expect(within(cardFor('Most-touched')).getByText('by estimated time')).toBeInTheDocument()
  })
})
