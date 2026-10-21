import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const {
  categoriesList,
  subcategoriesList,
  subcategoriesReorder,
  tasksList,
  tasksUpdate,
  tasksMarkComplete,
  tasksDelete,
  tasksBulkDelete,
  routineLogsList,
  routineItemsList,
  settingsGet,
  getBusyDay,
  sessionUser,
  routingPending,
} = vi.hoisted(() => ({
  categoriesList: vi.fn(),
  subcategoriesList: vi.fn(),
  subcategoriesReorder: vi.fn(),
  tasksList: vi.fn(),
  tasksUpdate: vi.fn(),
  tasksMarkComplete: vi.fn(),
  tasksDelete: vi.fn(),
  tasksBulkDelete: vi.fn(),
  routineLogsList: vi.fn(),
  routineItemsList: vi.fn(),
  settingsGet: vi.fn(),
  // Chunk 74: the busy fetch, and a session user for the cases that need one.
  getBusyDay: vi.fn(),
  sessionUser: { value: null as { id: string; email: string } | null },
  // Chunk 89: pending routing proposals behind the Sort General chip.
  routingPending: vi.fn(),
}))

// Chunk 90: the Sort General button's lazy module (its own tests cover the
// proxy call, the error toasts and "Nothing to sort").
const { runSort } = vi.hoisted(() => ({ runSort: vi.fn() }))
vi.mock('@/lib/sortGeneral', () => ({ runSort }))

// Signed out by default, as before chunk 74; the busy cases sign in.
vi.mock('@/lib/auth', () => ({
  useSession: () => ({ user: sessionUser.value, session: null, loading: false }),
}))
vi.mock('@/lib/busyCache', () => ({ getBusyDay }))

vi.mock('@/db/repo', () => ({
  repo: {
    categories: { list: categoriesList },
    subcategories: { list: subcategoriesList, reorder: subcategoriesReorder },
    tasks: {
      list: tasksList,
      update: tasksUpdate,
      // Chunk 72: undo for delete and complete.
      markComplete: tasksMarkComplete,
      delete: tasksDelete,
      bulkDelete: tasksBulkDelete,
    },
    // Chunk 78: the hero's streak is the task streak, so the load no longer
    // reads routines. Kept as spies to assert exactly that.
    routineLogs: { listByRange: routineLogsList },
    routineItems: { list: routineItemsList },
    settings: { get: settingsGet },
    // Chunk 64: the Today plan's synced marks — none, and writes resolve.
    todayMarks: {
      list: () => Promise.resolve([]),
      set: () => Promise.resolve(undefined),
    },
    routing: { pending: routingPending },
  },
}))

// Chunk 78: routines in Today load through their own hook (TodayRoutines.test);
// a marker here keeps this file about the Dashboard's own load.
vi.mock('@/components/TodayRoutines', () => ({
  default: () => <div data-testid="today-routines" />,
}))

// Chunk 63: record what each DndContext is given, render the real one.
// Chunk 88: a probe inside each one records, by context, the droppables it
// holds and its latest onDragEnd, so a test can find the context holding
// both columns' lists without changing the DOM.
const { dndCollisionProps, dndContexts } = vi.hoisted(() => ({
  dndCollisionProps: [] as unknown[],
  dndContexts: new Map<
    string,
    { droppables: string[]; onDragEnd?: (e: unknown) => void }
  >(),
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement, useEffect, useId } = await import('react')
  function Probe({ onDragEnd }: { onDragEnd?: (e: unknown) => void }) {
    const id = useId()
    const { droppableContainers } = actual.useDndContext()
    const droppables = [...droppableContainers.keys()].map(String)
    useEffect(() => {
      dndContexts.set(id, { droppables, onDragEnd })
    })
    useEffect(() => () => void dndContexts.delete(id), [id])
    return null
  }
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dndCollisionProps.push(props.collisionDetection)
      return createElement(
        actual.DndContext,
        props,
        createElement(Probe, {
          onDragEnd: props.onDragEnd as ((e: unknown) => void) | undefined,
        }),
        props.children,
      )
    },
  }
})

import Dashboard from './Dashboard'
import { useSyncStore } from '@/db/syncStore'
import {
  dateKeyDaysAgo,
  startOfDayIso,
  today as clockToday,
} from '@/lib/clock'
import { REVIEW_KEY } from '@/lib/review'
import { taskDragCollision } from '@/lib/taskDragCollision'
import { useTodayListStore } from '@/state/todayList'
import { useUIStore } from '@/state/uiStore'

// Radix DropdownMenu needs these jsdom shims (chunk 72 opens the ⋯ menu).
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )
}

// ---------- compact fixtures (chunk 20 empty-state tests) ----------

function mkCat(id: string, name: 'Work' | 'Personal') {
  return { id, name, userId: 'u1' }
}

function mkSub(
  id: string,
  categoryId: string,
  opts: { archivedAt?: string | null } = {},
) {
  return {
    id,
    name: id,
    categoryId,
    sortOrder: 0,
    userId: 'u1',
    archivedAt: opts.archivedAt ?? null,
  }
}

