import { DndContext } from '@dnd-kit/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function twoRows() {
  const props = {
    categories: [],
    subcategories: [],
    onComplete: vi.fn(),
    onEditTitle: vi.fn(),
    onEditMinutes: vi.fn(),
    onDelete: vi.fn(),
    onMoveToSubcategory: vi.fn(),
    onSetReminder: vi.fn(),
    onSetDue: vi.fn(),
    onSetPriority: vi.fn(),
    onToggleToday: vi.fn(),
    timeZone: 'America/New_York',
  }
  return render(
    <MemoryRouter>
      <NotesContext.Provider
        value={{ notes: [], report: () => undefined, openTaskNotes: vi.fn() }}
      >
        <DndContext>
          <TaskRow task={BASE} {...props} />
          <TaskRow task={{ ...BASE, id: 't2', title: 'Beacon review' }} {...props} />
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

// Chunk 74: open rows 28 days or older show how old they are.
describe('TaskRow — age (chunk 74)', () => {
  const HUNDRED_DAYS = '2026-07-05T16:00:00.000Z' // 12:00 Jul 5, New York
  const TEN_DAYS = '2026-10-03T16:00:00.000Z'
  const LONG = 'Added Jul 5 · 14 weeks ago'

  it('a 100-day-old open row shows 14w, with the long text for title and screen readers', () => {
    const { container } = row({ createdAt: HUNDRED_DAYS })
    const short = screen.getByText('14w')
    expect(short).toHaveAttribute('aria-hidden', 'true')
    const age = short.parentElement!
    expect(age).toHaveAttribute('title', LONG)
    const spoken = screen.getByText(LONG)
    expect(spoken).toHaveClass('sr-only')
    expect(age).toContainElement(spoken)

    // Its own slot, between the title and the minutes.
    const grid = container.querySelector('.grid') as HTMLElement
    expect(grid.style.gridTemplateColumns).toBe(
      '18px 14px 1fr auto auto auto auto',
    )
    const cells = [...grid.children]
    expect(cells.indexOf(age)).toBe(
      cells.indexOf(screen.getByRole('button', { name: 'Edit minutes' })) - 1,
    )
  })

  it('sits after the when chip', () => {
    const { container } = row({ createdAt: HUNDRED_DAYS, dueAt: TWO_DAYS_LATE })
    const cells = [...(container.querySelector('.grid') as HTMLElement).children]
    expect(cells.indexOf(screen.getByText('14w').parentElement!)).toBe(
      cells.indexOf(chips()[0]) + 1,
    )
  })

  it('shows no age on a 10-day-old row', () => {
    const { container } = row({ createdAt: TEN_DAYS })
    expect(screen.queryByText(/^\d+[wy]$/)).toBeNull()
    expect(screen.queryByText(/^Added /)).toBeNull()
    expect(
      (container.querySelector('.grid') as HTMLElement).style.gridTemplateColumns,
    ).toBe('18px 14px 1fr auto auto auto')
  })

  it('shows no age on a completed row', () => {
    row({ createdAt: HUNDRED_DAYS, completedAt: '2026-10-12T12:00:00.000Z' })
    expect(screen.queryByText('14w')).toBeNull()
    expect(screen.queryByText(LONG)).toBeNull()
  })

  it('is not a button and adds no tab stop', () => {
    const tabStops = (c: HTMLElement) =>
      c.querySelectorAll('button, input, a[href], [tabindex]').length
    const young = row({ createdAt: TEN_DAYS })
    const without = tabStops(young.container)
    young.unmount()

    const old = row({ createdAt: HUNDRED_DAYS })
    expect(tabStops(old.container)).toBe(without)
    const age = screen.getByText('14w').parentElement!
    expect(age.tagName).toBe('SPAN')
    expect(age.closest('button')).toBeNull()
    expect(age).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('button', { name: /14w|Added Jul 5/ })).toBeNull()
  })

  it('counts days in the zone it is given', () => {
    // 03:30 UTC on Sep 15 is still Sep 14 in New York: 29 days there, 28 in UTC.
    const createdAt = '2026-09-15T03:30:00.000Z'
    const ny = row({ createdAt })
    expect(screen.getByText('Added Sep 14 · 4 weeks ago')).toBeInTheDocument()
    ny.unmount()
    row({ createdAt }, { timeZone: 'UTC' })
    expect(screen.getByText('Added Sep 15 · 4 weeks ago')).toBeInTheDocument()
  })
})

