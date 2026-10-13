import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/* Chunk 73 (UX audit #7): the search dialog — results, keyboard, hand-off. */

const { repo } = vi.hoisted(() => ({
  repo: {
    categories: { list: vi.fn() },
    subcategories: { list: vi.fn() },
    tasks: { listIncomplete: vi.fn() },
  },
}))

vi.mock('@/db/repo', () => ({ repo }))

import type { Category, Subcategory, Task } from '@/db/types'
import { useUIStore } from '@/state/uiStore'

import TaskSearch from './TaskSearch'

// Radix Dialog needs these jsdom shims.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

const categories: Category[] = [
  { id: 'cat-p', userId: 'u', name: 'Personal' },
  { id: 'cat-w', userId: 'u', name: 'Work' },
]
const subcategories: Subcategory[] = [
  { id: 'p-errands', userId: 'u', categoryId: 'cat-p', name: 'Errands', sortOrder: 0, archivedAt: null },
  { id: 'w-deals', userId: 'u', categoryId: 'cat-w', name: 'Deals', sortOrder: 0, archivedAt: null },
]
const task = (id: string, title: string, subcategoryId: string, day: number): Task => ({
  id,
  userId: 'u',
  subcategoryId,
  title,
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: `2026-10-0${day}T00:00:00.000Z`,
  updatedAt: `2026-10-0${day}T00:00:00.000Z`,
})
const tasks: Task[] = [
  task('t1', 'Call Bob', 'w-deals', 1),
  task('t2', 'Call the plumber', 'p-errands', 2),
  task('t3', 'Send term sheet', 'w-deals', 3),
]

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

const input = () => screen.getByLabelText('Search tasks') as HTMLInputElement
const options = () => screen.getAllByRole('option')

/** Open the dialog and wait until its rows have loaded. */
async function openSearch(text = '') {
  useUIStore.setState({ capture: { mode: 'search', text } })
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <TaskSearch />
      <LocationProbe />
    </MemoryRouter>,
  )
  await waitFor(() => expect(repo.tasks.listIncomplete).toHaveBeenCalled())
  await waitFor(() => expect(input()).toHaveFocus())
}

describe('TaskSearch (chunk 73)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ capture: null })
    repo.categories.list.mockResolvedValue(categories)
    repo.subcategories.list.mockResolvedValue(subcategories)
    repo.tasks.listIncomplete.mockResolvedValue(tasks)
  })

  it('prompts for a query, then lists matching open tasks with their list', async () => {
    await openSearch()
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByText('Type to search open tasks.')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    fireEvent.change(input(), { target: { value: 'call' } })
    await waitFor(() => expect(options()).toHaveLength(2))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(within(options()[0]).getByText('Call Bob')).toBeInTheDocument()
    expect(within(options()[0]).getByText('Work › Deals')).toBeInTheDocument()
    expect(within(options()[1]).getByText('Call the plumber')).toBeInTheDocument()
    expect(within(options()[1]).getByText('Personal › Errands')).toBeInTheDocument()
    expect(screen.queryByText('Type to search open tasks.')).not.toBeInTheDocument()
  })

  it('the first hit is active; ↓ / ↑ move it and the input tracks it', async () => {
    await openSearch('call')
    await waitFor(() => expect(options()).toHaveLength(2))
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    expect(input()).toHaveAttribute('aria-activedescendant', options()[0].id)

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(input()).toHaveAttribute('aria-activedescendant', options()[1].id)

    // Clamped at both ends.
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('↓ + Enter opens the active hit’s list and closes', async () => {
    await openSearch('call')
    await waitFor(() => expect(options()).toHaveLength(2))
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(screen.getByTestId('pathname')).toHaveTextContent('/subcategory/p-errands')
    expect(useUIStore.getState().capture).toBeNull()
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('Enter alone opens the first hit; a click opens the clicked one', async () => {
    await openSearch('sheet')
    await waitFor(() => expect(options()).toHaveLength(1))
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('pathname')).toHaveTextContent('/subcategory/w-deals')

    useUIStore.getState().openCapture('search', 'call')
    await waitFor(() => expect(options()).toHaveLength(2))
    fireEvent.click(options()[1])
    expect(screen.getByTestId('pathname')).toHaveTextContent('/subcategory/p-errands')
    expect(useUIStore.getState().capture).toBeNull()
  })

  it('no match offers to add the query as a task', async () => {
    await openSearch()
    fireEvent.change(input(), { target: { value: 'renew passport' } })
    expect(
      await screen.findByText('No open task matches “renew passport”.'),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Add “renew passport” as a task' }),
    )
    expect(useUIStore.getState().capture).toEqual({
      mode: 'add',
      text: 'renew passport',
    })
  })

  it('Enter with no hit does nothing', async () => {
    await openSearch('zzz')
    await screen.findByText('No open task matches “zzz”.')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('pathname')).toHaveTextContent('/settings')
    expect(useUIStore.getState().capture).toEqual({ mode: 'search', text: 'zzz' })
  })
})
