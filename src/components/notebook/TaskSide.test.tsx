import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The task side of the Notebook outside the sheet (chunk 59, D6–D7): the row
 * indicator and ⋯ item, the list header count, the drill-down's Notes
 * section, and the planner block's glyph and preview card. Each reads the
 * notes from context — nothing is drilled — so a context value is all a test
 * needs.
 */

const { touchMock } = vi.hoisted(() => ({ touchMock: { value: false } }))
vi.mock('@/lib/useIsTouchDevice', () => ({
  useIsTouchDevice: () => touchMock.value,
}))
vi.mock('@/lib/auth', () => ({
  useSession: () => ({ user: { id: 'u1' }, session: {}, loading: false }),
}))
vi.mock('@/db/repo', () => ({ repo: { settings: { get: vi.fn() } } }))

import BlockActionSheet from '@/components/planner/BlockActionSheet'
import TaskBlock from '@/components/planner/TaskBlock'
import SubcategoryHeader from '@/components/SubcategoryHeader'
import TaskRow from '@/components/TaskRow'
import type { Note } from '@/db/types'

import { CATEGORIES, mkNote, SUBCATEGORIES, TASKS } from './fixtures'
import ListNotesSection from './ListNotesSection'
import { NotesContext } from './notesContext'

const openTaskNotes = vi.fn()

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function mount(ui: ReactNode, notes: Note[]) {
  return render(
    <MemoryRouter>
      <NotesContext.Provider
        value={{ notes, report: () => undefined, openTaskNotes }}
      >
        {ui}
        <Where />
      </NotesContext.Provider>
    </MemoryRouter>,
  )
}

const TASK = TASKS[0] // t-open, "Ship the pricing page"
const ONE = [
  mkNote({ id: 'n1', title: 'Pricing notes', body: 'Open questions', taskId: 't-open', updatedAt: '2026-10-07T12:00:00.000Z' }),
]
const TWO = [
  ...ONE,
  mkNote({ id: 'n2', title: '', body: 'Older thought', taskId: 't-open', updatedAt: '2026-10-02T12:00:00.000Z' }),
]

const row = (notes: Note[]) =>
  mount(
    <TaskRow
      task={TASK}
      categories={CATEGORIES}
      subcategories={SUBCATEGORIES}
      dragEnabled={false}
      onComplete={vi.fn()}
      onEditTitle={vi.fn()}
      onEditMinutes={vi.fn()}
      onDelete={vi.fn()}
      onMoveToSubcategory={vi.fn()}
      onSetReminder={vi.fn()}
      onSetPriority={vi.fn()}
    />,
    notes,
  )

/** The row's grid template — the note column must be in it either way. */
const template = (container: HTMLElement) =>
  (container.querySelector('.grid') as HTMLElement).style.gridTemplateColumns

async function menuItem(name: RegExp) {
  fireEvent.keyDown(
    screen.getByRole('button', { name: `Actions for "${TASK.title}"` }),
    { key: 'Enter' },
  )
  return screen.findByRole('menuitem', { name })
}

beforeEach(() => {
  openTaskNotes.mockReset()
  touchMock.value = false
})

describe('task row note indicator (D6)', () => {
  it('0 notes: an empty reserved cell, and the menu offers "Add a note"', async () => {
    const { container } = row([])
    expect(screen.queryByTestId('note-indicator')).toBeNull()
    expect(screen.getByTestId('note-indicator-empty')).toBeInTheDocument()
    expect(template(container)).toContain('24px')

    fireEvent.click(await menuItem(/Add a note/))
    expect(openTaskNotes).toHaveBeenCalledWith('t-open')
  })

  it('1 note: the glyph with no count; clicking opens the sheet', () => {
    const { container } = row(ONE)
    const btn = screen.getByRole('button', {
      name: 'Notes for "Ship the pricing page"',
    })
    expect(btn.querySelector('svg')).not.toBeNull()
    expect(btn).toHaveTextContent('')
    expect(template(container)).toContain('24px')

    fireEvent.click(btn)
    expect(openTaskNotes).toHaveBeenCalledWith('t-open')
  })

  it('2 notes: glyph + count, and the menu reads "Notes" with the count', async () => {
    row(TWO)
    expect(
      screen.getByRole('button', {
        name: '2 notes for "Ship the pricing page"',
      }),
    ).toHaveTextContent('2')
    const item = await menuItem(/^Notes/)
    expect(item).toHaveTextContent('Notes2')
    expect(screen.queryByRole('menuitem', { name: /Edit notes/ })).toBeNull()
  })

  it('the grid template does not depend on the note count', () => {
    const none = template(row([]).container)
    const one = template(row(ONE).container)
    const two = template(row(TWO).container)
    expect(one).toBe(none)
    expect(two).toBe(none)
  })

  it('touch: the reserved column is 44px', () => {
    touchMock.value = true
    expect(template(row([]).container)).toContain('44px')
  })
})

