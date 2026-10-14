import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Focused behavioral guards for the SubcategoryView drill-down (chunk 31).
 *
 * Two jobs:
 *   1. Pin the chrome the Daylight re-skin must preserve — the serif sub title
 *      heading, the 3-level breadcrumb links, and the existing bulk-select →
 *      toolbar flow (Move / Delete).
 *   2. Cover the three prototype-only controls recreated this chunk (Decision
 *      D): D1 select-all (master checkbox selects every visible row), D2 sort
 *      trigger renders, D3 bulk "Mark complete" routes through tasks.bulkUpdate
 *      with a completedAt patch (mirroring the existing bulk-move path, since
 *      markComplete is itself just update({ completedAt })).
 */

const { categoriesList, subcategoriesList, tasksList, bulkUpdate, bulkDelete } =
  vi.hoisted(() => ({
    categoriesList: vi.fn(),
    subcategoriesList: vi.fn(),
    tasksList: vi.fn(),
    bulkUpdate: vi.fn(),
    bulkDelete: vi.fn(),
  }))

vi.mock('@/db/repo', () => ({
  repo: {
    categories: { list: categoriesList },
    subcategories: { list: subcategoriesList },
    tasks: {
      list: tasksList,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      markComplete: vi.fn(),
      bulkUpdate,
      bulkDelete,
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  useSession: () => ({
    user: { id: 'u1', email: 'a@b.c' },
    session: {},
    loading: false,
  }),
}))
vi.mock('@/lib/useIsTouchDevice', () => ({
  useIsTouchDevice: () => false,
}))
// Chunk 72: lib/taskUndo reads the store imperatively (`getState`) on Undo.
vi.mock('@/state/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (s: { dashboardRefreshKey: number }) => unknown) =>
      selector({ dashboardRefreshKey: 0 }),
    { getState: () => ({ forceDashboardRefresh: () => undefined }) },
  ),
}))

import SubcategoryView from './SubcategoryView'

// Chunk 86 (D2): only completions from the last 30 days are listed.
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

function mkTask(
  id: string,
  opts: { priority?: number | null; completedAt?: string | null } = {},
) {
  return {
    id,
    userId: 'u1',
    subcategoryId: 'sub-1',
    title: id,
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

function renderSub(subcategoryId = 'sub-1') {
  return render(
    <MemoryRouter initialEntries={[`/subcategory/${subcategoryId}`]}>
      <Routes>
        <Route
          path="subcategory/:subcategoryId"
          element={<SubcategoryView />}
        />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  )
}

describe('SubcategoryView (chunk 31 re-skin)', () => {
  beforeEach(() => {
    categoriesList.mockReset()
    subcategoriesList.mockReset()
    tasksList.mockReset()
    bulkUpdate.mockReset()
    bulkDelete.mockReset()
    categoriesList.mockResolvedValue([
      { id: 'cat-work', name: 'Work', userId: 'u1' },
    ])
    subcategoriesList.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Inbox',
        categoryId: 'cat-work',
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
    ])
    tasksList.mockResolvedValue([mkTask('Alpha'), mkTask('Bravo')])
    bulkUpdate.mockResolvedValue([])
  })

  it('renders the sub-name heading and the All / category breadcrumb links', async () => {
    renderSub()
    expect(
      await screen.findByRole('heading', { name: /^inbox$/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^all$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^work$/i })).toBeInTheDocument()
  })

  it('reveals the bulk toolbar with Move / Delete when a task is selected', async () => {
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    const selects = screen.getAllByLabelText('Select task')
    fireEvent.click(selects[0])

    expect(await screen.findByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /move to/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /delete 1/i }),
    ).toBeInTheDocument()
  })

  // D1 — select-all master checkbox selects every visible row.
  it('selects all visible tasks via the select-all checkbox', async () => {
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })

    fireEvent.click(screen.getByLabelText(/select all tasks/i))

    // Two visible tasks → toolbar count equals the visible task count.
    expect(await screen.findByText(/2 selected/i)).toBeInTheDocument()
  })

  // D2 — sort trigger renders (light assertion; ordering is the device pass).
  it('renders the sort control', async () => {
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })
    expect(screen.getByRole('button', { name: /sort/i })).toBeInTheDocument()
  })

  // D3 — bulk "Mark complete" routes through bulkUpdate with a completedAt patch.
  it('marks the selected tasks complete via bulkUpdate', async () => {
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })

    fireEvent.click(screen.getByLabelText(/select all tasks/i))
    await screen.findByText(/2 selected/i)

    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }))

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1))
    const updates = bulkUpdate.mock.calls[0][0] as Array<{
      id: string
      patch: { completedAt: string | null }
    }>
    expect(updates).toHaveLength(2)
    for (const u of updates) {
      expect(typeof u.patch.completedAt).toBe('string')
    }

    // Selection clears after the bulk action → the toolbar disappears.
    await waitFor(() =>
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument(),
    )
  })

  // ---------- chunk 72: undo for bulk delete and bulk complete ----------

  it('Delete 2 removes both with no confirm; Undo restores both and nothing is deleted (chunk 72)', async () => {
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })

    fireEvent.click(screen.getByLabelText(/select all tasks/i))
    fireEvent.click(await screen.findByRole('button', { name: /delete 2/i }))

    await waitFor(() =>
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('Bravo')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(await screen.findByText('2 tasks deleted')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(bulkDelete).not.toHaveBeenCalled()
  })

  it('bulk complete offers Undo, which restores each prior completedAt (chunk 72)', async () => {
    const X = daysAgo(2)
    tasksList.mockResolvedValue([
      mkTask('Alpha'),
      mkTask('Bravo', { completedAt: X }),
    ])
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })

    // Show the done row so select-all picks up both.
    fireEvent.click(screen.getByRole('button', { name: /show 1 done/i }))
    fireEvent.click(screen.getByLabelText(/select all tasks/i))
    await screen.findByText(/2 selected/i)
    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }))

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('2 tasks completed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(2))
    expect(bulkUpdate.mock.calls[1][0]).toEqual([
      { id: 'Alpha', patch: { completedAt: null } },
      { id: 'Bravo', patch: { completedAt: X } },
    ])
  })
})

