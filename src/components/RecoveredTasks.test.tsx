import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

import RecoveredTasks from './RecoveredTasks'

/*
 * Chunk 70 (UX audit #4): open tasks under archived or missing subcategories
 * are listed here so they can be moved or completed. Prop-driven — no repo.
 */

const cat = (id: string, name: 'Work' | 'Personal'): Category => ({
  id,
  userId: 'u1',
  name,
})
const sub = (
  id: string,
  categoryId: string,
  name: string,
  sortOrder: number,
): Subcategory => ({
  id,
  userId: 'u1',
  categoryId,
  name,
  sortOrder,
  archivedAt: null,
})
const task = (id: string, subcategoryId: string, title: string): Task => ({
  id,
  userId: 'u1',
  subcategoryId,
  title,
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const CATS = [cat('c-personal', 'Personal'), cat('c-work', 'Work')]
// Deliberately out of sortOrder, and interleaved across categories.
const LIVE = [
  sub('s-w2', 'c-work', 'Email', 1),
  sub('s-p1', 'c-personal', 'Home', 0),
  sub('s-w1', 'c-work', 'Atlas', 0),
]
const TASKS = [
  task('t1', 's-old', 'Renew passport'),
  task('t2', 's-gone', 'Call the plumber'),
]
const NAMES = { 's-old': 'Old list', 's-w1': 'Atlas' }

function renderCard(tasks: Task[] = TASKS) {
  const onMove = vi.fn()
  const onComplete = vi.fn()
  const view = render(
    <RecoveredTasks
      tasks={tasks}
      subNameById={NAMES}
      liveSubcategories={LIVE}
      categories={CATS}
      onMove={onMove}
      onComplete={onComplete}
    />,
  )
  return { ...view, onMove, onComplete }
}

describe('RecoveredTasks', () => {
  afterEach(cleanup)

  it('renders nothing when there are no tasks', () => {
    const { container } = renderCard([])
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each task with the list it came from, and the count', () => {
    renderCard()
    const card = screen.getByRole('region', { name: 'Recovered' })
    expect(within(card).getByText('2')).toBeInTheDocument()
    expect(within(card).getByText('Renew passport')).toBeInTheDocument()
    expect(within(card).getByText('from Old list')).toBeInTheDocument()
    expect(within(card).getByText('Call the plumber')).toBeInTheDocument()
    expect(within(card).getByText('from a deleted list')).toBeInTheDocument()
  })

  it('groups the live lists by category, in prop order and sortOrder', () => {
    renderCard()
    const select = screen.getByLabelText(
      'Move Renew passport to',
    ) as HTMLSelectElement
    const groups = Array.from(select.querySelectorAll('optgroup'))
    expect(groups.map((g) => g.label)).toEqual(['Personal', 'Work'])
    expect(
      groups.map((g) =>
        Array.from(g.querySelectorAll('option')).map((o) => o.textContent),
      ),
    ).toEqual([['Home'], ['Atlas', 'Email']])
    const placeholder = within(select).getByRole('option', {
      name: 'Move to…',
    }) as HTMLOptionElement
    expect(placeholder.selected).toBe(true)
    expect(placeholder.disabled).toBe(true)
  })

  it('moves on select and completes on Done', async () => {
    const user = userEvent.setup()
    const { onMove, onComplete } = renderCard()

    await user.selectOptions(
      screen.getByLabelText('Move Renew passport to'),
      's-w2',
    )
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith('t1', 's-w2')

    await user.click(
      screen.getByRole('button', { name: 'Mark Call the plumber done' }),
    )
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('t2')
  })
})
