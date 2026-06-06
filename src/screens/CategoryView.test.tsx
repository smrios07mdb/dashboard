import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Focused behavioral guards for the CategoryView drill-down (chunk 31).
 *
 * Chunk 31 is a Daylight re-skin of screen chrome only — the body is the
 * shared, already-Daylight SubcategorySection (Decision A). These tests pin
 * the behavior the re-skin must preserve: the serif category title renders as
 * a heading, the breadcrumb's "All" link renders, and the SubcategorySection
 * body mounts (a subcategory name shows). Visual fidelity (the colored bar,
 * 44px serif, surface card) is the on-device pass, not a unit assertion.
 */

const { categoriesList, subcategoriesList, tasksList } = vi.hoisted(() => ({
  categoriesList: vi.fn(),
  subcategoriesList: vi.fn(),
  tasksList: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    categories: { list: categoriesList },
    subcategories: {
      list: subcategoriesList,
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      reorder: vi.fn(),
    },
    tasks: {
      list: tasksList,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      markComplete: vi.fn(),
      bulkUpdate: vi.fn(),
      bulkDelete: vi.fn(),
    },
  },
}))

// Stable session + a desktop (non-touch) grid keep the render deterministic.
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

import CategoryView from './CategoryView'

function mkTask(id: string, subcategoryId: string) {
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
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function renderCategory(categoryId = 'cat-work') {
  return render(
    <MemoryRouter initialEntries={[`/category/${categoryId}`]}>
      <Routes>
        <Route path="category/:categoryId" element={<CategoryView />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CategoryView (chunk 31 re-skin)', () => {
  beforeEach(() => {
    categoriesList.mockReset()
    subcategoriesList.mockReset()
    tasksList.mockReset()
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
    tasksList.mockResolvedValue([mkTask('t1', 'sub-1')])
  })

  it('renders the category name as a heading once data loads', async () => {
    renderCategory()
    expect(
      await screen.findByRole('heading', { name: /^work$/i }),
    ).toBeInTheDocument()
  })

  it('renders the breadcrumb "All" link', async () => {
    renderCategory()
    await screen.findByRole('heading', { name: /^work$/i })
    expect(screen.getByRole('link', { name: /^all$/i })).toBeInTheDocument()
  })

  it('mounts the SubcategorySection body (subcategory name renders)', async () => {
    renderCategory()
    await screen.findByRole('heading', { name: /^work$/i })
    expect(screen.getByText('Inbox')).toBeInTheDocument()
  })
})
