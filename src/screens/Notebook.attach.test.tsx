import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `/notebook?attach=subcategory:<id>` (chunk 59, D6) — the drill-down's
 * "New note here". The Notebook reads the param once, opens an unsaved draft
 * already attached to that list, and replaces the URL with the draft's own.
 * Kept apart from Notebook.test.tsx, which chunk 59 must leave untouched.
 */

const { repoMock } = vi.hoisted(() => ({
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
}))

vi.mock('@/db/repo', () => ({ repo: repoMock }))
vi.mock('@/db/outbox', () => ({ countOutboxFor: () => Promise.resolve(0) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
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

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={['/', path]} initialIndex={1}>
      <Routes>
        <Route path="notebook/:noteId?" element={<Notebook />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const where = () => screen.getByTestId('where').textContent ?? ''

beforeEach(() => {
  for (const group of Object.values(repoMock)) {
    for (const fn of Object.values(group)) fn.mockReset()
  }
  repoMock.notes.listAll.mockResolvedValue(NOTES)
  repoMock.categories.list.mockResolvedValue(CATEGORIES)
  repoMock.subcategories.list.mockResolvedValue(SUBCATEGORIES)
  repoMock.tasks.list.mockResolvedValue(TASKS)
  repoMock.notes.create.mockImplementation(async (input: Partial<Note>) =>
    mkNote({ ...input, id: input.id! }),
  )
})

describe('Notebook — ?attach=subcategory:<id>', () => {
  it('opens an unsaved draft attached to the list and replaces the URL', async () => {
    renderAt('/notebook?attach=subcategory:s-atlas')

    await waitFor(() => expect(where()).toMatch(/^\/notebook\/[0-9a-f-]{36}$/))
    // The draft is open in the editor, already carrying the list's chip.
    expect(await screen.findByLabelText('Title')).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Detach from Atlas launch' }),
    ).toBeInTheDocument()
    // Nothing is written until the draft is non-empty.
    expect(repoMock.notes.create).not.toHaveBeenCalled()

    const body = screen.getByLabelText('Note body')
    fireEvent.change(body, { target: { value: 'Kickoff agenda' } })
    fireEvent.blur(body)
    await waitFor(() => expect(repoMock.notes.create).toHaveBeenCalledTimes(1))
    expect(repoMock.notes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subcategoryId: 's-atlas',
        taskId: null,
        body: 'Kickoff agenda',
      }),
    )
    expect(where()).toBe(`/notebook/${repoMock.notes.create.mock.calls[0][0].id}`)
  })

  it.each([
    ['an archived list', 'subcategory:s-archived'],
    ['an unknown id', 'subcategory:nope'],
    ['a malformed value', 'task:t-open'],
  ])('ignores %s', async (_label, value) => {
    renderAt(`/notebook?attach=${value}`)
    await screen.findAllByTestId('note-row')
    await waitFor(() => expect(where()).toBe('/notebook'))
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(repoMock.notes.create).not.toHaveBeenCalled()
  })
})