// Chunk 77: one tab stop per row; ← / → / Home / End between its controls.
describe('TaskRow — one tab stop per row (chunk 77)', () => {
  const group = (name = 'Atlas launch') => screen.getByRole('group', { name })
  const stops = (el: HTMLElement) =>
    [...el.querySelectorAll('*')].filter((n) => (n as HTMLElement).tabIndex >= 0)
  const complete = (name = 'Atlas launch') =>
    within(group(name)).getByRole('checkbox', { name: 'Mark task complete' })
  const btn = (name: string | RegExp, rowName = 'Atlas launch') =>
    within(group(rowName)).getByRole('button', { name })

  it('(1) a row has exactly one tab stop: the completion checkbox', () => {
    const plain = row()
    expect(stops(group())).toEqual([complete()])
    expect(btn('Drag to move "Atlas launch"').tabIndex).toBe(-1)
    plain.unmount()

    row({ priority: 2, dueAt: TWO_DAYS_LATE })
    expect(stops(group())).toEqual([complete()])
  })

  it('(2) Tab moves from row to row', async () => {
    const user = userEvent.setup()
    twoRows()
    await user.tab()
    expect(complete()).toHaveFocus()
    await user.tab()
    expect(complete('Beacon review')).toHaveFocus()
  })

  it('(3) the arrows walk the row, Home / End jump, nothing wraps', async () => {
    const user = userEvent.setup()
    row({ priority: 2, dueAt: TWO_DAYS_LATE })
    complete().focus()
    const order = [
      btn('Atlas launch'),
      btn('Priority 2 — change priority'),
      btn('Due Sunday, October 11 — edit due date'),
      btn('Edit minutes'),
      btn('Add "Atlas launch" to Today'),
      btn('Actions for "Atlas launch"'),
    ]
    for (const el of order) {
      await user.keyboard('{ArrowRight}')
      expect(el).toHaveFocus()
    }
    const menu = order[order.length - 1]
    await user.keyboard('{ArrowRight}')
    expect(menu).toHaveFocus()
    await user.keyboard('{Home}')
    expect(complete()).toHaveFocus()
    await user.keyboard('{End}')
    expect(menu).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(btn('Add "Atlas launch" to Today')).toHaveFocus()
    complete().focus()
    await user.keyboard('{ArrowLeft}')
    expect(complete()).toHaveFocus()
  })

  it('(4) the row remembers its last control', async () => {
    const user = userEvent.setup()
    twoRows()
    complete().focus()
    for (let i = 0; i < 2; i++) await user.keyboard('{ArrowRight}')
    const minutes = btn('Edit minutes')
    expect(minutes).toHaveFocus()
    expect(minutes.tabIndex).toBe(0)
    expect(complete().tabIndex).toBe(-1)
    await user.tab()
    expect(complete('Beacon review')).toHaveFocus()
    await user.tab({ shift: true })
    expect(minutes).toHaveFocus()
  })

  it('(5) a click moves the tab stop', async () => {
    const user = userEvent.setup()
    row()
    const sun = btn('Add "Atlas launch" to Today')
    await user.click(sun)
    expect(sun.tabIndex).toBe(0)
    expect(complete().tabIndex).toBe(-1)
  })

  it('(6) a selectable row: the stop is completion; ← and Home reach Select task', async () => {
    const user = userEvent.setup()
    row({}, { selectable: true, dragEnabled: false })
    const select = within(group()).getByRole('checkbox', { name: 'Select task' })
    expect(stops(group())).toEqual([complete()])
    complete().focus()
    await user.keyboard('{ArrowLeft}')
    expect(select).toHaveFocus()
    btn('Actions for "Atlas launch"').focus()
    await user.keyboard('{Home}')
    expect(select).toHaveFocus()
  })

  it('(7) arrows inside the inline inputs stay in the input', async () => {
    const user = userEvent.setup()
    row()
    await user.click(screen.getByRole('button', { name: 'Atlas launch' }))
    const title = screen.getByRole('textbox', { name: 'Task title' })
    await user.keyboard('{ArrowRight}{Home}')
    expect(document.activeElement).toBe(title)
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Edit minutes' }))
    const minutes = screen.getByLabelText('Estimate minutes')
    await user.keyboard('{ArrowRight}{Home}')
    expect(document.activeElement).toBe(minutes)
  })

  it('(8) Enter / Escape return focus to the button; blur does not', async () => {
    const user = userEvent.setup()
    row()
    for (const key of ['{Enter}', '{Escape}']) {
      await user.click(btn('Atlas launch'))
      await user.keyboard('x' + key)
      expect(document.activeElement).toBe(btn('Atlas launch'))
    }
    for (const key of ['{Enter}', '{Escape}']) {
      await user.click(btn('Edit minutes'))
      await user.keyboard('5' + key)
      expect(document.activeElement).toBe(btn('Edit minutes'))
    }

    await user.click(btn('Atlas launch'))
    fireEvent.blur(screen.getByRole('textbox', { name: 'Task title' }))
    expect(document.activeElement).not.toBe(btn('Atlas launch'))
    await user.click(btn('Edit minutes'))
    fireEvent.blur(screen.getByLabelText('Estimate minutes'))
    expect(document.activeElement).not.toBe(btn('Edit minutes'))
  })

  it('(9) the stop falls back to completion when its control leaves', async () => {
    const user = userEvent.setup()
    const r = row({ priority: 2 })
    complete().focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(btn('Priority 2 — change priority')).toHaveFocus()

    r.rerender(
      <MemoryRouter>
        <NotesContext.Provider
          value={{ notes: [], report: () => undefined, openTaskNotes: vi.fn() }}
        >
          <DndContext>
            <TaskRow
              task={{ ...BASE, priority: null }}
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
            />
          </DndContext>
        </NotesContext.Provider>
      </MemoryRouter>,
    )
    expect(complete().tabIndex).toBe(0)
    expect(
      [...group().querySelectorAll<HTMLElement>('[data-row-nav]')].filter(
        (el) => el.tabIndex === 0,
      ),
    ).toEqual([complete()])
  })

  it('(10) row keys still bubble to window (chunk 76a)', () => {
    row()
    const seen: string[] = []
    const listener = (e: KeyboardEvent) =>
      seen.push(`${e.metaKey ? 'meta+' : ''}${e.key}`)
    window.addEventListener('keydown', listener)
    try {
      const box = screen.getByRole('checkbox', { name: 'Mark task complete' })
      box.focus()
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      )
      const title = screen.getByRole('button', { name: 'Atlas launch' })
      title.focus()
      title.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
      )
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
    } finally {
      window.removeEventListener('keydown', listener)
    }
    expect(seen).toEqual(['ArrowRight', 'meta+k', 'n'])
  })

  it('(11) modified arrows do nothing', () => {
    row()
    const box = screen.getByRole('checkbox', { name: 'Mark task complete' })
    box.focus()
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
      fireEvent.keyDown(box, { key: 'ArrowRight', [mod]: true })
      expect(box).toHaveFocus()
    }
  })

  it('(12) keys inside a portaled picker do nothing to the row', async () => {
    const user = userEvent.setup()
    row({ dueAt: TWO_DAYS_LATE })
    fireEvent.click(screen.getByRole('button', { name: 'Due Sunday, October 11 — edit due date' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('Due date')
    input.focus()
    await user.keyboard('{ArrowRight}')
    expect(input).toHaveFocus()
    await user.keyboard('{End}')
    expect(input).toHaveFocus()
  })

  it('(13) the row is a group named by its title', () => {
    row()
    expect(group()).toContainElement(complete())
  })
})
