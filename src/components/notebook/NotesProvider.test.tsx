import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * NotesProvider + the task notes sheet (chunk 59, D5/D6).
 *
 * The provider holds every note and is told about each write by
 * `useNoteWriter`, so counts move with no refetch. The sheet opens on a draft
 * (0 notes), the editor (1) or a list (2+), and writes by the Notebook's rules.
 */

const { repoMock, toastMock, touchMock } = vi.hoisted(() => ({
  repoMock: {
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
  toastMock: { success: vi.fn(), error: vi.fn() },
  touchMock: { value: false },
}))

vi.mock('@/db/repo', () => ({ repo: repoMock }))
vi.mock('@/db/outbox', () => ({ countOutboxFor: () => Promise.resolve(0) }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/lib/auth', () => ({
  useSession: () => ({
    user: { id: 'u1', email: 'a@b.c' },
    session: {},
    loading: false,
  }),
}))
vi.mock('@/lib/useIsTouchDevice', () => ({
  useIsTouchDevice: () => touchMock.value,
}))
vi.mock('@/state/uiStore', () => ({
  useUIStore: (selector: (s: { dashboardRefreshKey: number }) => unknown) =>
    selector({ dashboardRefreshKey: 0 }),
}))

import type { Note } from '@/db/types'

import {
  CATEGORIES,
  mkNote,
  NOTES,
  SUBCATEGORIES,
  TASKS,
} from './fixtures'
import {
  useListNotes,
  useOpenTaskNotes,
  useTaskNotes,
} from './notesContext'
import NotesProvider from './NotesProvider'
import { useNoteWriter } from './useNoteWriter'

/** A second, older note on the open task — makes it a "2+" task. */
const SECOND = mkNote({
  id: 'n-task-2',
  title: '',
  body: 'Second thought\nwith a second line',
  taskId: 't-open',
  updatedAt: '2026-10-04T12:00:00.000Z',
})

function Probe() {
  const { pathname } = useLocation()
  const open = useOpenTaskNotes()
  const onOpen = useTaskNotes('t-open')
  const onDone = useTaskNotes('t-done')
  const onList = useListNotes('s-atlas', ['t-open', 't-done'])
  const writer = useNoteWriter()
  return (
    <div>
      <div data-testid="pathname">{pathname}</div>
      <div data-testid="open-count">{onOpen.length}</div>
      <div data-testid="done-count">{onDone.length}</div>
      <div data-testid="list-ids">{onList.map((n) => n.id).join(',')}</div>
      {['t-open', 't-done', 't-archived'].map((id) => (
        <button key={id} type="button" onClick={() => open(id)}>
          open {id}
        </button>
      ))}
      <button type="button" onClick={() => open('t-open', 'n-task-2')}>
        open at second
      </button>
      <button
        type="button"
        onClick={() => {
          const d = writer.openDraft('u1', { taskId: 't-open' })
          void writer.save(d.id, { body: 'written elsewhere' })
        }}
      >
        write one
      </button>
      <button type="button" onClick={() => void writer.remove(NOTES[4])}>
        delete n-task
      </button>
    </div>
  )
}

async function mount(notes: Note[] = NOTES) {
  repoMock.notes.listAll.mockResolvedValue(notes)
  render(
    <MemoryRouter>
      <NotesProvider>
        <Probe />
      </NotesProvider>
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(screen.getByTestId('list-ids').textContent).not.toBe(''),
  )
}

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }))
const sheet = () => screen.findByRole('dialog')
const titleInput = () => screen.findByLabelText('Title')
/** The attachment chip (not the unlink button beside it). */
const CHIP = /^(?!Detach).*Ship the pricing page/
const pathname = () => screen.getByTestId('pathname').textContent

beforeEach(() => {
  for (const group of Object.values(repoMock)) {
    for (const fn of Object.values(group)) fn.mockReset()
  }
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  touchMock.value = false
  repoMock.categories.list.mockResolvedValue(CATEGORIES)
  repoMock.subcategories.list.mockResolvedValue(SUBCATEGORIES)
  repoMock.tasks.list.mockResolvedValue(TASKS)
  const rows = new Map<string, Note>([...NOTES, SECOND].map((n) => [n.id, n]))
  repoMock.notes.update.mockImplementation(
    async (id: string, changes: Partial<Note>) => {
      const next = { ...rows.get(id)!, ...changes }
      rows.set(id, next)
      return next
    },
  )
  repoMock.notes.create.mockImplementation(async (input: Partial<Note>) => {
    const created = mkNote({ ...input, id: input.id! })
    rows.set(created.id, created)
    return created
  })
  repoMock.notes.delete.mockResolvedValue(undefined)
})

describe('NotesProvider — hooks (D5)', () => {
  it('useTaskNotes and useListNotes select from one load', async () => {
    await mount([...NOTES, SECOND])
    expect(screen.getByTestId('open-count')).toHaveTextContent('2')
    expect(screen.getByTestId('done-count')).toHaveTextContent('1')
    // The list's own note AND its tasks' notes, newest first.
    expect(screen.getByTestId('list-ids')).toHaveTextContent(
      'n-done,n-task,n-task-2,n-list',
    )
    expect(repoMock.notes.listAll).toHaveBeenCalledTimes(1)
  })

  it('counts follow a writer create and delete with no refetch', async () => {
    await mount()
    expect(screen.getByTestId('open-count')).toHaveTextContent('1')

    click('write one')
    await waitFor(() =>
      expect(screen.getByTestId('open-count')).toHaveTextContent('2'),
    )
    expect(repoMock.notes.create).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't-open', body: 'written elsewhere' }),
    )

    click('delete n-task')
    await waitFor(() =>
      expect(screen.getByTestId('open-count')).toHaveTextContent('1'),
    )
    expect(repoMock.notes.delete).toHaveBeenCalledWith('n-task')
    expect(repoMock.notes.listAll).toHaveBeenCalledTimes(1)
  })
})

