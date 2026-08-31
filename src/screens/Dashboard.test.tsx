import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  categoriesList,
  subcategoriesList,
  tasksList,
  tasksUpdate,
  routineLogsList,
  routineItemsList,
  settingsGet,
} = vi.hoisted(() => ({
  categoriesList: vi.fn(),
  subcategoriesList: vi.fn(),
  tasksList: vi.fn(),
  tasksUpdate: vi.fn(),
  routineLogsList: vi.fn(),
  routineItemsList: vi.fn(),
  settingsGet: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    categories: { list: categoriesList },
    subcategories: { list: subcategoriesList },
    tasks: { list: tasksList, update: tasksUpdate },
    // The hero's streak is the canonical routines streak — it loads routine
    // items + logs + settings (timezone), mirroring Routines.tsx's sourcing.
    routineLogs: { listByRange: routineLogsList },
    routineItems: { list: routineItemsList },
    settings: { get: settingsGet },
  },
}))

import Dashboard from './Dashboard'
import { useSyncStore } from '@/db/syncStore'
import { dateKeyDaysAgo, today as clockToday } from '@/lib/clock'
import { useUIStore } from '@/state/uiStore'

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
  opts: { completedAt?: string | null; priority?: 1 | 2 | 3 | null } = {},
) {
  return {
    id,
    userId: 'u1',
    subcategoryId,
    title: id,
    notes: null,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: opts.priority ?? null,
    completedAt: opts.completedAt ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function mkItem(
  id: string,
  routine: 'morning' | 'night',
  opts: { createdAt?: string; archivedAt?: string | null } = {},
) {
  return {
    id,
    userId: 'u1',
    routine,
    label: id,
    sortOrder: 0,
    archivedAt: opts.archivedAt ?? null,
    // Created well before any test date so the item is "required" every day.
    createdAt: opts.createdAt ?? '2020-01-01T00:00:00.000Z',
  }
}

function mkLog(
  id: string,
  routineItemId: string,
  dateKey: string,
  completed = true,
) {
  return { id, userId: 'u1', routineItemId, dateKey, completed }
}

describe('Dashboard', () => {
  beforeEach(() => {
    categoriesList.mockReset()
    subcategoriesList.mockReset()
    tasksList.mockReset()
    tasksUpdate.mockReset()
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
      expect(routineLogsList).toHaveBeenCalledTimes(1)
      expect(routineItemsList).toHaveBeenCalledTimes(1)
    })

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
    expect(routineLogsList).toHaveBeenCalledTimes(1)
    expect(routineItemsList).toHaveBeenCalledTimes(1)
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
        notes: null,
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
        notes: null,
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

    // Archived subcategory must not appear anywhere in the rendered tree.
    expect(container.textContent).not.toContain('Old project')
    // And its task must not be visible either.
    expect(container.textContent).not.toContain('Hidden task')
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

    const { findByText, queryByText } = renderDashboard()

    expect(await findByText('Open task')).toBeTruthy()
    expect(queryByText(/All clear/i)).toBeNull()
    expect(queryByText('Set up your first list')).toBeNull()
  })

  it('renders the hero ring %, done readout and spark pill from real data', async () => {
    // 1 of 4 tasks complete → ring 25%, "1/4 done", Work bar 1/4. This is the
    // hero equivalent of the retired TodayStrip's open-count summary.
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

    await waitFor(() => {
      expect(container.textContent).toContain('25%')
    })
    expect(container.textContent).toContain('1/4 done')
    // The fused spark pill opens the existing "What's next?" sheet.
    expect(await findByRole('button', { name: /what.s next/i })).toBeTruthy()
  })

  it('shows the canonical routines streak (max of morning and night) in the hero chip', async () => {
    // No session user in tests → the loader falls back to the default tz, so
    // build the log dateKeys against that same tz for a deterministic streak.
    const tz = 'America/New_York'
    const tk = clockToday(tz)

    categoriesList.mockResolvedValue([
      mkCat('cat-work', 'Work'),
      mkCat('cat-personal', 'Personal'),
    ])
    subcategoriesList.mockResolvedValue([mkSub('sw1', 'cat-work')])
    tasksList.mockResolvedValue([mkTask('Open task', 'sw1')])
    routineItemsList.mockResolvedValue([
      mkItem('m', 'morning'),
      mkItem('n', 'night'),
    ])
    // Morning done today only (morning streak 1); night done yesterday only
    // (night streak 1) → max = 1. The retired loose "≥1 completed log/day"
    // calc would have counted both days as 2 — so asserting 1 pins the strict
    // routines source, not the old loose one.
    routineLogsList.mockResolvedValue([
      mkLog('l1', 'm', tk),
      mkLog('l2', 'n', dateKeyDaysAgo(tk, 1)),
    ])

    const { findByTitle } = renderDashboard()

    const chip = await findByTitle('Check-in streak')
    expect(chip).toHaveTextContent('1')
    expect(chip).not.toHaveTextContent('2')
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
    await screen.findByText('t-p2')

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
    await screen.findByText('t-both')

    expect(
      screen.getByRole('button', { name: 'Priority 2 — change priority' }),
    ).toBeInTheDocument()
    // Membership label flips Add/Remove; either proves the sun slot rendered.
    expect(
      screen.getByRole('button', { name: /"t-both" (to|from) Today/ }),
    ).toBeInTheDocument()
  })
})
