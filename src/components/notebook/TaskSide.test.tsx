import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The task side of the Notebook outside the sheet (chunk 59, D6–D7): the row's
 * ⋯ item (the row indicator left in chunk 71), the list header count, the drill-down's Notes
 * section, and the planner block's glyph and preview card. Each reads the
 * notes from context — nothing is drilled — so a context value is all a test
 * needs.
 */

const { touchMock, sessionMock, repoMock } = vi.hoisted(() => ({
  touchMock: { value: false },
  sessionMock: { ready: Promise.resolve() as Promise<void> },
  repoMock: {
    settings: { get: vi.fn() },
    notes: {
      listAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    categories: { list: vi.fn() },
    subcategories: { list: vi.fn() },
    tasks: { list: vi.fn() },
  },
}))
vi.mock('@/lib/useIsTouchDevice', () => ({
  useIsTouchDevice: () => touchMock.value,
}))
// `useSession` as it really behaves: per-instance state that starts with no
// user and gains one only after its own async `getSession()` settles. A
// synchronous mock hid chunk 59a's F1 — a sheet that asked for the session on
// its first render always got `null`.
vi.mock('@/lib/auth', async () => {
  const { useEffect, useState } = await import('react')
  return {
    useSession: () => {
      const [user, setUser] = useState<{ id: string } | null>(null)
      useEffect(() => {
        let cancelled = false
        void sessionMock.ready.then(() => {
          if (!cancelled) setUser({ id: 'u1' })
        })
        return () => {
          cancelled = true
        }
      }, [])
      return { user, session: user ? {} : null, loading: user === null }
    },
  }
})
vi.mock('@/db/repo', () => ({ repo: repoMock }))
vi.mock('@/db/outbox', () => ({ countOutboxFor: () => Promise.resolve(0) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/state/uiStore', () => ({
  useUIStore: (selector: (s: { dashboardRefreshKey: number }) => unknown) =>
    selector({ dashboardRefreshKey: 0 }),
}))

import BlockActionSheet from '@/components/planner/BlockActionSheet'
import TaskBlock from '@/components/planner/TaskBlock'
import SubcategoryHeader from '@/components/SubcategoryHeader'
import TaskRow from '@/components/TaskRow'
import type { Note } from '@/db/types'
import { noteRel } from '@/lib/notes'

import { CATEGORIES, mkNote, SUBCATEGORIES, TASKS } from './fixtures'
import ListNotesSection from './ListNotesSection'
import { NotesContext, useOpenTaskNotes } from './notesContext'
import NotesProvider from './NotesProvider'

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
      onSetDue={vi.fn()}
      onSetPriority={vi.fn()}
    />,
    notes,
  )

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