describe('task notes sheet (D6)', () => {
  it('0 notes: opens an unsaved draft on the task; nothing is written while empty', async () => {
    await mount()
    click('open t-archived')
    const dialog = await sheet()
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Legacy cleanup')
    expect(await titleInput()).toHaveValue('')
    const body = screen.getByLabelText('Note body')

    fireEvent.change(body, { target: { value: '   ' } })
    fireEvent.blur(body)
    await Promise.resolve()
    expect(repoMock.notes.create).not.toHaveBeenCalled()

    fireEvent.change(body, { target: { value: 'First real line' } })
    fireEvent.blur(body)
    await waitFor(() => expect(repoMock.notes.create).toHaveBeenCalledTimes(1))
    expect(repoMock.notes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-archived',
        subcategoryId: null,
        body: 'First real line',
      }),
    )
  })

  it('1 note: opens straight in that note’s editor', async () => {
    await mount()
    click('open t-open')
    expect(await titleInput()).toHaveValue('On open task')
    expect(screen.queryByTestId('task-note-row')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'All notes on this task' }),
    ).toBeNull()
  })

  it('2+ notes: a newest-first list, then the editor with a way back', async () => {
    await mount([...NOTES, SECOND])
    click('open t-open')
    const dialog = await sheet()
    const rows = await screen.findAllByTestId('task-note-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('On open task')
    // Untitled: the body's first line, then the rest as the excerpt.
    expect(rows[1]).toHaveTextContent('Second thought')
    expect(rows[1]).toHaveTextContent('with a second line')
    expect(within(dialog).getByText('2 notes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open in Notebook' }),
    ).toBeInTheDocument()

    fireEvent.click(rows[1])
    expect(await titleInput()).toHaveValue('')
    click('All notes on this task')
    expect(await screen.findAllByTestId('task-note-row')).toHaveLength(2)
  })

  it('opens at a given note', async () => {
    await mount([...NOTES, SECOND])
    click('open at second')
    await titleInput()
    expect(screen.getByText(/Second thought/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'All notes on this task' }),
    ).toBeInTheDocument()
  })

  it('a completed task’s notes are shown', async () => {
    await mount()
    click('open t-done')
    expect(await titleInput()).toHaveValue('On done task')
  })

  it('has the ⋯ menu in place of the header trash; Delete note confirms then deletes', async () => {
    await mount()
    click('open t-open')
    await titleInput()
    // No standalone trash button — Delete lives in the menu.
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Note actions' }), {
      key: 'Enter',
    })
    expect(
      await screen.findByRole('menuitem', { name: 'Open in Notebook' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'New note on this task' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete note' }))

    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Delete this note?')).toBeInTheDocument()
    expect(repoMock.notes.delete).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(repoMock.notes.delete).toHaveBeenCalledWith('n-task'),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Note deleted.')
    await waitFor(() =>
      expect(screen.getByTestId('open-count')).toHaveTextContent('0'),
    )
  })

  it('menu → Open in Notebook goes to the note and closes the sheet', async () => {
    await mount()
    click('open t-open')
    await titleInput()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Note actions' }), {
      key: 'Enter',
    })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Open in Notebook' }),
    )
    await waitFor(() => expect(pathname()).toBe('/notebook/n-task'))
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
  })

  it('menu → New note on this task opens a fresh draft, with a way back', async () => {
    await mount()
    click('open t-open')
    expect(await titleInput()).toHaveValue('On open task')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Note actions' }), {
      key: 'Enter',
    })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'New note on this task' }),
    )
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''))
    expect(repoMock.notes.create).not.toHaveBeenCalled()
    click('All notes on this task')
    await waitFor(() =>
      expect(screen.getByLabelText('Title')).toHaveValue('On open task'),
    )
  })

  it('moving the note elsewhere toasts "Note moved." and closes on the last note', async () => {
    await mount()
    click('open t-open')
    await titleInput()
    // The chip opens the picker, pre-navigated to the task's list.
    click(CHIP)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Attach to this list' }),
    )

    await waitFor(() =>
      expect(repoMock.notes.update).toHaveBeenCalledWith('n-task', {
        taskId: null,
        subcategoryId: 's-atlas',
        detachedLabel: null,
        detachedAt: null,
      }),
    )
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Note moved.'),
    )
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
    expect(screen.getByTestId('open-count')).toHaveTextContent('0')
  })

  it('moving one of several returns to what is left on the task', async () => {
    await mount([...NOTES, SECOND])
    click('open t-open')
    fireEvent.click((await screen.findAllByTestId('task-note-row'))[0])
    await titleInput()
    click(CHIP)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Attach to this list' }),
    )
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Note moved.'),
    )
    // One note left on the task: its editor, sheet still open.
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''))
    expect(screen.getByText(/Second thought/)).toBeInTheDocument()
  })

  it('unlink detaches with the freeform toast', async () => {
    await mount()
    click('open t-open')
    await titleInput()
    click('Detach from Ship the pricing page')
    await waitFor(() =>
      expect(repoMock.notes.update).toHaveBeenCalledWith('n-task', {
        taskId: null,
        subcategoryId: null,
      }),
    )
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Detached from Ship the pricing page. It is now a freeform note.',
      ),
    )
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
  })

  it('is a right sheet on pointer and a bottom sheet on touch', async () => {
    await mount()
    click('open t-open')
    expect(await sheet()).toHaveAttribute('data-side', 'right')
  })

  it('touch: bottom sheet', async () => {
    touchMock.value = true
    await mount()
    click('open t-open')
    expect(await sheet()).toHaveAttribute('data-side', 'bottom')
  })
})
