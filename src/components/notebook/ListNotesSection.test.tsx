import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

import type { Note, Task } from '@/db/types'

/*
 * Chunk 81 (D2): the sheet is mounted by NotesProvider, not opened from a
 * Radix trigger, so a task-note row hands `openTaskNotes` a refocus target —
 * itself — or focus lands on `body` when the sheet closes.
 */

const { notes, openTaskNotesMock } = vi.hoisted(() => ({
  notes: { list: [] as Note[] },
  openTaskNotesMock: vi.fn(),
}))

vi.mock('./notesContext', () => ({
  useListNotes: () => notes.list,
  useOpenTaskNotes: () => openTaskNotesMock,
}))
vi.mock('@/lib/useIsTouchDevice', () => ({ useIsTouchDevice: () => false }))

import ListNotesSection from './ListNotesSection'

function mkNote(id: string, over: Partial<Note>): Note {
  return {
    id,
    userId: 'u1',
    title: id,
    body: '',
    pinned: false,
    taskId: null,
    subcategoryId: null,
    detachedLabel: null,
    detachedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

const task: Task = {
  id: 't1',
  userId: 'u1',
  subcategoryId: 's1',
  title: 'Task one',
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function renderSection() {
  return render(
    <MemoryRouter initialEntries={['/lists/s1']}>
      <ListNotesSection subcategoryId="s1" tasks={[task]} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

const row = (title: string) =>
  screen.getByText(title).closest('button') as HTMLButtonElement

beforeEach(() => {
  openTaskNotesMock.mockReset()
  notes.list = [
    mkNote('n-task', { title: 'Task note', taskId: 't1' }),
    mkNote('n-list', { title: 'List note', subcategoryId: 's1' }),
  ]
})

describe('ListNotesSection — focus returns to the row (chunk 81)', () => {
  it('a task-note row passes a refocus target that focuses the row', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(row('Task note'))

    expect(openTaskNotesMock).toHaveBeenCalledTimes(1)
    const [taskId, noteId, refocus] = openTaskNotesMock.mock.calls[0]
    expect(taskId).toBe('t1')
    expect(noteId).toBe('n-task')
    expect(refocus).toBeTypeOf('function')

    ;(document.activeElement as HTMLElement | null)?.blur()
    const preventDefault = vi.fn()
    refocus({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(row('Task note'))
  })

  it('after the row unmounts, the refocus target does nothing', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSection()
    await user.click(row('Task note'))
    const refocus = openTaskNotesMock.mock.calls[0]?.[2] as
      | ((e: { preventDefault: () => void }) => void)
      | undefined
    unmount()

    const preventDefault = vi.fn()
    expect(() => refocus?.({ preventDefault })).not.toThrow()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('a list-note row navigates to the Notebook and does not open the sheet', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(row('List note'))

    expect(screen.getByTestId('pathname')).toHaveTextContent(
      '/notebook/n-list',
    )
    expect(openTaskNotesMock).not.toHaveBeenCalled()
  })
})
