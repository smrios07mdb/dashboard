import { DndContext } from '@dnd-kit/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 71: the quiet task row. The row shows checkbox, grip, title, priority
 * chip, one when-chip, minutes, sun and ⋯; bell, trash and the note column
 * are gone. `Date` alone is faked (Tuesday Oct 13 2026, 12:00 in New York) so
 * the chip text is fixed while Radix keeps its real timers, and
 * `@/lib/userTimezone` is mocked so no assertion depends on the machine's zone.
 */

const { touchMock } = vi.hoisted(() => ({ touchMock: { value: false } }))
vi.mock('@/lib/useIsTouchDevice', () => ({
  useIsTouchDevice: () => touchMock.value,
}))
vi.mock('@/lib/userTimezone', () => ({
  browserTimezone: () => 'America/New_York',
  loadUserTimezone: () => Promise.resolve('America/New_York'),
}))

import { NotesContext } from '@/components/notebook/notesContext'
import type { Task } from '@/db/types'

import TaskRow, { type TaskRowProps } from './TaskRow'

// Radix Popover / DropdownMenu need these jsdom shims.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

const NOW = '2026-10-13T16:00:00.000Z'
const TWO_DAYS_LATE = '2026-10-11T04:00:00.000Z' // 00:00 Oct 11, New York
const LATER_TODAY = '2026-10-13T19:00:00.000Z' // 3:00 PM, New York

const BASE: Task = {
  id: 't1',
  userId: 'u1',
  subcategoryId: 's1',
  title: 'Atlas launch',
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

function row(over: Partial<Task> = {}, props: Partial<TaskRowProps> = {}) {
  return render(
    <MemoryRouter>
      <NotesContext.Provider
        value={{ notes: [], report: () => undefined, openTaskNotes: vi.fn() }}
      >
        <DndContext>
          <TaskRow
            task={{ ...BASE, ...over }}
            categories={[]}
            subcategories={[]}
            onComplete={vi.fn()}
            onEditTitle={vi.fn()}
            onEditMinutes={vi.fn()}
            onDelete={vi.fn()}
            onMoveToSubcategory={vi.fn()}
            onSetReminder={vi.fn()}
            onSetDue={vi.fn()}
            onSetPriority={vi.fn()}
            onToggleToday={vi.fn()}
            timeZone="America/New_York"
            {...props}
          />
        </DndContext>
      </NotesContext.Provider>
    </MemoryRouter>,
  )
}

/** Every when-chip on screen, due or reminder. */
const chips = () =>
  screen.queryAllByRole('button', { name: /— edit (due date|reminder)$/ })

async function menuItem(name: RegExp) {
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Actions for "Atlas launch"' }),
    { key: 'Enter' },
  )
  return screen.findByRole('menuitem', { name })
}