// Chunk 71: the row's note column is gone — notes are reached through ⋯.
describe('task row notes live in the ⋯ menu (chunk 71)', () => {
  it.each([
    ['0 notes', []],
    ['1 note', ONE],
    ['2 notes', TWO],
  ])('%s: no note indicator on the row', (_label, notes) => {
    row(notes)
    expect(screen.queryByTestId('note-indicator')).toBeNull()
    expect(screen.queryByTestId('note-indicator-empty')).toBeNull()
    expect(screen.queryByRole('button', { name: /notes for "/i })).toBeNull()
  })

  it('0 notes: the menu offers "Add a note", which opens the sheet', async () => {
    row([])
    fireEvent.click(await menuItem(/Add a note/))
    expect(openTaskNotes).toHaveBeenCalledWith('t-open')
  })

  it('1 note: the menu reads "Notes" with the relative time, and opens the sheet', async () => {
    row(ONE)
    const item = await menuItem(/^Notes/)
    expect(item).toHaveTextContent(`Notes${noteRel(ONE[0].updatedAt)}`)
    fireEvent.click(item)
    expect(openTaskNotes).toHaveBeenCalledWith('t-open')
  })

  it('2 notes: the menu reads "Notes" with the count, and opens the sheet', async () => {
    row(TWO)
    const item = await menuItem(/^Notes/)
    expect(item).toHaveTextContent('Notes2')
    expect(screen.queryByRole('menuitem', { name: /Edit notes/ })).toBeNull()
    fireEvent.click(item)
    expect(openTaskNotes).toHaveBeenCalledWith('t-open')
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

  // F3 (chunk 59a): with the count showing, the header wrapped its ⋯ button to
  // a second row. Layout is not measurable in jsdom, so this pins the contract
  // that keeps it on one: the grid still has exactly its six cells, the name
  // truncates, and everything after it refuses to shrink.
  it.each([0, 2])('stays one row of six cells with noteCount=%i', (n) => {
    const { container } = header(n)
    const root = container.querySelector('header') as HTMLElement
    expect(root.className).toContain(
      '[grid-template-columns:auto_1fr_auto_auto_auto_auto]',
    )
    expect(root.children).toHaveLength(6)

    const name = screen.getByTitle('Atlas launch')
    expect(name).toHaveClass('min-w-0', 'truncate')
    expect(name.parentElement).toHaveClass('min-w-0')

    const counts = screen.getByTestId('list-counts')
    expect(counts).toHaveClass('shrink-0')
    expect(counts).toHaveTextContent(n ? '32' : '3')
    if (n) expect(screen.getByTestId('list-note-count')).toHaveClass('shrink-0')
    expect(screen.getByText('1h 30m')).toHaveClass('shrink-0')
    expect(screen.getByRole('button', { name: 'Open Atlas launch' })).toHaveClass('shrink-0')
    expect(
      screen.getByRole('button', { name: 'Actions for Atlas launch' }),
    ).toHaveClass('shrink-0')
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

describe('task notes sheet with a session that resolves late (chunk 59a, F1)', () => {
  function Opener() {
    const open = useOpenTaskNotes()
    return (
      <button type="button" onClick={() => open('t-archived')}>
        add a note
      </button>
    )
  }

  beforeEach(() => {
    for (const group of Object.values(repoMock)) {
      for (const fn of Object.values(group)) fn.mockReset()
    }
    repoMock.notes.listAll.mockResolvedValue([])
    repoMock.categories.list.mockResolvedValue(CATEGORIES)
    repoMock.subcategories.list.mockResolvedValue(SUBCATEGORIES)
    repoMock.tasks.list.mockResolvedValue(TASKS)
  })

  it('a 0-note task opens on the draft editor, not the empty list, and writes nothing', async () => {
    // The session is still unresolved when the provider first renders AND
    // when the task's notes are asked for.
    let resolveSession!: () => void
    sessionMock.ready = new Promise<void>((r) => (resolveSession = r))

    render(
      <MemoryRouter>
        <NotesProvider>
          <Opener />
        </NotesProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'add a note' }))
    await act(async () => {
      resolveSession()
      await sessionMock.ready
    })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Legacy cleanup')
    expect(await screen.findByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('Note body')).toHaveValue('')
    // Not the empty list with its lone button.
    expect(screen.queryByRole('button', { name: 'New note' })).toBeNull()

    // Still D4: nothing is written while the draft is empty.
    const body = screen.getByLabelText('Note body')
    fireEvent.change(body, { target: { value: '  ' } })
    fireEvent.blur(body)
    await Promise.resolve()
    expect(repoMock.notes.create).not.toHaveBeenCalled()

    fireEvent.change(body, { target: { value: 'Now it counts' } })
    fireEvent.blur(body)
    await waitFor(() => expect(repoMock.notes.create).toHaveBeenCalledTimes(1))
    expect(repoMock.notes.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', taskId: 't-archived' }),
    )
    sessionMock.ready = Promise.resolve()
  })

  it('same, when the session resolved before the click (the usual order)', async () => {
    sessionMock.ready = Promise.resolve()
    render(
      <MemoryRouter>
        <NotesProvider>
          <Opener />
        </NotesProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await sessionMock.ready
    })
    fireEvent.click(screen.getByRole('button', { name: 'add a note' }))
    expect(await screen.findByLabelText('Title')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'New note' })).toBeNull()
    expect(repoMock.notes.create).not.toHaveBeenCalled()
  })
})