describe('SubcategoryView horizon (chunk 76)', () => {
  beforeEach(() => {
    localStorage.removeItem('hupo.taskHorizon')
    categoriesList.mockResolvedValue([
      { id: 'cat-work', name: 'Work', userId: 'u1' },
    ])
    subcategoriesList.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Inbox',
        categoryId: 'cat-work',
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
    ])
    tasksList.mockResolvedValue([
      mkTask('Urgent', { priority: 1 }),
      mkTask('Someday', { priority: 3 }),
      mkTask('Finished', { completedAt: daysAgo(2) }),
    ])
  })

  it('Long hides a P1 row, keeps an undated P3 row, and the header follows; Show done still works', async () => {
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })
    expect(screen.getByText(/^2 open/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Long' }))

    expect(screen.queryByText('Urgent')).not.toBeInTheDocument()
    expect(screen.getByText('Someday')).toBeInTheDocument()
    expect(screen.getByText(/^1 open/)).toBeInTheDocument()
    expect(localStorage.getItem('hupo.taskHorizon')).toBe('long')

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 done' }))
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(screen.queryByText('Urgent')).not.toBeInTheDocument()
    localStorage.removeItem('hupo.taskHorizon')
  })
})

describe('SubcategoryView — 30-day completions and header (chunk 86)', () => {
  beforeEach(() => {
    localStorage.removeItem('hupo.taskHorizon')
    categoriesList.mockResolvedValue([
      { id: 'cat-work', name: 'Work', userId: 'u1' },
    ])
    subcategoriesList.mockResolvedValue([
      {
        id: 'sub-1',
        name: 'Inbox',
        categoryId: 'cat-work',
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
    ])
  })

  it('Show N done counts recent completions only', async () => {
    tasksList.mockResolvedValue([
      mkTask('Open'),
      mkTask('Recent', { completedAt: daysAgo(3) }),
      mkTask('Old', { completedAt: daysAgo(45) }),
    ])
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 done' }))
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.queryByText('Old')).not.toBeInTheDocument()
  })

  it('only old completions → "All done." and no Show done', async () => {
    tasksList.mockResolvedValue([
      mkTask('Old', { completedAt: daysAgo(45) }),
    ])
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })
    expect(await screen.findByText('All done.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /done$/i })).toBeNull()
  })

  it('the header reads "N open" with no time total (D3)', async () => {
    tasksList.mockResolvedValue([mkTask('A'), mkTask('B'), mkTask('C')])
    renderSub()
    await screen.findByRole('heading', { name: /^inbox$/i })
    const label = screen.getByText(/^\d+ open/)
    expect(label.textContent).toBe('3 open')
    expect(label.textContent).not.toContain('·')
  })
})
