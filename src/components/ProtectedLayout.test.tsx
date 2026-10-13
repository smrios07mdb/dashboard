import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 73 (UX audit #7): the capture entry points ProtectedLayout owns —
 * the header button, the floating + and the shortcut — each opening the real
 * capture dialog. The shell's own collaborators are stubbed out.
 */

const { repo } = vi.hoisted(() => ({
  repo: {
    categories: { list: vi.fn() },
    subcategories: { list: vi.fn() },
    tasks: { create: vi.fn(), listIncomplete: vi.fn() },
  },
}))

vi.mock('@/db/repo', () => ({ repo }))
vi.mock('@/lib/auth', () => ({
  useSession: () => ({ session: {}, user: { id: 'user-1' }, loading: false }),
}))
vi.mock('@/lib/userTimezone', () => ({
  browserTimezone: () => 'America/New_York',
  loadUserTimezone: async () => 'America/New_York',
}))
vi.mock('@/lib/taskUndo', () => ({
  flushPendingDeletes: vi.fn(),
  resumePendingDeletes: vi.fn(),
}))
vi.mock('./Protected', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./notebook/NotesProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./AccountMenu', () => ({ default: () => null }))
vi.mock('./InstallHint', () => ({ default: () => null }))
vi.mock('./SyncIndicator', () => ({ default: () => null }))

import { useUIStore } from '@/state/uiStore'

import ProtectedLayout from './ProtectedLayout'

// Radix Dialog needs these jsdom shims.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedLayout />}>
          <Route path="*" element={<div>screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

// jsdom applies no breakpoints, so both buttons are in the tree at once.
const newTaskButtons = () => screen.getAllByRole('button', { name: 'New task' })
const headerButton = () => newTaskButtons().find((b) => b.closest('header'))!
const floatingButton = () => screen.queryByTestId('capture-fab')
const captureDialog = () => screen.findByRole('dialog', { name: 'New task' })

describe('ProtectedLayout — capture entry points (chunk 73)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ capture: null })
    repo.categories.list.mockResolvedValue([])
    repo.subcategories.list.mockResolvedValue([])
    repo.tasks.listIncomplete.mockResolvedValue([])
  })

  it('renders a header New task button (>=sm) and a floating one (phones)', () => {
    renderAt('/')
    expect(newTaskButtons()).toHaveLength(2)
    expect(headerButton()).toHaveClass('hidden', 'sm:inline-flex')
    expect(headerButton()).toHaveTextContent('New task')
    expect(headerButton().querySelector('kbd')).toHaveTextContent('N')
    expect(floatingButton()).toHaveClass('sm:hidden', 'fixed')
    expect(floatingButton()).toHaveAccessibleName('New task')
  })

  it('the header button opens the capture dialog', async () => {
    renderAt('/')
    fireEvent.click(headerButton())
    expect(await captureDialog()).toBeInTheDocument()
    expect(screen.getByLabelText('Task')).toBeInTheDocument()
  })

  it('the floating button opens the capture dialog and steps aside while it is open', async () => {
    renderAt('/')
    fireEvent.click(floatingButton()!)
    expect(await captureDialog()).toBeInTheDocument()
    expect(floatingButton()).not.toBeInTheDocument()

    useUIStore.getState().closeCapture()
    await waitFor(() => expect(floatingButton()).toBeInTheDocument())
  })

  it('n opens the capture dialog and / the search dialog', async () => {
    renderAt('/')
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(await captureDialog()).toBeInTheDocument()

    useUIStore.getState().closeCapture()
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    fireEvent.keyDown(document.body, { key: '/' })
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument()
  })

  it('on a Notebook editor path the floating button is absent', () => {
    renderAt('/notebook/abc123')
    expect(floatingButton()).not.toBeInTheDocument()
    // The header button stays: it is hidden on phones by CSS, not by route.
    expect(newTaskButtons()).toHaveLength(1)
  })

  it('the Notebook list keeps the floating button', () => {
    renderAt('/notebook')
    expect(floatingButton()).toBeInTheDocument()
  })
})
