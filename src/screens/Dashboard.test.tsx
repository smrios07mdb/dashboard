import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { categoriesList, subcategoriesList, tasksList } = vi.hoisted(() => ({
  categoriesList: vi.fn(),
  subcategoriesList: vi.fn(),
  tasksList: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    categories: { list: categoriesList },
    subcategories: { list: subcategoriesList },
    tasks: { list: tasksList },
  },
}))

import Dashboard from './Dashboard'
import { useSyncStore } from '@/db/syncStore'
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
  opts: { completedAt?: string | null } = {},
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
    priority: null,
    completedAt: opts.completedAt ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('Dashboard', () => {
  beforeEach(() => {
    categoriesList.mockReset()
    subcategoriesList.mockReset()
    tasksList.mockReset()
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
})