beforeEach(() => {
  touchMock.value = false
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TaskRow — quiet row (chunk 71)', () => {
  it('(1) shows only the daily controls', () => {
    row()
    expect(
      screen.getByRole('checkbox', { name: 'Mark task complete' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atlas launch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit minutes' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add "Atlas launch" to Today' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Actions for "Atlas launch"' }),
    ).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Set reminder' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit reminder' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Delete task "Atlas launch"' }),
    ).toBeNull()
    expect(screen.queryByTestId('note-indicator')).toBeNull()
    expect(screen.queryByTestId('note-indicator-empty')).toBeNull()
    expect(chips()).toHaveLength(0)
  })

  it('(1) the grid is checkbox, grip, title, minutes, sun, ⋯ — nothing reserved', () => {
    const { container } = row()
    const grid = container.querySelector('.grid') as HTMLElement
    expect(grid.style.gridTemplateColumns).toBe('18px 14px 1fr auto auto auto')
    expect(grid.children).toHaveLength(6)
  })

  it('(2) a due date two days late: destructive chip that opens the due picker', async () => {
    row({ dueAt: TWO_DAYS_LATE })
    const chip = screen.getByRole('button', {
      name: 'Due Sunday, October 11 — edit due date',
    })
    expect(chip).toHaveTextContent('2d late')
    expect(chip).toHaveClass('text-destructive')
    expect(chip).toHaveAttribute('title', 'Due Sunday, October 11')
    expect(chip.querySelector('svg')).toBeNull()

    fireEvent.click(chip)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Due date')).toBeInTheDocument()
  })

  it('(3) a reminder later today: bell + time chip that opens the reminder picker', async () => {
    row({ remindAt: LATER_TODAY })
    const chip = screen.getByRole('button', {
      name: 'Reminder Tuesday, October 13, 3:00 PM — edit reminder',
    })
    expect(chip).toHaveTextContent('Today 3:00 PM')
    expect(chip).toHaveClass('text-[var(--accent-ink)]')
    expect(chip.querySelector('svg')).not.toBeNull()

    fireEvent.click(chip)
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByLabelText('Reminder date and time'),
    ).toBeInTheDocument()
  })

  it('(4) due and reminder both set: only the due chip', () => {
    row({ dueAt: TWO_DAYS_LATE, remindAt: LATER_TODAY })
    expect(chips()).toHaveLength(1)
    expect(chips()[0]).toHaveTextContent('2d late')
  })

  it('(5) a completed task shows no chip', () => {
    row({ dueAt: TWO_DAYS_LATE, completedAt: '2026-10-12T12:00:00.000Z' })
    expect(chips()).toHaveLength(0)
  })

  it('(6) ⋯ → Edit reminder on a due-chip row opens the reminder picker, anchor-only', async () => {
    const { container } = row({ dueAt: TWO_DAYS_LATE, remindAt: LATER_TODAY })
    const grid = container.querySelector('.grid') as HTMLElement
    const closed = grid.style.gridTemplateColumns

    fireEvent.click(await menuItem(/Edit reminder/))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByLabelText('Reminder date and time'),
    ).toBeInTheDocument()
    // Still one chip — the due one; the reminder picker got its own slot.
    expect(chips()).toHaveLength(1)
    expect(grid.style.gridTemplateColumns).toBe(
      closed.replace('1fr auto', '1fr auto auto'),
    )
  })

  it('(6) ⋯ → Set reminder… / Set due date… open their pickers on a row with no chip', async () => {
    row()
    fireEvent.click(await menuItem(/Set reminder…/))
    expect(
      await screen.findByLabelText('Reminder date and time'),
    ).toBeInTheDocument()
    expect(chips()).toHaveLength(0)
  })

  // Chunk 72: the confirm is gone — Delete calls straight through.
  it('(6) ⋯ → Delete calls onDelete with no confirm', async () => {
    const onDelete = vi.fn()
    row({ dueAt: TWO_DAYS_LATE }, { onDelete })
    fireEvent.click(await menuItem(/^Delete$/))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('(7) title wraps to two lines; grip and minutes reach 24px', () => {
    row()
    const title = screen.getByRole('button', { name: 'Atlas launch' })
    expect(title).toHaveClass('line-clamp-2', 'whitespace-normal', 'break-words')
    expect(title).not.toHaveClass('truncate')
    expect(title).toHaveAttribute('title', 'Atlas launch')

    const grip = screen.getByRole('button', {
      name: 'Drag to move "Atlas launch"',
    })
    expect(grip).toHaveClass('relative', 'before:size-6', 'w-3.5')

    expect(screen.getByRole('button', { name: 'Edit minutes' })).toHaveClass(
      'min-h-6',
    )
  })

  it('(8) touch: the chip reaches 44pt and there is no grip', () => {
    touchMock.value = true
    row({ dueAt: TWO_DAYS_LATE })
    expect(chips()[0]).toHaveClass('before:size-11')
    expect(
      screen.queryByRole('button', { name: 'Drag to move "Atlas launch"' }),
    ).toBeNull()
  })

  it('(8) pointer: the chip keeps its 24px box and no 44pt extension', () => {
    row({ dueAt: TWO_DAYS_LATE })
    expect(chips()[0]).toHaveClass('min-h-6')
    expect(chips()[0]).not.toHaveClass('before:size-11')
  })

  it('the chip reads in the zone it is given', () => {
    // 00:00 Oct 14 in New York is still Oct 13 in Los Angeles.
    row({ dueAt: '2026-10-14T04:00:00.000Z' }, { timeZone: 'America/Los_Angeles' })
    expect(chips()[0]).toHaveTextContent('Today')
  })
})