describe('subcategory header count (D6)', () => {
  const header = (noteCount?: number) =>
    mount(
      <SubcategoryHeader
        subcategory={SUBCATEGORIES[0]}
        incompleteCount={3}
        incompleteMinutes={90}
        taskCount={4}
        noteCount={noteCount}
        otherSubsInCategory={[]}
        canMoveUp={false}
        canMoveDown={false}
        isTouch={false}
        onDrillDown={vi.fn()}
        onRename={vi.fn()}
        onDeleteSubcategory={vi.fn()}
        onMergeSubcategory={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
      />,
      [],
    )

  it('shows glyph + count beside the open count, and is not a button', () => {
    header(2)
    const count = screen.getByTestId('list-note-count')
    expect(count).toHaveTextContent('2')
    expect(count.tagName).toBe('SPAN')
    expect(count.closest('button')).toBeNull()
  })

  it('renders nothing with no notes', () => {
    header(0)
    expect(screen.queryByTestId('list-note-count')).toBeNull()
  })
})

describe('subcategory drill-down Notes section (D6)', () => {
  const listTasks = TASKS.filter((t) => t.subcategoryId === 's-atlas')
  const NOTES = [
    mkNote({ id: 'n-list', title: 'On list', subcategoryId: 's-atlas', updatedAt: '2026-10-03T12:00:00.000Z' }),
    mkNote({ id: 'n-task', title: 'On open task', taskId: 't-open', updatedAt: '2026-10-07T12:00:00.000Z' }),
    mkNote({ id: 'n-done', title: '', body: 'What went well', taskId: 't-done', updatedAt: '2026-10-08T12:00:00.000Z' }),
    mkNote({ id: 'n-else', title: 'Elsewhere', subcategoryId: 's-home' }),
    mkNote({ id: 'n-free', title: 'Freeform' }),
  ]
  const section = (notes: Note[]) =>
    mount(<ListNotesSection subcategoryId="s-atlas" tasks={listTasks} />, notes)

  it('lists the list’s notes and its tasks’ notes, newest first, labelled per row', () => {
    section(NOTES)
    expect(screen.getByText('Notes · 3')).toBeInTheDocument()
    const rows = screen.getAllByTestId('list-note-row')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('What went well'),
      expect.stringContaining('On open task'),
      expect.stringContaining('On list'),
    ])
    // A completed task's note is still listed, under its task.
    expect(within(rows[0]).getByText('Draft the announcement')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Ship the pricing page')).toBeInTheDocument()
    expect(within(rows[2]).getByText('On this list')).toBeInTheDocument()
  })

  it('a task note opens the sheet at that note; a list note goes to the Notebook', () => {
    section(NOTES)
    const rows = screen.getAllByTestId('list-note-row')
    fireEvent.click(rows[1])
    expect(openTaskNotes).toHaveBeenCalledWith('t-open', 'n-task')
    expect(screen.getByTestId('where')).toHaveTextContent('/')

    fireEvent.click(rows[2])
    expect(screen.getByTestId('where')).toHaveTextContent('/notebook/n-list')
  })

  it('empty copy', () => {
    section([])
    expect(screen.getByText('Notes · 0')).toBeInTheDocument()
    expect(screen.getByText('No notes on this list yet.')).toBeInTheDocument()
  })

  it('New note here hands the Notebook the list to attach to', () => {
    section([])
    fireEvent.click(screen.getByRole('button', { name: 'New note here' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/notebook?attach=subcategory:s-atlas',
    )
  })
})

describe('planner block (D7)', () => {
  const block = (startMin: number, endMin: number, notes: Note[]) =>
    mount(
      <TaskBlock
        block={{ id: 'b1', taskId: 't-open', day: 0, startMin, endMin }}
        task={TASK}
        catName="Work"
        hourH={52}
        windowStartMin={8 * 60}
        windowEndMin={19 * 60}
        done={false}
      />,
      notes,
    )

  it('shows the glyph on a block of 40px or more with notes', () => {
    block(9 * 60, 10 * 60, ONE) // 50px
    expect(screen.getByTestId('block-note-glyph')).toBeInTheDocument()
  })

  it('no glyph under 40px, and none without notes', () => {
    block(9 * 60, 9 * 60 + 30, ONE) // 24px — tight
    expect(screen.queryByTestId('block-note-glyph')).toBeNull()
    block(9 * 60, 10 * 60, [mkNote({ id: 'x', taskId: 't-other' })])
    expect(screen.queryByTestId('block-note-glyph')).toBeNull()
  })

  const sheet = (notes: Note[] | undefined, onOpenNotes = vi.fn()) => {
    render(
      <BlockActionSheet
        open
        title="Ship the pricing page"
        rangeText="10:00–11:30"
        done={false}
        notes={notes}
        onOpenNotes={onOpenNotes}
        onToggleDone={vi.fn()}
        onUnschedule={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    return onOpenNotes
  }

  it('one note: NOTE · updated · Open →, with the first line and excerpt', () => {
    const onOpenNotes = sheet(ONE)
    const card = screen.getByTestId('block-note-card')
    expect(within(card).getByText('Note')).toBeInTheDocument()
    expect(card).toHaveTextContent(/updated /)
    expect(within(card).getByText('Pricing notes')).toBeInTheDocument()
    expect(within(card).getByText('Open questions')).toHaveClass('line-clamp-3')
    // Read-only: no field to type in.
    expect(within(card).queryByRole('textbox')).toBeNull()

    fireEvent.click(within(card).getByRole('button', { name: 'Open' }))
    expect(onOpenNotes).toHaveBeenCalledWith('n1')
  })

  it('several notes: NOTES · N · latest, previewing the newest', () => {
    const onOpenNotes = sheet(TWO)
    const card = screen.getByTestId('block-note-card')
    expect(within(card).getByText('Notes · 2')).toBeInTheDocument()
    expect(card).toHaveTextContent(/latest /)
    expect(within(card).getByText('Pricing notes')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Open' }))
    expect(onOpenNotes).toHaveBeenCalledWith('n1')
  })

  it('no card without notes', () => {
    sheet([])
    expect(screen.queryByTestId('block-note-card')).toBeNull()
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
  })
})

