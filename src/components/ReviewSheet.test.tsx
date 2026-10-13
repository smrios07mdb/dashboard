import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

import ReviewSheet from './ReviewSheet'

/*
 * The review walk (chunk 74). Prop-driven: the sheet writes nothing itself —
 * "Add to Today" goes through `onToggleToday`, deletes leave through `onClose`.
 */

const CATEGORIES: Category[] = [{ id: 'c-work', userId: 'u1', name: 'Work' }]
const SUBCATEGORIES: Subcategory[] = [
  {
    id: 's-deals',
    userId: 'u1',
    categoryId: 'c-work',
    name: 'Deals',
    sortOrder: 0,
    archivedAt: null,
  },
]

function task(id: string, createdAt: string): Task {
  return {
    id,
    userId: 'u1',
    subcategoryId: 's-deals',
    title: `Title ${id}`,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  }
}

// Years old, so the age line is there whatever today's date is.
const CANDIDATES = [
  task('a', '2020-01-01T12:00:00.000Z'),
  task('b', '2020-02-01T12:00:00.000Z'),
  task('c', '2020-03-01T12:00:00.000Z'),
]

function setup() {
  const onToggleToday = vi.fn()
  const onClose = vi.fn()
  render(
    <ReviewSheet
      open
      candidates={CANDIDATES}
      categories={CATEGORIES}
      subcategories={SUBCATEGORIES}
      timeZone="America/New_York"
      onToggleToday={onToggleToday}
      onClose={onClose}
    />,
  )
  return { onToggleToday, onClose }
}

const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }))

describe('ReviewSheet', () => {
  it('shows one task at a time with its list and age', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Review' })
    expect(dialog).toHaveAccessibleDescription(
      'Keep, plan or delete each old task.',
    )
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.getByText('Title a')).toBeInTheDocument()
    expect(
      screen.getByText(/^Work › Deals · Added Jan 1, 2020 · \d+ years ago$/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Title b')).toBeNull()
  })

  it('walks Keep, Add to Today and Delete, then reports and closes once', () => {
    const { onToggleToday, onClose } = setup()

    press('Keep')
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Title b')).toBeInTheDocument()
    expect(onToggleToday).not.toHaveBeenCalled()

    press('Add to Today')
    expect(onToggleToday).toHaveBeenCalledTimes(1)
    expect(onToggleToday).toHaveBeenCalledWith('b', true)
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    expect(screen.getByText('Title c')).toBeInTheDocument()

    press('Delete')
    // Delete only marks: nothing is written and nothing closes yet.
    expect(onToggleToday).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(
      screen.getByText('Done — 1 kept · 1 added to Today · 1 deleted'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull()

    press('Done')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(['c'])
  })

  it('Escape mid-walk closes once with only the ids marked so far', () => {
    const { onToggleToday, onClose } = setup()

    press('Delete')
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(['a'])
    expect(onToggleToday).not.toHaveBeenCalled()
  })

  it('the close button mid-walk closes once with nothing to delete', () => {
    const { onClose } = setup()
    press('Keep')
    press('Close')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith([])
  })
})
