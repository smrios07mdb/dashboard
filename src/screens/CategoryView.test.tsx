import { fireEvent, render, screen } from '@testing-library/react'
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

// Chunk 63: record what each DndContext is given, render the real one.
const { dndCollisionProps } = vi.hoisted(() => ({
  dndCollisionProps: [] as unknown[],
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dndCollisionProps.push(props.collisionDetection)
      return createElement(actual.DndContext, props)
    },
  }
})

import CategoryView from './CategoryView'
import { taskDragCollision } from '@/lib/taskDragCollision'

function mkTask(id: string, subcategoryId: string) {
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

  it('gives the screen DndContext the pointer-based task collision (chunk 63)', async () => {
    dndCollisionProps.length = 0
    renderCategory()
    await screen.findByRole('heading', { name: /^work$/i })
    await screen.findByText('Inbox')

    expect(dndCollisionProps.length).toBeGreaterThanOrEqual(1)
    for (const recorded of dndCollisionProps) {
      expect(recorded).toBe(taskDragCollision)
    }
  })

  it('mounts the horizon control and Near writes hupo.taskHorizon (chunk 76)', async () => {
    localStorage.removeItem('hupo.taskHorizon')
    renderCategory()
    await screen.findByRole('heading', { name: /^work$/i })
    expect(
      screen.getByRole('radiogroup', { name: 'Horizon' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Near' }))
    expect(localStorage.getItem('hupo.taskHorizon')).toBe('near')
    // t1 has no priority and no dates: long term, so the header drops to 0.
    expect(screen.getByText(/^0 open/)).toBeInTheDocument()
    localStorage.removeItem('hupo.taskHorizon')
  })

  it('the header reads "N open" with no time total (chunk 86, D3)', async () => {
    localStorage.removeItem('hupo.taskHorizon')
    renderCategory()
    await screen.findByRole('heading', { name: /^work$/i })
    const label = screen.getByText(/^\d+ open/)
    expect(label.textContent).toBe('1 open')
    expect(label.textContent).not.toContain('·')
  })
})
