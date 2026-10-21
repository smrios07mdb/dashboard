import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 89: the Sort General review sheet. The real DndContext renders; its
 * onDragEnd is captured so a test can deliver a drop, the chunk-63/88 pattern.
 */

const { apply, online, drag } = vi.hoisted(() => ({
  apply: vi.fn(),
  online: { value: true },
  drag: { onDragEnd: undefined as ((e: unknown) => void) | undefined },
}))

vi.mock('@/db/repo', () => ({ repo: { routing: { apply } } }))
vi.mock('@/lib/network', () => ({ isOnline: () => online.value }))
vi.mock('@/lib/useIsTouchDevice', () => ({ useIsTouchDevice: () => false }))
vi.mock('@dnd-kit/core', async (io) => {
  const actual = await io<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      drag.onDragEnd = props.onDragEnd as (e: unknown) => void
      return <actual.DndContext {...props} />
    },
  }
})

import type { Category, Subcategory } from '@/db/types'
import type { RoutingProposal } from '@/lib/sorting'

import SortingSheet from './SortingSheet'

const WORK = 'cat-work'
const PERSONAL = 'cat-personal'
const categories: Category[] = [
  { id: WORK, userId: 'u', name: 'Work' },
  { id: PERSONAL, userId: 'u', name: 'Personal' },
]
const sub = (id: string, categoryId: string, name: string, sortOrder: number): Subcategory => ({
  id,
  userId: 'u',
  categoryId,
  name,
  sortOrder,
  archivedAt: null,
})
const subcategories = [
  sub('w-gen', WORK, 'General', 0),
  sub('w-tax', WORK, 'Taxes', 1),
  sub('p-trip', PERSONAL, 'Trips', 0),
  sub('p-home', PERSONAL, 'Home', 1),
]

const p = (id: string, over: Partial<RoutingProposal> = {}): RoutingProposal => ({
  id,
  taskId: `t-${id}`,
  title: `Task ${id}`,
  fromSubcategoryId: 'w-gen',
  toSubcategoryId: null,
  newListName: null,
  newListCategoryId: null,
  reason: `Because ${id}`,
  createdAt: '2026-10-21T10:00:00Z',
  ...over,
})

const proposals = [
  p('a', { toSubcategoryId: 'w-tax' }),
  p('b', { newListName: 'Grants', newListCategoryId: WORK }),
  p('c', { newListName: 'grants', newListCategoryId: WORK }),
  p('d'),
]

function renderSheet(props: Partial<Parameters<typeof SortingSheet>[0]> = {}) {
  const onClose = vi.fn()
  render(
    <>
      <Toaster />
      <SortingSheet
        open
        proposals={proposals}
        categories={categories}
        subcategories={subcategories}
        onClose={onClose}
        {...props}
      />
    </>,
  )
  return { onClose }
}

const groupIds = () =>
  Array.from(document.querySelectorAll('[data-group]')).map((n) => n.getAttribute('data-group'))
const group = (id: string) => document.querySelector(`[data-group="${id}"]`) as HTMLElement
const cardsIn = (id: string) =>
  Array.from(group(id).querySelectorAll('[data-proposal]')).map((n) =>
    n.getAttribute('data-proposal'),
  )

function drop(proposalId: string, overId: string) {
  act(() => {
    drag.onDragEnd!({
      active: { id: `task:t-${proposalId}`, data: { current: { proposalId } } },
      over: { id: overId, data: { current: {} } },
    })
  })
}

beforeEach(() => {
  apply.mockReset()
  online.value = true
})

describe('SortingSheet', () => {
  it('groups: existing lists, then NEW lists, then Keep in General', () => {
    renderSheet()
    expect(groupIds()).toEqual(['list:w-tax', 'new:n1', 'keep'])
    expect(within(group('new:n1')).getByText('NEW')).toBeInTheDocument()
    expect(cardsIn('new:n1')).toEqual(['b', 'c'])
    expect(cardsIn('keep')).toEqual(['d'])
    // Title and Claude's reason on each card; the reason's full text on hover.
    expect(screen.getByText('Because a')).toHaveAttribute('title', 'Because a')
  })

  it('a drag between groups changes the destination', () => {
    renderSheet()
    drop('a', 'keep')
    expect(cardsIn('keep')).toEqual(['a', 'd'])
    expect(cardsIn('list:w-tax')).toEqual([])
  })

  it('Move to… an existing list not shown adds that group', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Move Task d to…' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Home' }))
    await waitFor(() => expect(groupIds()).toEqual(['list:w-tax', 'list:p-home', 'new:n1', 'keep']))
    expect(cardsIn('list:p-home')).toEqual(['d'])
  })

  it('a New group emptied by dragging disappears', () => {
    renderSheet()
    drop('b', 'keep')
    expect(groupIds()).toContain('new:n1')
    drop('c', 'list:w-tax')
    expect(groupIds()).toEqual(['list:w-tax', 'keep'])
  })

  it('renames a New group inline', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Rename new list Grants' }))
    const input = screen.getByRole('textbox', { name: 'New list name' })
    fireEvent.change(input, { target: { value: 'Taxes' } })
    expect(input).toHaveAttribute('aria-invalid', 'true') // an existing list
    fireEvent.change(input, { target: { value: 'Funding' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Rename new list Funding' })).toBeInTheDocument()
  })

  it('× keeps a task in General', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Task a in General' }))
    expect(cardsIn('keep')).toEqual(['a', 'd'])
  })

  it('+ New list adds an empty group cards can be dropped into', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'New list' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New list name' }), {
      target: { value: 'Admin' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: PERSONAL },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(groupIds()).toEqual(['list:w-tax', 'new:n1', 'new:n2', 'keep'])
    drop('d', 'new:n2')
    expect(cardsIn('new:n2')).toEqual(['d'])
  })

  it('Approve sends the exact arrangement in one call and toasts the counts', async () => {
    apply.mockResolvedValue({ moved: 2, kept: 1, stale: 1, created_lists: 1 })
    const { onClose } = renderSheet()
    drop('c', 'keep')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({
      new_lists: [{ key: 'n1', name: 'Grants', category_id: WORK }],
      items: [
        { proposal_id: 'a', to: { subcategory_id: 'w-tax' } },
        { proposal_id: 'b', to: { new_list_key: 'n1' } },
        { proposal_id: 'c', to: null },
        { proposal_id: 'd', to: null },
      ],
    })
    expect(await screen.findByText('Moved 2 · kept 1 · 1 changed since')).toBeInTheDocument()
  })

  it('a failed Approve keeps the sheet open', async () => {
    apply.mockRejectedValue(new Error('x'))
    const { onClose } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Could not save — retry')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offline: Approve is disabled with "Needs a connection"', () => {
    online.value = false
    renderSheet()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByText('Needs a connection')).toBeInTheDocument()
  })

  it('Not now closes without applying', () => {
    const { onClose } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })
})
