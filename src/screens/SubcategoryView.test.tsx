import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
vi.mock('@/state/uiStore', () => ({
  useUIStore: (selector: (s: { dashboardRefreshKey: number }) => unknown) =>
    selector({ dashboardRefreshKey: 0 }),
}))

import SubcategoryView from './SubcategoryView'

function mkTask(id: string, opts: { priority?: number | null } = {}) {
  return {
    id,
    userId: 'u1',
    subcategoryId: 'sub-1',
    title: id,
    notes: null,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: opts.priority ?? null,
    completedAt: null,
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
})