function mkTask(
  id: string,
  subcategoryId: string,
  opts: {
    completedAt?: string | null
    priority?: 1 | 2 | 3 | null
    createdAt?: string
  } = {},
) {
  return {
    id,
    userId: 'u1',
    subcategoryId,
    title: id,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: opts.priority ?? null,
    completedAt: opts.completedAt ?? null,
    createdAt: opts.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
/** An ISO instant `n` days before now (chunk 74: task age, last review). */
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString()

describe('Dashboard', () => {
  beforeEach(() => {
    categoriesList.mockReset()
    subcategoriesList.mockReset()
    subcategoriesReorder.mockReset().mockResolvedValue(undefined)
    tasksList.mockReset()
    tasksUpdate.mockReset()
    tasksMarkComplete.mockReset()
    tasksDelete.mockReset()
    tasksBulkDelete.mockReset()
    routineLogsList.mockReset()
    routineItemsList.mockReset()
    settingsGet.mockReset()
    // The streak inputs are incidental to most cases — default them to empty
    // so every test renders; cases that care set their own items/logs.
    routineLogsList.mockResolvedValue([])
    routineItemsList.mockResolvedValue([])
    settingsGet.mockResolvedValue(null)
    // Reset stores between tests so refresh-key counts don't bleed across cases.
    useSyncStore.setState({ state: 'synced', lastSyncAt: null })
    useUIStore.setState({ dashboardRefreshKey: 0 })
    // Chunk 74: signed out, Today stacked, no review on record.
    getBusyDay.mockReset()
    sessionUser.value = null
    routingPending.mockReset().mockResolvedValue([])
    useTodayListStore.setState({ todayList: 'stacked' })
    localStorage.removeItem(REVIEW_KEY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not refetch when lastSyncAt ticks', async () => {
    categoriesList.mockResolvedValue([])
    subcategoriesList.mockResolvedValue([])
    tasksList.mockResolvedValue([])

    renderDashboard()

    // Wait for the initial mount + load to settle (loading -> rendered).
    await waitFor(() => {
      expect(categoriesList).toHaveBeenCalledTimes(1)
      expect(subcategoriesList).toHaveBeenCalledTimes(1)
      expect(tasksList).toHaveBeenCalledTimes(1)
    })
    // Chunk 78: no routine reads on load.
    expect(routineLogsList).not.toHaveBeenCalled()
    expect(routineItemsList).not.toHaveBeenCalled()

    // Tick lastSyncAt three times the way the repo's markSyncedNow would.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        useSyncStore.setState({ lastSyncAt: new Date().toISOString() })
        // Microtask flush so any (incorrect) effect re-run could have fired.
        await Promise.resolve()
      })
    }

    // Regression: pre-fix the effect dep was lastSyncAt and each tick
    // re-ran the load. Post-fix the dep is dashboardRefreshKey and
    // lastSyncAt ticks must not retrigger the reads.
    expect(categoriesList).toHaveBeenCalledTimes(1)
    expect(subcategoriesList).toHaveBeenCalledTimes(1)
    expect(tasksList).toHaveBeenCalledTimes(1)
    expect(routineLogsList).not.toHaveBeenCalled()
    expect(routineItemsList).not.toHaveBeenCalled()
  })

  it('archived subcategories do not render and their tasks do not contribute to totals', async () => {
    const workId = 'cat-work'
    const personalId = 'cat-personal'
    categoriesList.mockResolvedValue([
      { id: workId, name: 'Work', userId: 'u1' },
      { id: personalId, name: 'Personal', userId: 'u1' },
    ])
    subcategoriesList.mockResolvedValue([
      {
        id: 'sub-live',
        name: 'Inbox',
        categoryId: workId,
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sub-archived',
        name: 'Old project',
        categoryId: workId,
        sortOrder: 1,
        userId: 'u1',
        archivedAt: '2026-05-25T12:00:00.000Z',
      },
    ])
    tasksList.mockResolvedValue([
      {
        id: 't-live',
        userId: 'u1',
        subcategoryId: 'sub-live',
        title: 'Visible task',
        estimateMinutes: 30,
        dueAt: null,
        remindAt: null,
        notified: false,
        priority: null,
        completedAt: null,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
      },
      {
        id: 't-archived',
        userId: 'u1',
        subcategoryId: 'sub-archived',
        title: 'Hidden task',
        estimateMinutes: 999,
        dueAt: null,
        remindAt: null,
        notified: false,
        priority: null,
        completedAt: null,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
      },
    ])

    const { container } = renderDashboard()

    await waitFor(() => {
      expect(container.textContent).toContain('Inbox')
    })

    // Chunk 70: an open task under an archived sub now surfaces in the
    // Recovered card (with its old list's name), so these two lookups are
    // scoped to the columns — where neither may appear.
    const columns = container.querySelector('.category-cols')!
    expect(columns.textContent).not.toContain('Old project')
    expect(columns.textContent).not.toContain('Hidden task')
    // The "999m" minutes belonging to the archived task must not bubble
    // into the visible totals — 30m is the only live estimate.
    expect(container.textContent).not.toContain('999')
    expect(container.textContent).toContain('30m')
  })

  it('renders the "+ Add subcategory" affordance for each category column', async () => {
    // chunk 20: a board with at least one live subcategory is no longer
    // first-run, so the columns (and their per-column add affordance)
    // render. A fully empty board now shows the first-run card instead —
    // covered by the dedicated first-run test below.
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([
      mkSub('sw1', 'cat-work'),
      mkSub('sp1', 'cat-personal'),
    ])
    tasksList.mockResolvedValue([])

    const { findAllByText } = renderDashboard()

    const buttons = await findAllByText('Add subcategory')
    // One per category column.
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  // Chunk 68: explicit minmax(0,1fr) columns, so a wide child can't stretch an
  // implicit auto-sized one (UX audit #2). Chunk 69: both the one-column
  // default and the second column live on `.category-grid` in index.css, the
  // latter behind a container query on the wrapper — the viewport says
  // nothing about the room page margins and the rail leave.
  it('gives the category grid shrinkable columns at every width', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([
      mkSub('sw1', 'cat-work'),
      mkSub('sp1', 'cat-personal'),
    ])
    tasksList.mockResolvedValue([])

    renderDashboard()

    const work = await screen.findByRole('button', { name: 'Open Work' })
    const personal = screen.getByRole('button', { name: 'Open Personal' })
    const grid = work.closest('header')!.parentElement!.parentElement!
    expect(grid).toContainElement(personal)
    expect(grid).toHaveClass('category-grid', 'grid')
    // Any grid-cols utility would outrank the container rule (utilities are
    // emitted after the components layer).
    expect(grid.className).not.toMatch(/grid-cols-/)
    expect(grid.parentElement).toHaveClass('category-cols', 'min-w-0')
  })

  it('shows the first-run card (and no columns) when there are no live subcategories', async () => {
    // Brand-new account: Work/Personal categories seeded, zero subcategories.
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([])
    tasksList.mockResolvedValue([])

    const { findByText, queryByText } = renderDashboard()

    // The first-run dashed-border CTA card, with one button per seeded category.
    expect(await findByText('Set up your first list')).toBeTruthy()
    expect(queryByText('New list in Work')).toBeTruthy()
    expect(queryByText('New list in Personal')).toBeTruthy()
    // No columns → no per-column "Add subcategory" affordance, no all-clear banner.
    expect(queryByText('Add subcategory')).toBeNull()
    expect(queryByText(/All clear/i)).toBeNull()
  })

  it('shows the all-clear banner above the columns when tasks exist but none are outstanding', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([
      mkTask('t-done', 'sw1', { completedAt: '2026-01-03T00:00:00.000Z' }),
    ])

    const { findByText, container, queryByText } = renderDashboard()

    expect(await findByText(/All clear/i)).toBeTruthy()
    // Columns still render (subcategory visible); first-run card absent.
    expect(container.textContent).toContain('sw1')
    expect(queryByText('Set up your first list')).toBeNull()
  })

  it('shows the normal dashboard (no banner, no card) when an outstanding task exists', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([mkTask('Open task', 'sw1', { completedAt: null })])

    const { findAllByText, queryByText } = renderDashboard()

    // Chunk 67: the title also renders in Today's suggestions.
    expect((await findAllByText('Open task')).length).toBeGreaterThan(0)
    expect(queryByText(/All clear/i)).toBeNull()
    expect(queryByText('Set up your first list')).toBeNull()
  })

  it('renders the one-line hero and the spark pill when nothing is planned', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([
      mkTask('t1', 'sw1', { completedAt: '2026-01-03T00:00:00.000Z' }),
      mkTask('t2', 'sw1'),
      mkTask('t3', 'sw1'),
      mkTask('t4', 'sw1'),
    ])

    const { container, findByRole } = renderDashboard()

    // Chunk 74: none of these is planned, so the hero is one line — no ring
    // (chunk 70 showed an em dash there), no all-time "1/4 done".
    // The fused spark pill opens the existing "What's next?" sheet.
    expect(await findByRole('button', { name: /what.s next/i })).toBeTruthy()
    expect(screen.queryByRole('img', { name: /^Today: / })).toBeNull()
    expect(
      screen.queryByText('Nothing planned yet — pick a few for today.'),
    ).toBeNull()
    expect(container.textContent).not.toContain('1/4 done')
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('feeds the hero ring from the Today plan, not all-time completion (chunk 70)', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    // One open Priority-1 task (auto-planned) and one old completion: the
    // all-time ring read 50%; the plan is 0 of 1.
    tasksList.mockResolvedValue([
      mkTask('t-p1', 'sw1', { priority: 1 }),
      mkTask('t-old', 'sw1', { completedAt: '2026-01-03T00:00:00.000Z' }),
    ])

    const { container, findByRole } = renderDashboard()

    const ring = await findByRole('img', {
      name: 'Today: 0 of 1 planned tasks done',
    })
    expect(within(ring).getByText('0')).toBeInTheDocument()
    expect(within(ring).getByText('%')).toBeInTheDocument()
    expect(container.textContent).toContain('0/1 today')
    expect(within(ring).queryByText('50')).not.toBeInTheDocument()
  })

  it('lists open tasks under an archived subcategory in Recovered and moves them (chunk 70)', async () => {
    const user = userEvent.setup()
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([
      mkSub('sw1', 'cat-work'),
      mkSub('s-arch', 'cat-work', { archivedAt: '2026-05-25T12:00:00.000Z' }),
    ])
    tasksList.mockResolvedValue([
      mkTask('Live task', 'sw1'),
      mkTask('Stranded task', 's-arch'),
      // A completed orphan is not recovered.
      mkTask('Stranded done', 's-arch', {
        completedAt: '2026-01-03T00:00:00.000Z',
      }),
    ])
    tasksUpdate.mockResolvedValue({
      ...mkTask('Stranded task', 's-arch'),
      subcategoryId: 'sw1',
    })

    renderDashboard()

    const card = await screen.findByRole('region', { name: 'Recovered' })
    expect(within(card).getByText('Stranded task')).toBeInTheDocument()
    expect(within(card).getByText('from s-arch')).toBeInTheDocument()
    expect(within(card).queryByText('Stranded done')).not.toBeInTheDocument()

    await user.selectOptions(
      within(card).getByLabelText('Move Stranded task to'),
      'sw1',
    )
    expect(tasksUpdate).toHaveBeenCalledWith('Stranded task', {
      subcategoryId: 'sw1',
    })
    // Moved into a live list → nothing left to recover.
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Recovered' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('renders no Recovered card when every open task has a live subcategory (chunk 70)', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([mkTask('Open task', 'sw1')])

    const { findAllByText, queryByText } = renderDashboard()

    expect((await findAllByText('Open task')).length).toBeGreaterThan(0)
    expect(queryByText('Recovered')).toBeNull()
  })

  it('the hero chip shows the task streak (chunk 78)', async () => {
    // No session user in tests → the loader falls back to the default tz, so
    // place the completions at noon of today and yesterday in that zone.
    const tz = 'America/New_York'
    const tk = clockToday(tz)
    const noon = (key: string) =>
      new Date(Date.parse(startOfDayIso(key, tz)) + 12 * 3600_000).toISOString()

    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([
      mkTask('Open task', 'sw1'),
      mkTask('Done today', 'sw1', { completedAt: noon(tk) }),
      mkTask('Done yesterday', 'sw1', {
        completedAt: noon(dateKeyDaysAgo(tk, 1)),
      }),
    ])

    const { findByTitle } = renderDashboard()

    const chip = await findByTitle('Task streak')
    expect(chip).toHaveTextContent('2')
    expect(chip).toHaveAttribute('aria-label', '2-day task streak')
  })

  it('completing a task updates the streak without a refetch (chunk 78)', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([mkTask('Alpha', 'sw1'), mkTask('Beta', 'sw1')])
    tasksMarkComplete.mockImplementation((id: string, completed: boolean) =>
      Promise.resolve(
        mkTask(id, 'sw1', {
          completedAt: completed ? new Date().toISOString() : null,
        }),
      ),
    )

    renderDashboard()
    await screen.findAllByText('Alpha')
    expect(screen.queryByTitle('Task streak')).toBeNull()

    // Either open task will do: one completion today makes a 1-day streak.
    fireEvent.click(screen.getAllByLabelText('Mark task complete')[0])

    const chip = await screen.findByTitle('Task streak')
    expect(chip).toHaveTextContent('1')
    expect(tasksList).toHaveBeenCalledTimes(1)
  })

  it('renders chevrons on every category and subcategory header', async () => {
    const workId = 'cat-work'
    const personalId = 'cat-personal'
    categoriesList.mockResolvedValue([
      {
        id: workId,
        name: 'Work',
        userId: 'u1',
      },
      {
        id: personalId,
        name: 'Personal',
        userId: 'u1',
      },
    ])
    subcategoriesList.mockResolvedValue([
      {
        id: 'sw1',
        name: 'Inbox',
        categoryId: workId,
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sw2',
        name: 'Projects',
        categoryId: workId,
        sortOrder: 1,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sw3',
        name: 'Admin',
        categoryId: workId,
        sortOrder: 2,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sp1',
        name: 'Errands',
        categoryId: personalId,
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sp2',
        name: 'Health',
        categoryId: personalId,
        sortOrder: 1,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sp3',
        name: 'Home',
        categoryId: personalId,
        sortOrder: 2,
        userId: 'u1',
        archivedAt: null,
      },
    ])
    tasksList.mockResolvedValue([])

    const { container } = renderDashboard()

    // Wait until the load has settled and the columns have rendered.
    await waitFor(() => {
      expect(container.textContent).toContain('Work')
      expect(container.textContent).toContain('Personal')
      expect(container.textContent).toContain('Inbox')
    })

    const chevronCount = (container.textContent?.match(/›/g) ?? []).length
    // 2 category headers + 6 subcategory headers = 8 chevrons minimum.
    expect(chevronCount).toBeGreaterThanOrEqual(8)
  })

  it('mounts the horizon control on each column and Near writes hupo.taskHorizon (chunk 76)', async () => {
    localStorage.removeItem('hupo.taskHorizon')
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([mkTask('t-p2', 'sw1', { priority: 2 })])

    renderDashboard()
    await screen.findAllByText('t-p2')

    const groups = screen.getAllByRole('radiogroup', { name: 'Horizon' })
    expect(groups).toHaveLength(2)
    fireEvent.click(within(groups[0]).getByRole('radio', { name: 'Near' }))
    expect(localStorage.getItem('hupo.taskHorizon')).toBe('near')
    // One preference: both columns follow.
    for (const g of screen.getAllByRole('radiogroup', { name: 'Horizon' })) {
      expect(within(g).getByRole('radio', { name: 'Near' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    }
    localStorage.removeItem('hupo.taskHorizon')
  })

  it('threads the chunk-33 sort + priority wiring through CategoryColumn (chunk-41 merge regression)', async () => {
    // Guards the auto-merge loss found in chunk 41: adopting main's refactored
    // `columns` block silently dropped `onSetTaskPriority` / `sortKey` /
    // `onChangeSortKey` from the CategoryColumn call. Neither branch's suite
    // exercised the dashboard-level threading, so the drop was test-invisible.
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([mkTask('t-p2', 'sw1', { priority: 2 })])
    tasksUpdate.mockImplementation(async (id: string, patch: object) => ({
      ...mkTask('t-p2', 'sw1', { priority: 2 }),
      id,
      ...patch,
    }))

    renderDashboard()
    // Chunk 67: the title also renders in Today's suggestions.
    await screen.findAllByText('t-p2')

    // sortKey/onChangeSortKey threading: each column header mounts the shared
    // TaskSortControl only when the props arrive.
    expect(
      screen.getAllByRole('button', { name: /^Sort tasks/ }).length,
    ).toBeGreaterThanOrEqual(1)

    // onSetTaskPriority threading: chip → picker → pick must reach the repo.
    await userEvent.click(
      screen.getByRole('button', { name: 'Priority 2 — change priority' }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /Urgent/ }))
    await waitFor(() =>
      expect(tasksUpdate).toHaveBeenCalledWith('t-p2', { priority: 1 }),
    )
  })

  it('renders both the priority chip and the Today sun toggle on one dashboard row', async () => {
    // The combined chunk-33 × Today row — neither branch's suite covered a row
    // receiving both `onSetPriority` (redesign) and `onToggleToday` (main).
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([mkTask('t-both', 'sw1', { priority: 2 })])

    renderDashboard()
    // Chunk 67: the title also renders in Today's suggestions.
    await screen.findAllByText('t-both')

    expect(
      screen.getByRole('button', { name: 'Priority 2 — change priority' }),
    ).toBeInTheDocument()
    // Membership label flips Add/Remove; either proves the sun slot rendered.
    expect(
      screen.getByRole('button', { name: /"t-both" (to|from) Today/ }),
    ).toBeInTheDocument()
  })

  it('gives every column DndContext the pointer-based task collision (chunk 63)', async () => {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([
      mkSub('sw1', 'cat-work'),
      mkSub('sp1', 'cat-personal'),
    ])
    tasksList.mockResolvedValue([mkTask('t1', 'sw1')])
    dndCollisionProps.length = 0

    const { findAllByText } = renderDashboard()
    await findAllByText('Add subcategory')

    // Chunk 88: one context over both columns (each render records it).
    expect(dndCollisionProps.length).toBeGreaterThanOrEqual(1)
    for (const recorded of dndCollisionProps) {
      expect(recorded).toBe(taskDragCollision)
    }
  })

  // ---------- chunk 88: one DndContext over both columns ----------

  async function renderTwoColumns() {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([
      mkSub('sw1', 'cat-work'),
      mkSub('sw2', 'cat-work'),
      mkSub('sp1', 'cat-personal'),
    ])
    tasksList.mockResolvedValue([mkTask('t1', 'sw1')])
    const utils = renderDashboard()
    await utils.findAllByText('Add subcategory')
    // Contexts that hold any list's drop target.
    const listContexts = () =>
      [...dndContexts.values()].filter((c) =>
        c.droppables.some((d) => d.startsWith('subdrop:')),
      )
    await waitFor(() =>
      expect(
        listContexts().some(
          (c) =>
            c.droppables.includes('subdrop:sw1') &&
            c.droppables.includes('subdrop:sp1'),
        ),
      ).toBe(true),
    )
    return { contexts: listContexts(), shared: listContexts()[0] }
  }

  it('puts both columns in one DndContext (chunk 88)', async () => {
    const { contexts } = await renderTwoColumns()
    expect(contexts).toHaveLength(1)
    for (const id of ['subdrop:sw1', 'subdrop:sw2', 'subdrop:sp1']) {
      expect(contexts[0].droppables).toContain(id)
    }
  })

  it('moves a Work task dropped on a Personal list (chunk 88)', async () => {
    const { shared } = await renderTwoColumns()
    const onDragEnd = shared.onDragEnd!
    tasksUpdate.mockResolvedValue(mkTask('t1', 'sp1'))
    await act(async () => {
      onDragEnd({
        active: {
          id: 'task:t1',
          data: { current: { taskId: 't1', currentSubcategoryId: 'sw1' } },
        },
        over: {
          id: 'subdrop:sp1',
          data: { current: { type: 'subcategory', subcategoryId: 'sp1' } },
        },
      })
    })
    expect(tasksUpdate).toHaveBeenCalledTimes(1)
    expect(tasksUpdate).toHaveBeenCalledWith('t1', { subcategoryId: 'sp1' })
  })

  it('never reorders a Work list into Personal (chunk 88)', async () => {
    const { shared } = await renderTwoColumns()
    const onDragEnd = shared.onDragEnd!
    await act(async () => {
      onDragEnd({
        active: {
          id: 'sw1',
          data: { current: { sortable: { containerId: 'subs:cat-work' } } },
        },
        over: {
          id: 'sp1',
          data: { current: { sortable: { containerId: 'subs:cat-personal' } } },
        },
      })
    })
    expect(subcategoriesReorder).not.toHaveBeenCalled()
    // The same handler still reorders inside Work.
    await act(async () => {
      onDragEnd({
        active: {
          id: 'sw1',
          data: { current: { sortable: { containerId: 'subs:cat-work' } } },
        },
        over: {
          id: 'sw2',
          data: { current: { sortable: { containerId: 'subs:cat-work' } } },
        },
      })
    })
    expect(subcategoriesReorder).toHaveBeenCalledTimes(1)
    expect(subcategoriesReorder).toHaveBeenCalledWith([
      { id: 'sw2', sortOrder: 0 },
      { id: 'sw1', sortOrder: 1 },
    ])
  })

  // ---------- chunk 72: undo for delete and complete ----------

  function renderWithToaster() {
    return render(
      <MemoryRouter>
        <Dashboard />
        <Toaster />
      </MemoryRouter>,
    )
  }

  const actionsFor = (title: string) =>
    screen.queryByRole('button', { name: `Actions for "${title}"` })

  /** The nearest ancestor of a row's ⋯ holding exactly one complete checkbox. */
  function rowOf(title: string): HTMLElement {
    let el: HTMLElement | null = actionsFor(title)
    while (el) {
      if (el.querySelectorAll('[aria-label^="Mark task"]').length === 1) return el
      el = el.parentElement
    }
    throw new Error(`no row for ${title}`)
  }

  function seedTwoTasks() {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
  }

  it('⋯ → Delete removes the row with no confirm; Undo brings it back and nothing is deleted (chunk 72)', async () => {
    seedTwoTasks()
    tasksList.mockResolvedValue([mkTask('Alpha', 'sw1'), mkTask('Bravo', 'sw1')])

    renderWithToaster()
    await waitFor(() => expect(actionsFor('Alpha')).toBeInTheDocument())

    fireEvent.keyDown(actionsFor('Alpha')!, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Delete$/ }))

    await waitFor(() => expect(actionsFor('Alpha')).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(actionsFor('Bravo')).toBeInTheDocument()
    expect(await screen.findByText('Task deleted')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(actionsFor('Alpha')).toBeInTheDocument())
    expect(tasksBulkDelete).not.toHaveBeenCalled()
    expect(tasksDelete).not.toHaveBeenCalled()
  })

  it('checking a row off offers Undo, which un-completes it; unchecking shows no toast (chunk 72)', async () => {
    seedTwoTasks()
    tasksList.mockResolvedValue([
      mkTask('Alpha', 'sw1'),
      // Chunk 86: recent, so the completion is listed (30-day rule).
      mkTask('Done', 'sw1', {
        completedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      }),
    ])
    tasksMarkComplete.mockImplementation((id: string, completed: boolean) =>
      Promise.resolve(
        mkTask(id, 'sw1', {
          completedAt: completed ? '2026-01-04T00:00:00.000Z' : null,
        }),
      ),
    )

    renderWithToaster()
    await waitFor(() => expect(actionsFor('Alpha')).toBeInTheDocument())

    // Unchecking: the write happens, no toast.
    fireEvent.click(screen.getByRole('button', { name: '1 completed' }))
    await waitFor(() => expect(actionsFor('Done')).toBeInTheDocument())
    fireEvent.click(within(rowOf('Done')).getByLabelText('Mark task incomplete'))
    await waitFor(() =>
      expect(tasksMarkComplete).toHaveBeenCalledWith('Done', false),
    )
    await waitFor(() =>
      expect(
        within(rowOf('Done')).getByLabelText('Mark task complete'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('Task completed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()

    // Checking off: toast with Undo; Undo writes the un-complete.
    tasksMarkComplete.mockClear()
    fireEvent.click(within(rowOf('Alpha')).getByLabelText('Mark task complete'))
    await waitFor(() =>
      expect(tasksMarkComplete).toHaveBeenCalledWith('Alpha', true),
    )
    expect(await screen.findByText('Task completed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(tasksMarkComplete).toHaveBeenCalledWith('Alpha', false),
    )
  })

  // ---------- chunk 74: busy line, task age, weekly review ----------

  const SETTINGS = { caldavStatus: 'ok', timezone: 'America/New_York' }
  // 12:00–12:30 in New York.
  const BUSY = [
    { start: '2026-10-13T16:00:00.000Z', end: '2026-10-13T16:30:00.000Z' },
  ]

  function seedOneList(tasks: ReturnType<typeof mkTask>[]) {
    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue(tasks)
  }

  /** The Today header's title row: sun, "Today", the date, the busy line. */
  const todayTitleRow = () =>
    screen.getByRole('heading', { name: 'Today' }).parentElement!

  it('shows the reconnect banner and no busy text when the calendar auth failed (chunk 74)', async () => {
    sessionUser.value = { id: 'u1', email: 'a@b.c' }
    settingsGet.mockResolvedValue({ ...SETTINGS, caldavStatus: 'auth_failed' })
    seedOneList([mkTask('Open task', 'sw1', { createdAt: daysAgo(1) })])

    const { container } = renderDashboard()

    const banner = await screen.findByText('Apple Calendar disconnected')
    // First thing on the page.
    expect(container.firstElementChild!.firstElementChild).toContainElement(banner)
    expect(screen.queryByText(/busy/i, { ignore: '[role="alert"] *' })).toBeNull()
    expect(todayTitleRow().textContent).not.toMatch(/busy/i)
    expect(getBusyDay).not.toHaveBeenCalled()
  })

  it('shows the reconnect banner on the first-run screen too (chunk 74)', async () => {
    sessionUser.value = { id: 'u1', email: 'a@b.c' }
    settingsGet.mockResolvedValue({ ...SETTINGS, caldavStatus: 'auth_failed' })
    categoriesList.mockResolvedValue([mkCat('cat-work', 'Work')])
    subcategoriesList.mockResolvedValue([])
    tasksList.mockResolvedValue([])

    const { container } = renderDashboard()

    const banner = await screen.findByText('Apple Calendar disconnected')
    expect(container.firstElementChild!.firstElementChild).toContainElement(banner)
    expect(screen.getByText('Set up your first list')).toBeInTheDocument()
  })

  it('puts the busy times in the Today header, with no standalone strip (chunk 74)', async () => {
    sessionUser.value = { id: 'u1', email: 'a@b.c' }
    settingsGet.mockResolvedValue(SETTINGS)
    getBusyDay.mockResolvedValue(BUSY)
    seedOneList([mkTask('Open task', 'sw1', { createdAt: daysAgo(1) })])

    renderDashboard()

    const line = await screen.findByText('Busy 12–12:30')
    expect(todayTitleRow()).toContainElement(line)
    // The strip's own label and text are absent.
    expect(screen.queryByText('Busy')).toBeNull()
    expect(screen.queryByText('12–12:30')).toBeNull()
    expect(screen.queryByText('Apple Calendar disconnected')).toBeNull()
  })

  it('keeps the standalone busy strip when the Today list is off (chunk 74)', async () => {
    sessionUser.value = { id: 'u1', email: 'a@b.c' }
    settingsGet.mockResolvedValue(SETTINGS)
    getBusyDay.mockResolvedValue(BUSY)
    useTodayListStore.setState({ todayList: 'off' })
    seedOneList([mkTask('Open task', 'sw1', { createdAt: daysAgo(1) })])

    renderDashboard()

    const text = await screen.findByText('12–12:30')
    expect(text.previousElementSibling).toHaveTextContent(/^Busy$/)
    expect(screen.queryByText('Busy 12–12:30')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull()
  })

  it('keeps the standalone busy strip on the first-run screen (chunk 74)', async () => {
    sessionUser.value = { id: 'u1', email: 'a@b.c' }
    settingsGet.mockResolvedValue(SETTINGS)
    getBusyDay.mockResolvedValue(BUSY)
    categoriesList.mockResolvedValue([mkCat('cat-work', 'Work')])
    subcategoriesList.mockResolvedValue([])
    tasksList.mockResolvedValue([])

    renderDashboard()

    const text = await screen.findByText('12–12:30')
    expect(text.previousElementSibling).toHaveTextContent(/^Busy$/)
    expect(screen.getByText('Set up your first list')).toBeInTheDocument()
  })

  it('shows each old open row its age (chunk 74)', async () => {
    seedOneList([
      mkTask('Old task', 'sw1', { createdAt: daysAgo(120) }),
      mkTask('New task', 'sw1', { createdAt: daysAgo(3) }),
    ])

    renderWithToaster()
    await waitFor(() => expect(actionsFor('Old task')).toBeInTheDocument())

    expect(within(rowOf('Old task')).getByText('17w')).toBeInTheDocument()
    expect(within(rowOf('New task')).queryByText(/^\d+[wy]$/)).toBeNull()
  })

  const reviewPrompt = () =>
    screen.queryByRole('region', { name: 'Review old tasks' })

  it('offers the weekly review; Not now hides it and records the date (chunk 74)', async () => {
    seedOneList([
      mkTask('Old one', 'sw1', { createdAt: daysAgo(121) }),
      mkTask('Old two', 'sw1', { createdAt: daysAgo(120) }),
      // Not counted: too young, and done.
      mkTask('Young', 'sw1', { createdAt: daysAgo(89) }),
      mkTask('Old done', 'sw1', {
        createdAt: daysAgo(200),
        completedAt: daysAgo(1),
      }),
    ])

    renderDashboard()

    const text = await screen.findByText('2 tasks are older than 90 days.')
    expect(reviewPrompt()).toContainElement(text)
    expect(localStorage.getItem(REVIEW_KEY)).toBeNull()

    const before = Date.now()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    expect(reviewPrompt()).toBeNull()
    const stored = Date.parse(localStorage.getItem(REVIEW_KEY)!)
    expect(stored).toBeGreaterThanOrEqual(before)
    expect(stored).toBeLessThanOrEqual(Date.now())
    // Nothing was touched.
    expect(tasksBulkDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says "1 task is" for a single old task (chunk 74)', async () => {
    seedOneList([mkTask('Old one', 'sw1', { createdAt: daysAgo(121) })])
    renderDashboard()
    expect(
      await screen.findByText('1 task is older than 90 days.'),
    ).toBeInTheDocument()
  })

  it('does not offer the review within a week of the last one, and does after (chunk 74)', async () => {
    seedOneList([
      mkTask('Old one', 'sw1', { createdAt: daysAgo(121) }),
      mkTask('Old two', 'sw1', { createdAt: daysAgo(120) }),
    ])

    localStorage.setItem(REVIEW_KEY, daysAgo(3))
    const first = renderDashboard()
    await screen.findByRole('button', { name: 'Open Work' })
    expect(reviewPrompt()).toBeNull()
    expect(screen.queryByText(/older than 90 days/)).toBeNull()
    first.unmount()

    localStorage.setItem(REVIEW_KEY, daysAgo(8))
    renderDashboard()
    expect(
      await screen.findByText('2 tasks are older than 90 days.'),
    ).toBeInTheDocument()
  })

  it('Review → Delete → Escape deletes that task through Undo, and Undo brings it back (chunk 74)', async () => {
    seedOneList([
      mkTask('Old one', 'sw1', { createdAt: daysAgo(121) }),
      mkTask('Old two', 'sw1', { createdAt: daysAgo(120) }),
    ])

    renderWithToaster()
    await screen.findByText('2 tasks are older than 90 days.')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    // The sheet is lazy; the oldest task comes first.
    const dialog = await screen.findByRole('dialog', { name: 'Review' })
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument()
    expect(within(dialog).getByText('Old one')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument()
    // Nothing happens until the sheet closes (the modal hides the page from
    // the accessibility tree, hence `hidden`).
    expect(
      screen.getByRole('button', {
        name: 'Actions for "Old one"',
        hidden: true,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Task deleted')).toBeNull()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(actionsFor('Old one')).not.toBeInTheDocument())
    expect(actionsFor('Old two')).toBeInTheDocument()
    expect(await screen.findByText('Task deleted')).toBeInTheDocument()
    // Closing counts as reviewed.
    expect(reviewPrompt()).toBeNull()
    expect(localStorage.getItem(REVIEW_KEY)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(actionsFor('Old one')).toBeInTheDocument())
    expect(tasksBulkDelete).not.toHaveBeenCalled()
    expect(tasksDelete).not.toHaveBeenCalled()
  })
})

describe('Sort General chip (chunk 89)', () => {
  const proposal = (id: string) => ({
    id,
    taskId: `t-${id}`,
    title: `Task ${id}`,
    fromSubcategoryId: 'w-gen',
    toSubcategoryId: null,
    newListName: null,
    newListCategoryId: null,
    reason: 'why',
    createdAt: '2026-10-21T10:00:00Z',
  })

  beforeEach(() => {
    categoriesList.mockReset().mockResolvedValue([mkCat('c-work', 'Work')])
    subcategoriesList.mockReset().mockResolvedValue([mkSub('w-gen', 'c-work')])
    tasksList.mockReset().mockResolvedValue([mkTask('t-a', 'w-gen')])
    settingsGet.mockReset().mockResolvedValue(null)
    routineLogsList.mockReset().mockResolvedValue([])
    routineItemsList.mockReset().mockResolvedValue([])
    getBusyDay.mockReset().mockResolvedValue({ kind: 'unconfigured' })
    useUIStore.setState({ dashboardRefreshKey: 0 })
    sessionUser.value = { id: 'u1', email: 'a@b.c' }
    routingPending.mockReset()
  })
  afterEach(() => {
    sessionUser.value = null
  })

  it('is hidden with no pending proposals', async () => {
    routingPending.mockResolvedValue([])
    renderDashboard()
    await screen.findAllByText('t-a')
    await waitFor(() => expect(routingPending).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Sort General/ })).toBeNull()
  })

  it('shows the count and opens the sheet', async () => {
    routingPending.mockResolvedValue([proposal('a'), proposal('b')])
    renderDashboard()
    const chip = await screen.findByRole('button', { name: 'Sort General · 2' })
    fireEvent.click(chip)
    expect(await screen.findByRole('dialog', { name: 'Sort General' })).toBeInTheDocument()
  })

  it('re-reads the count on a dashboard refresh (realtime)', async () => {
    routingPending.mockResolvedValueOnce([proposal('a')]).mockResolvedValue([])
    renderDashboard()
    await screen.findByRole('button', { name: 'Sort General · 1' })
    act(() => useUIStore.getState().forceDashboardRefresh())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Sort General/ })).toBeNull(),
    )
  })
})

describe('Sort General button (chunk 90 D6)', () => {
  const GENERAL = { ...mkSub('w-gen', 'c-work'), name: 'General' }
  const proposal = (id: string) => ({
    id,
    taskId: 't-a',
    title: 'Task a',
    fromSubcategoryId: 'w-gen',
    toSubcategoryId: null,
    newListName: null,
    newListCategoryId: null,
    reason: 'why',
    createdAt: '2026-10-21T10:00:00Z',
  })
  const button = () => screen.findByRole('button', { name: /^(Sort General|Sorting…)$/ })
  function renderWithToaster() {
    return render(
      <MemoryRouter>
        <Toaster />
        <Dashboard />
      </MemoryRouter>,
    )
  }

  beforeEach(() => {
    categoriesList.mockReset().mockResolvedValue([mkCat('c-work', 'Work')])
    subcategoriesList.mockReset().mockResolvedValue([GENERAL])
    tasksList.mockReset().mockResolvedValue([mkTask('t-a', 'w-gen')])
    settingsGet
      .mockReset()
      .mockResolvedValue({ timezone: 'America/New_York', aiStatus: 'ok' })
    routineLogsList.mockReset().mockResolvedValue([])
    routineItemsList.mockReset().mockResolvedValue([])
    getBusyDay.mockReset().mockResolvedValue({ kind: 'unconfigured' })
    useUIStore.setState({ dashboardRefreshKey: 0 })
    sessionUser.value = { id: 'u1', email: 'a@b.c' }
    routingPending.mockReset().mockResolvedValue([])
    runSort.mockReset()
    useSyncStore.setState({ state: 'synced', lastSyncAt: null })
  })
  afterEach(() => {
    sessionUser.value = null
    vi.restoreAllMocks()
  })

  it('pending > 0 → the count chip, not the button', async () => {
    routingPending.mockResolvedValue([proposal('a')])
    renderDashboard()
    expect(await screen.findByRole('button', { name: 'Sort General · 1' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Sort General' })).toBeNull()
  })

  it('pending = 0 with an open General task and a saved key → Sort General', async () => {
    renderDashboard()
    expect(await button()).toBeEnabled()
    expect(screen.queryByText('Needs a connection')).toBeNull()
  })

  it('no open task in a General list → nothing', async () => {
    subcategoriesList.mockResolvedValue([{ ...GENERAL, name: 'Inbox' }])
    renderDashboard()
    await screen.findAllByText('t-a')
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Sort General/ })).toBeNull()
  })

  it('a completed General task does not count', async () => {
    tasksList.mockResolvedValue([
      mkTask('t-a', 'w-gen', { completedAt: '2026-10-20T10:00:00Z' }),
    ])
    renderDashboard()
    await waitFor(() => expect(tasksList).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Sort General/ })).toBeNull()
  })

  it.each(['unconfigured', 'auth_failed'])('ai_status %s → nothing, no error', async (aiStatus) => {
    settingsGet.mockResolvedValue({ timezone: 'America/New_York', aiStatus })
    renderDashboard()
    await screen.findAllByText('t-a')
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Sort General/ })).toBeNull()
    expect(screen.queryByText(/Settings/)).toBeNull()
  })

  it('offline → disabled, "Needs a connection"', async () => {
    // lib/network mirrors navigator.onLine into the sync store.
    useSyncStore.setState({ state: 'offline' })
    renderDashboard()
    expect(await button()).toBeDisabled()
    expect(screen.getByText('Needs a connection')).toBeInTheDocument()
    expect(runSort).not.toHaveBeenCalled()
  })

  it('tap → Sorting…, disabled → the sheet opens on success', async () => {
    let resolve!: (v: unknown) => void
    runSort.mockReturnValue(new Promise((r) => (resolve = r)))
    renderDashboard()
    fireEvent.click(await button())
    const busy = await screen.findByRole('button', { name: 'Sorting…' })
    expect(busy).toBeDisabled()
    fireEvent.click(busy)
    expect(runSort).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ rows: [proposal('a'), proposal('b')], done: vi.fn() }))
    expect(await screen.findByRole('dialog', { name: 'Sort General' })).toBeInTheDocument()
  })

  it('nothing proposed (runSort → null) → no sheet, the button is back', async () => {
    runSort.mockResolvedValue(null)
    renderDashboard()
    fireEvent.click(await button())
    await waitFor(() => expect(runSort).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Sort General' })).toBeEnabled()
    expect(screen.queryByRole('dialog', { name: 'Sort General' })).toBeNull()
  })

  it('remaining → the press done() runs once, when the sheet closes (Not now)', async () => {
    const done = vi.fn()
    runSort.mockResolvedValue({ rows: [proposal('a')], done })
    renderWithToaster()
    fireEvent.click(await button())
    const dialog = await screen.findByRole('dialog', { name: 'Sort General' })
    expect(done).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sort General' })).toBeNull(),
    )
    expect(done).toHaveBeenCalledTimes(1)
  })


})
