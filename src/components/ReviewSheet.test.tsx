import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'
import { REVIEW_SETTLE_MS } from '@/lib/review'

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
  const sheet = (open: boolean) => (
    <ReviewSheet
      open={open}
      candidates={CANDIDATES}
      categories={CATEGORIES}
      subcategories={SUBCATEGORIES}
      timeZone="America/New_York"
      onToggleToday={onToggleToday}
      onClose={onClose}
    />
  )
  const { rerender } = render(sheet(true))
  return {
    onToggleToday,
    onClose,
    reopen: (open: boolean) => rerender(sheet(open)),
  }
}

const settle = (ms = REVIEW_SETTLE_MS) => vi.setSystemTime(Date.now() + ms)

/** Clicks once the settle window (chunk 74a) has passed. */
const press = (name: string) => {
  settle()
  fireEvent.click(screen.getByRole('button', { name }))
}

/** Clicks without moving the clock. */
const tap = (name: string, detail = 1) =>
  fireEvent.click(screen.getByRole('button', { name }), { detail })

// Only `Date` is faked, so Radix's timers stay real.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T16:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

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

describe('ReviewSheet — one click, one task (chunk 74a)', () => {
  it('two quick clicks on Add to Today add one task', () => {
    const { onToggleToday } = setup()
    tap('Add to Today')
    tap('Add to Today')
    expect(onToggleToday).toHaveBeenCalledTimes(1)
    expect(onToggleToday).toHaveBeenCalledWith('a', true)
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('a double-click on Delete marks one task', () => {
    const { onClose } = setup()
    tap('Delete')
    tap('Delete', 2)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(['a'])
  })

  it('a double-click on Keep advances once', () => {
    setup()
    tap('Keep')
    tap('Keep', 2)
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('a second click after the window acts on the next task', () => {
    const { onToggleToday } = setup()
    tap('Add to Today')
    settle()
    tap('Add to Today')
    expect(onToggleToday).toHaveBeenCalledTimes(2)
    expect(onToggleToday).toHaveBeenNthCalledWith(1, 'a', true)
    expect(onToggleToday).toHaveBeenNthCalledWith(2, 'b', true)
  })

  it('a late second click of a double-click is still ignored', () => {
    setup()
    tap('Keep')
    settle(REVIEW_SETTLE_MS * 2)
    tap('Keep', 2)
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('Done waits out the window after the last card', () => {
    const { onClose } = setup()
    press('Keep')
    press('Keep')
    press('Keep')
    tap('Done')
    expect(onClose).not.toHaveBeenCalled()
    settle()
    tap('Done')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a fresh open acts at once', () => {
    const { reopen } = setup()
    tap('Keep')
    reopen(false)
    reopen(true)
    tap('Keep')
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })
})
