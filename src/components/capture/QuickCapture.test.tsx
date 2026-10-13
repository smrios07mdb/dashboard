import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 73 (UX audit #7): the capture dialog end to end — parse, destination,
 * create, remember. `repo`, the settings zone (America/New_York), the session
 * and sonner are mocked and the clock is pinned to Tue 2026-10-13 12:00 in
 * New York, so nothing depends on the machine running the suite.
 */

const { repo, loadUserTimezone, toast } = vi.hoisted(() => ({
  repo: {
    categories: { list: vi.fn() },
    subcategories: { list: vi.fn() },
    tasks: { create: vi.fn() },
  },
  loadUserTimezone: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('@/db/repo', () => ({ repo }))
vi.mock('@/lib/userTimezone', () => ({
  browserTimezone: () => 'America/New_York',
  loadUserTimezone,
}))
vi.mock('@/lib/auth', () => ({
  useSession: () => ({ session: {}, user: { id: 'user-1' }, loading: false }),
}))
vi.mock('sonner', () => ({ toast }))

import type { Category, Subcategory } from '@/db/types'
import { useUIStore } from '@/state/uiStore'

import QuickCapture from './QuickCapture'

// Radix Dialog needs these jsdom shims.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

const DEST_KEY = 'hup:captureDest'

const categories: Category[] = [
  { id: 'cat-p', userId: 'user-1', name: 'Personal' },
  { id: 'cat-w', userId: 'user-1', name: 'Work' },
]
const sub = (
  id: string,
  categoryId: string,
  name: string,
  sortOrder: number,
  archivedAt: string | null = null,
): Subcategory => ({ id, userId: 'user-1', categoryId, name, sortOrder, archivedAt })
const subcategories: Subcategory[] = [
  sub('p-general', 'cat-p', 'General', 0),
  sub('p-errands', 'cat-p', 'Errands', 1),
  sub('p-archived', 'cat-p', 'Shelved', 2, '2026-01-01T00:00:00.000Z'),
  sub('w-general', 'cat-w', 'General', 0),
  sub('w-deals', 'cat-w', 'Deals', 1),
]

const input = () => screen.getByLabelText('Task') as HTMLInputElement
const addButton = () => screen.getByRole('button', { name: 'Add' })
const destChip = (label: string) => screen.findByRole('button', { name: label })
const created = () => repo.tasks.create.mock.calls[0][0]

/** Open the dialog and wait until its lists have loaded. */
async function openCapture(text = '') {
  useUIStore.setState({ capture: { mode: 'add', text } })
  render(<QuickCapture />)
  await waitFor(() => expect(repo.subcategories.list).toHaveBeenCalled())
}

async function typeAndEnter(text: string) {
  const user = userEvent.setup()
  await user.type(input(), `${text}{Enter}`)
}

describe('QuickCapture (chunk 73)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T16:00:00Z'))
    vi.clearAllMocks()
    localStorage.clear()
    useUIStore.setState({ capture: null, dashboardRefreshKey: 0 })
    repo.categories.list.mockResolvedValue(categories)
    repo.subcategories.list.mockResolvedValue(subcategories)
    repo.tasks.create.mockImplementation(async (t) => ({ id: 'new', ...t }))
    loadUserTimezone.mockResolvedValue('America/New_York')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens with focus in the Task input', async () => {
    await openCapture()
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument()
    await waitFor(() => expect(input()).toHaveFocus())
  })

  it('(1) Enter creates the parsed task, toasts, refreshes, and clears for the next one', async () => {
    await openCapture()
    await destChip('Personal › General')
    await typeAndEnter('Call Bob tomorrow p1 15m #work')

    await waitFor(() => expect(repo.tasks.create).toHaveBeenCalledTimes(1))
    expect(created()).toEqual({
      userId: 'user-1',
      subcategoryId: 'w-general',
      title: 'Call Bob',
      estimateMinutes: 15,
      // 00:00 on 2026-10-14 in New York (EDT, UTC-4).
      dueAt: '2026-10-14T04:00:00.000Z',
      remindAt: null,
      priority: 1,
      completedAt: null,
    })
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Task added — Work › General'),
    )
    expect(useUIStore.getState().dashboardRefreshKey).toBe(1)
    await waitFor(() => expect(input()).toHaveValue(''))
    await waitFor(() => expect(input()).toHaveFocus())
    // Still open, for the next task.
    expect(useUIStore.getState().capture).toEqual({ mode: 'add', text: '' })
  })

  it('(2) chips show what was read; × hands the word back to the title', async () => {
    await openCapture()
    await destChip('Personal › General')
    fireEvent.change(input(), { target: { value: 'Call Bob tomorrow p1 15m' } })

    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('15m')).toBeInTheDocument()
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Keep “tomorrow” in the title' }),
    )
    expect(screen.queryByText('Tomorrow')).not.toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()

    fireEvent.click(addButton())
    await waitFor(() => expect(repo.tasks.create).toHaveBeenCalledTimes(1))
    expect(created()).toMatchObject({
      title: 'Call Bob tomorrow',
      dueAt: null,
      priority: 1,
      estimateMinutes: 15,
    })
  })

  it('with nothing typed for them: no priority, no due date, 30 minutes', async () => {
    await openCapture()
    await destChip('Personal › General')
    await typeAndEnter('Water the plants')
    await waitFor(() => expect(repo.tasks.create).toHaveBeenCalledTimes(1))
    expect(created()).toMatchObject({
      title: 'Water the plants',
      estimateMinutes: 30,
      dueAt: null,
      priority: null,
    })
  })

  describe('(3) destination', () => {
    it('no tag, nothing stored → Personal › General', async () => {
      await openCapture()
      expect(await destChip('Personal › General')).toBeInTheDocument()
    })

    it('a stored live list → that list', async () => {
      localStorage.setItem(DEST_KEY, 'w-deals')
      await openCapture()
      expect(await destChip('Work › Deals')).toBeInTheDocument()
    })

    it('a stored archived list → falls back', async () => {
      localStorage.setItem(DEST_KEY, 'p-archived')
      await openCapture()
      expect(await destChip('Personal › General')).toBeInTheDocument()
    })

    it('a category tag narrows the stored list to that category', async () => {
      localStorage.setItem(DEST_KEY, 'w-deals')
      await openCapture()
      await destChip('Work › Deals')
      fireEvent.change(input(), { target: { value: 'Gym #personal' } })
      expect(await destChip('Personal › General')).toBeInTheDocument()
      fireEvent.change(input(), { target: { value: 'Gym #work' } })
      expect(await destChip('Work › Deals')).toBeInTheDocument()
    })
  })

  describe('(4) the remembered destination', () => {
    it('is written after a successful create, to the list the task went into', async () => {
      await openCapture()
      await destChip('Personal › General')
      await typeAndEnter('Term sheet #deals')
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Task added — Work › Deals'),
      )
      expect(created().subcategoryId).toBe('w-deals')
      expect(localStorage.getItem(DEST_KEY)).toBe('w-deals')
      // …and it is the default for the next capture in the same open.
      expect(await destChip('Work › Deals')).toBeInTheDocument()
    })

    it('is left alone by a failed create, which keeps the input', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      localStorage.setItem(DEST_KEY, 'p-errands')
      repo.tasks.create.mockRejectedValue(new Error('offline'))
      await openCapture()
      await destChip('Personal › Errands')
      await typeAndEnter('Term sheet #deals')

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Could not save — retry'),
      )
      expect(toast).not.toHaveBeenCalled()
      expect(localStorage.getItem(DEST_KEY)).toBe('p-errands')
      expect(input()).toHaveValue('Term sheet #deals')
      expect(useUIStore.getState().dashboardRefreshKey).toBe(0)
    })
  })

  it('(5) Add is disabled without a title', async () => {
    await openCapture()
    await destChip('Personal › General')
    expect(addButton()).toBeDisabled()

    fireEvent.change(input(), { target: { value: '#work 15m' } })
    expect(await destChip('Work › General')).toBeInTheDocument()
    expect(addButton()).toBeDisabled()
    fireEvent.submit(input().closest('form')!)
    expect(repo.tasks.create).not.toHaveBeenCalled()

    fireEvent.change(input(), { target: { value: '#work 15m Standup' } })
    expect(addButton()).toBeEnabled()
  })

  it('(6) an unknown tag is called out and kept in the title', async () => {
    await openCapture()
    await destChip('Personal › General')
    fireEvent.change(input(), { target: { value: 'Buy milk #foo' } })
    expect(
      screen.getByText('No list “#foo” — kept in the title.'),
    ).toBeInTheDocument()

    fireEvent.click(addButton())
    await waitFor(() => expect(repo.tasks.create).toHaveBeenCalledTimes(1))
    expect(created()).toMatchObject({
      title: 'Buy milk #foo',
      subcategoryId: 'p-general',
    })
  })

  it('(7) choosing a list in the List select overrides a #list token', async () => {
    await openCapture()
    await destChip('Personal › General')
    fireEvent.change(input(), { target: { value: 'Call Bob #errands' } })
    fireEvent.click(await destChip('Personal › Errands'))

    const select = screen.getByLabelText('List') as HTMLSelectElement
    // Live lists only, grouped by category.
    expect(
      Array.from(select.querySelectorAll('optgroup')).map((g) => g.label),
    ).toEqual(['Personal', 'Work'])
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'p-general',
      'p-errands',
      'w-general',
      'w-deals',
    ])
    fireEvent.change(select, { target: { value: 'w-deals' } })
    expect(await destChip('Work › Deals')).toBeInTheDocument()

    fireEvent.click(addButton())
    await waitFor(() => expect(repo.tasks.create).toHaveBeenCalledTimes(1))
    expect(created()).toMatchObject({
      subcategoryId: 'w-deals',
      title: 'Call Bob #errands',
    })
    expect(localStorage.getItem(DEST_KEY)).toBe('w-deals')
  })

  it('(8) no live list → "Add a list first", Add disabled', async () => {
    repo.subcategories.list.mockResolvedValue([
      sub('p-archived', 'cat-p', 'Shelved', 0, '2026-01-01T00:00:00.000Z'),
    ])
    await openCapture()
    expect(await screen.findByText('Add a list first')).toBeInTheDocument()
    fireEvent.change(input(), { target: { value: 'Something' } })
    expect(addButton()).toBeDisabled()
  })

  it('Add is disabled until the lists load; a load failure offers Retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.subcategories.list.mockRejectedValueOnce(new Error('down'))
    await openCapture('Something')
    expect(addButton()).toBeDisabled()
    expect(
      await screen.findByText('Could not load your lists — retry.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await destChip('Personal › General')).toBeInTheDocument()
    expect(addButton()).toBeEnabled()
  })

  it('Search tasks hands the text to the search dialog', async () => {
    await openCapture()
    await destChip('Personal › General')
    fireEvent.change(input(), { target: { value: 'bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search tasks' }))
    expect(useUIStore.getState().capture).toEqual({ mode: 'search', text: 'bob' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('Escape closes and the next open starts empty', async () => {
    await openCapture()
    await destChip('Personal › General')
    fireEvent.change(input(), { target: { value: 'Half a thought' } })
    fireEvent.keyDown(input(), { key: 'Escape' })
    await waitFor(() => expect(useUIStore.getState().capture).toBeNull())

    useUIStore.getState().openCapture('add')
    await waitFor(() => expect(input()).toHaveValue(''))
  })
})
