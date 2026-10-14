import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Notebook screen (chunk 58, D5–D8): the list's ordering, search, segment,
 * completed-task reveal and empty states; the unsaved-draft rule; and what
 * attach / detach / delete write through the repo.
 */

const { repoMock, toastMock } = vi.hoisted(() => ({
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
vi.mock('@/lib/useIsTouchDevice', () => ({ useIsTouchDevice: () => false }))
vi.mock('@/state/uiStore', () => ({
  useUIStore: (selector: (s: { dashboardRefreshKey: number }) => unknown) =>
    selector({ dashboardRefreshKey: 0 }),
}))

import {
  CATEGORIES,
  mkNote,
  NOTES,
  SUBCATEGORIES,
  TASKS,
} from '@/components/notebook/fixtures'
import type { Note } from '@/db/types'

import Notebook from './Notebook'

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

async function renderAt(path = '/notebook', notes: Note[] = NOTES) {
  repoMock.notes.listAll.mockResolvedValue(notes)
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="notebook/:noteId?" element={<Notebook />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
  await waitFor(() => expect(repoMock.tasks.list).toHaveBeenCalled())
  // One more turn so the loaded state has rendered.
  await screen.findByRole('heading', { name: 'Notebook' })
  await waitFor(() =>
    expect(
      notes.length === 0
        ? screen.getByText('Nothing written yet.')
        : screen.getAllByTestId('note-row')[0],
    ).toBeInTheDocument(),
  )
  return view
}

const rowTitles = () =>
  screen.getAllByTestId('note-row-title').map((el) => el.textContent)
const pathname = () => screen.getByTestId('pathname').textContent
const search = (value: string) =>
  fireEvent.change(screen.getByLabelText('Search notes'), { target: { value } })
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))

beforeEach(() => {
  for (const group of Object.values(repoMock)) {
    for (const fn of Object.values(group)) fn.mockReset()
  }
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  repoMock.categories.list.mockResolvedValue(CATEGORIES)
  repoMock.subcategories.list.mockResolvedValue(SUBCATEGORIES)
  repoMock.tasks.list.mockResolvedValue(TASKS)
  // A tiny in-memory server: updates apply to the fixture or to a created note.
  const rows = new Map<string, Note>(NOTES.map((n) => [n.id, n]))
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

describe('Notebook — list', () => {
  it('orders PINNED then RECENT, each newest-updated first', async () => {
    await renderAt()
    expect(rowTitles()).toEqual([
      'Pinned new',
      'Pinned old',
      'On open task',
      'First line here',
      'On list',
      'Was attached',
    ])
    const pinned = screen.getByText('Pinned', { selector: '.label' })
    const recent = screen.getByText('Recent', { selector: '.label' })
    const rows = screen.getAllByTestId('note-row')
    const before = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(pinned, rows[0])).toBe(true)
    expect(before(rows[1], recent)).toBe(true)
    expect(before(recent, rows[2])).toBe(true)
  })

  it('an untitled row shows the body’s first line, in italic', async () => {
    await renderAt()
    const untitled = screen.getByText('First line here')
    expect(untitled).toHaveClass('italic')
    expect(screen.getByText('Pinned new')).not.toHaveClass('italic')
    // The excerpt is the remaining lines, Markdown stripped, joined with " · ".
    expect(screen.getByText('second line · third')).toBeInTheDocument()
  })

  it('hides notes on completed tasks behind a reveal count, for the session', async () => {
    await renderAt()
    expect(screen.queryByText('On done task')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+1 on completed tasks' }))
    expect(rowTitles()).toEqual([
      'Pinned new',
      'Pinned old',
      'On done task',
      'On open task',
      'First line here',
      'On list',
      'Was attached',
    ])
    expect(screen.queryByRole('button', { name: /on completed tasks$/ })).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide completed tasks’ notes' }),
    )
    expect(screen.queryByText('On done task')).toBeNull()
  })

  it('never hides freeform or list notes, and offers no reveal without completed-task notes', async () => {
    await renderAt('/notebook', NOTES.filter((n) => n.id !== 'n-done'))
    expect(rowTitles()).toContain('On list')
    expect(rowTitles()).toContain('Pinned old')
    expect(screen.queryByRole('button', { name: /on completed tasks/ })).toBeNull()
  })

  it('searches title and body, case-insensitively, and highlights the match', async () => {
    await renderAt()

    search('ZEBRA')
    expect(rowTitles()).toEqual(['On list'])
    const bodyMark = document.querySelector('mark')!
    expect(bodyMark).toHaveTextContent('zebra')
    expect(bodyMark.closest('[data-testid="note-row-title"]')).toBeNull()

    search('pinned n')
    expect(rowTitles()).toEqual(['Pinned new'])
    const titleMark = document.querySelector('mark')!
    expect(titleMark).toHaveTextContent('Pinned n')
    expect(titleMark.closest('[data-testid="note-row-title"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(rowTitles()).toHaveLength(6)
    expect(document.querySelector('mark')).toBeNull()
  })

  it('a query is highlighted as text — markup in it is never parsed', async () => {
    const hostile = mkNote({ id: 'h', title: 'x <img src=x onerror=1> y' })
    await renderAt('/notebook', [hostile])
    search('<img')
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('mark')).toHaveTextContent('<img')
  })

  it('search finds a completed-task note only once revealed', async () => {
    await renderAt()
    search('went well')
    expect(screen.queryAllByTestId('note-row')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '+1 on completed tasks' }))
    expect(rowTitles()).toEqual(['On done task'])
  })

  it('filters with the All · Freeform · Attached segment, composed with search', async () => {
    await renderAt()
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    tab('Freeform')
    expect(rowTitles()).toEqual([
      'Pinned new',
      'Pinned old',
      'First line here',
      'Was attached',
    ])

    tab('Attached')
    expect(rowTitles()).toEqual(['On open task', 'On list'])
    expect(
      screen.getByRole('button', { name: '+1 on completed tasks' }),
    ).toBeInTheDocument()

    search('zebra')
    expect(rowTitles()).toEqual(['On list'])
    tab('Freeform')
    expect(screen.queryAllByTestId('note-row')).toHaveLength(0)
  })

  it('renders the attachment chips: list, task, and the hollow detached chip', async () => {
    await renderAt()
    const chipIn = (title: string) =>
      within(screen.getByText(title).closest('button')!).queryByTestId(
        'attachment-chip',
      )

    expect(chipIn('On list')).toHaveTextContent('Atlas launch')
    expect(chipIn('On open task')).toHaveTextContent('Ship the pricing page')

    const detached = chipIn('Was attached')!
    expect(detached).toHaveAttribute('data-detached', 'true')
    expect(detached).toHaveClass('border-dashed')
    expect(within(detached).getByText('Q3 planning')).toHaveClass('line-through')

    expect(chipIn('Pinned new')).toBeNull()
  })

  it('an archived subcategory still renders as a normal chip', async () => {
    await renderAt('/notebook', [
      mkNote({ id: 'a', title: 'On archived', subcategoryId: 's-archived' }),
    ])
    const chip = screen.getByTestId('attachment-chip')
    expect(chip).toHaveTextContent('Old initiative')
    expect(chip).not.toHaveAttribute('data-detached')
  })
})

describe('Notebook — empty states', () => {
  it('empty notebook: the card, one New note (the header), no search or segment', async () => {
    await renderAt('/notebook', [])
    expect(screen.getByText('Nothing written yet.')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Notes can stand alone or sit beside a task or list. Start one with New note, or from any task's menu.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Search notes')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    // Chunk 86 (D6): the card has no button of its own.
    expect(screen.getAllByRole('button', { name: 'New note' })).toHaveLength(1)
  })

  it('empty search', async () => {
    await renderAt()
    search('xyz')
    expect(screen.getByText('No notes match “xyz”.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Search looks at titles and bodies. Try another word, or clear the filter.',
      ),
    ).toBeInTheDocument()
  })

  it('empty Attached filter', async () => {
    await renderAt('/notebook', [mkNote({ id: 'only-freeform' })])
    tab('Attached')
    expect(screen.getByText('No notes here.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Attach a note to a task or list from its header, or from a task’s menu.',
      ),
    ).toBeInTheDocument()
  })

  it('empty Freeform filter', async () => {
    await renderAt('/notebook', [mkNote({ id: 'only-attached', taskId: 't-open' })])
    tab('Freeform')
    expect(screen.getByText('No notes here.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Every note is attached to a task or list. Start a freeform one with New note.',
      ),
    ).toBeInTheDocument()
  })
})

describe('Notebook — routes', () => {
  it('selecting a row opens it at /notebook/:noteId and marks the row', async () => {
    await renderAt()
    fireEvent.click(screen.getByText('On list'))
    expect(pathname()).toBe('/notebook/n-list')
    expect(screen.getByLabelText('Title')).toHaveValue('On list')
    expect(screen.getByText('On list').closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('an unknown id falls back to /notebook', async () => {
    await renderAt('/notebook/does-not-exist')
    await waitFor(() => expect(pathname()).toBe('/notebook'))
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('Back to notes returns to the list', async () => {
    await renderAt('/notebook/n-list')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to notes' }))
    expect(pathname()).toBe('/notebook')
  })
})

describe('Notebook — drafts', () => {
  it('New note opens an unsaved draft: nothing is written while it is empty', async () => {
    await renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))

    expect(pathname()).toMatch(/^\/notebook\/[0-9a-f-]{36}$/)
    const body = await screen.findByLabelText('Note body')
    expect(repoMock.notes.create).not.toHaveBeenCalled()
    // Not listed until it exists.
    expect(rowTitles()).toHaveLength(6)

    // Whitespace is still empty.
    fireEvent.change(body, { target: { value: '   ' } })
    fireEvent.blur(body)
    await waitFor(() => expect(screen.queryByLabelText('Title')).not.toBeNull())
    expect(repoMock.notes.create).not.toHaveBeenCalled()

    // Leaving discards it.
    fireEvent.click(screen.getByRole('button', { name: 'Back to notes' }))
    expect(pathname()).toBe('/notebook')
    expect(repoMock.notes.create).not.toHaveBeenCalled()
    expect(repoMock.notes.update).not.toHaveBeenCalled()
    expect(rowTitles()).toHaveLength(6)
  })

  it('the first non-empty title or body creates the note, once, with a client id', async () => {
    await renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    const id = pathname()!.replace('/notebook/', '')
    const body = await screen.findByLabelText('Note body')

    fireEvent.change(body, { target: { value: 'First thought' } })
    fireEvent.blur(body)

    await waitFor(() => expect(repoMock.notes.create).toHaveBeenCalledTimes(1))
    expect(repoMock.notes.create).toHaveBeenCalledWith({
      userId: 'u1',
      id,
      title: '',
      body: 'First thought',
      pinned: false,
      taskId: null,
      subcategoryId: null,
    })
    await waitFor(() => expect(rowTitles()).toContain('First thought'))
    expect(pathname()).toBe(`/notebook/${id}`)

    // Further edits update the same row rather than creating another.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Named' } })
    fireEvent.blur(screen.getByLabelText('Title'))
    await waitFor(() =>
      expect(repoMock.notes.update).toHaveBeenCalledWith(id, { title: 'Named' }),
    )
    expect(repoMock.notes.create).toHaveBeenCalledTimes(1)
  })

  it('emptying an existing note updates it and does not delete it', async () => {
    await renderAt('/notebook/n-pin-new')
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: '' } })
    fireEvent.blur(title)
    fireEvent.click(screen.getByRole('button', { name: 'Edit note body' }))
    const body = screen.getByLabelText('Note body')
    fireEvent.change(body, { target: { value: '' } })
    fireEvent.blur(body)

    await waitFor(() => expect(repoMock.notes.update).toHaveBeenCalledTimes(2))
    expect(repoMock.notes.update).toHaveBeenCalledWith('n-pin-new', { title: '' })
    expect(repoMock.notes.update).toHaveBeenCalledWith('n-pin-new', { body: '' })
    expect(repoMock.notes.delete).not.toHaveBeenCalled()
    expect(pathname()).toBe('/notebook/n-pin-new')
  })

  it('a failed write toasts the normalized error and keeps the editor open', async () => {
    repoMock.notes.update.mockRejectedValueOnce(
      Object.assign(new Error('permission denied for table notes'), { status: 403 }),
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderAt('/notebook/n-list')
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Renamed' } })
    fireEvent.blur(title)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Could not save — retry'),
    )
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed')
    error.mockRestore()
  })
})

describe('Notebook — attach, detach, pin, delete', () => {
  async function openPicker(noteId: string) {
    await renderAt(`/notebook/${noteId}`)
    await screen.findByLabelText('Title')
    const trigger =
      screen.queryByRole('button', { name: 'Attach' }) ??
      within(screen.getByRole('region', { name: 'Note' })).getByTestId(
        'attachment-chip',
      )
    fireEvent.click(trigger)
    return screen.findByRole('dialog')
  }

  it('attaching to a task sets that one link and clears the detach memo', async () => {
    const dialog = await openPicker('n-detached')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Work' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Atlas launch' }))
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Ship the pricing page/ }),
    )

    await waitFor(() => expect(repoMock.notes.update).toHaveBeenCalledTimes(1))
    expect(repoMock.notes.update).toHaveBeenCalledWith('n-detached', {
      taskId: 't-open',
      subcategoryId: null,
      detachedLabel: null,
      detachedAt: null,
    })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Attached to Ship the pricing page.',
      ),
    )
    // The strip is gone and the header shows the new chip.
    await waitFor(() => expect(screen.queryByTestId('detached-strip')).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('attaching to a list sets subcategoryId and nulls taskId', async () => {
    const dialog = await openPicker('n-task')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Attach to this list' }),
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
      expect(toastMock.success).toHaveBeenCalledWith('Attached to Atlas launch.'),
    )
  })

  it('Detach in the picker nulls both links', async () => {
    const dialog = await openPicker('n-task')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Detach' }))
    await waitFor(() =>
      expect(repoMock.notes.update).toHaveBeenCalledWith('n-task', {
        taskId: null,
        subcategoryId: null,
      }),
    )
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Detached from Ship the pricing page.',
      ),
    )
  })

  it('the header unlink detaches immediately, with a toast and no confirm', async () => {
    await renderAt('/notebook/n-list')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Detach from Atlas launch' }),
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() =>
      expect(repoMock.notes.update).toHaveBeenCalledWith('n-list', {
        taskId: null,
        subcategoryId: null,
      }),
    )
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Detached from Atlas launch.'),
    )
  })

  it('pin toggles through one update', async () => {
    await renderAt('/notebook/n-list')
    fireEvent.click(await screen.findByRole('button', { name: 'Pin' }))
    await waitFor(() =>
      expect(repoMock.notes.update).toHaveBeenCalledWith('n-list', { pinned: true }),
    )
    await screen.findByRole('button', { name: 'Unpin' })
    expect(rowTitles()[0]).toBe('Pinned new')
    expect(rowTitles().slice(0, 3)).toContain('On list')
  })

  it('delete confirms, hard-deletes, toasts and returns to the list', async () => {
    await renderAt('/notebook/n-list')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete note' }))
    expect(repoMock.notes.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(repoMock.notes.delete).toHaveBeenCalledWith('n-list'),
    )
    await waitFor(() => expect(pathname()).toBe('/notebook'))
    expect(toastMock.success).toHaveBeenCalledWith('Note deleted.')
    expect(rowTitles()).not.toContain('On list')
  })

  it('deleting an unsaved draft discards it without a repo call', async () => {
    await renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(pathname()).toBe('/notebook'))
    expect(repoMock.notes.delete).not.toHaveBeenCalled()
    expect(repoMock.notes.create).not.toHaveBeenCalled()
  })
})
