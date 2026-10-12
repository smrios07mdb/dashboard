import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { countOutboxFor } = vi.hoisted(() => ({
  countOutboxFor: vi.fn<(table: string, id: string) => Promise<number>>(() =>
    Promise.resolve(0),
  ),
}))
vi.mock('@/db/outbox', () => ({ countOutboxFor }))

import { useSyncStore } from '@/db/syncStore'
import type { Note } from '@/db/types'
import { resolveAttachment } from '@/lib/notes'

import { CTX, mkNote } from './fixtures'
import NoteEditor from './NoteEditor'

/*
 * Editor (chunk 58, D7): the 600 ms debounce, the three flush points, the
 * source-on-focus / rendered-on-blur body, the detached strip and the save
 * state line.
 */

const onSave = vi.fn<(changes: { title?: string; body?: string }) => Promise<void>>()

function mount(note: Note, over: { persisted?: boolean; touch?: boolean } = {}) {
  const props = {
    persisted: over.persisted ?? true,
    attachment: resolveAttachment(note, CTX),
    touch: over.touch ?? false,
    onSave,
    onTogglePin: vi.fn(),
    onAttach: vi.fn(),
    onDetach: vi.fn(),
    onDelete: vi.fn(),
    onBack: vi.fn(),
  }
  const view = render(<NoteEditor note={note} {...props} />)
  return {
    ...view,
    props,
    rerenderWith: (next: Note) =>
      view.rerender(
        <NoteEditor
          note={next}
          {...props}
          attachment={resolveAttachment(next, CTX)}
        />,
      ),
  }
}

/** Let resolved promises (the save, the outbox count) settle. */
const settle = () => act(async () => {})

const title = () => screen.getByLabelText('Title') as HTMLInputElement
function openBody() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit note body' }))
  return screen.getByLabelText('Note body') as HTMLTextAreaElement
}

beforeEach(() => {
  vi.useFakeTimers()
  onSave.mockReset()
  onSave.mockResolvedValue(undefined)
  countOutboxFor.mockReset()
  countOutboxFor.mockResolvedValue(0)
  useSyncStore.setState({ state: 'synced', lastSyncAt: null })
})
afterEach(() => vi.useRealTimers())

const NOTE = mkNote({ id: 'n1', title: 'Kickoff', body: '# Agenda\n- one' })

describe('NoteEditor — autosave', () => {
  it('writes once per burst, 600 ms after the last keystroke', async () => {
    mount(NOTE)
    const body = openBody()

    fireEvent.change(body, { target: { value: 'a' } })
    act(() => void vi.advanceTimersByTime(400))
    fireEvent.change(body, { target: { value: 'ab' } })
    act(() => void vi.advanceTimersByTime(400))
    fireEvent.change(body, { target: { value: 'abc' } })
    act(() => void vi.advanceTimersByTime(599))
    expect(onSave).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ body: 'abc' })

    // Nothing further without another edit.
    act(() => void vi.advanceTimersByTime(5000))
    await settle()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('one write carries a title edit and a body edit made in the same burst', () => {
    mount(NOTE)
    fireEvent.change(title(), { target: { value: 'Kickoff v2' } })
    fireEvent.change(openBody(), { target: { value: 'new body' } })
    act(() => void vi.advanceTimersByTime(600))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ title: 'Kickoff v2', body: 'new body' })
  })

  it('flushes at once on blur — title and body', () => {
    mount(NOTE)
    fireEvent.change(title(), { target: { value: 'Renamed' } })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.blur(title())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenLastCalledWith({ title: 'Renamed' })

    const body = openBody()
    fireEvent.change(body, { target: { value: 'edited' } })
    fireEvent.blur(body)
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith({ body: 'edited' })

    // The debounce that was running does not fire a second write.
    act(() => void vi.advanceTimersByTime(1000))
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('flushes on unmount (route change / another note selected)', () => {
    const { unmount } = mount(NOTE)
    fireEvent.change(title(), { target: { value: 'Half-typed' } })
    expect(onSave).not.toHaveBeenCalled()
    unmount()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ title: 'Half-typed' })
  })

  it('flushes when the tab goes hidden', () => {
    mount(NOTE)
    fireEvent.change(title(), { target: { value: 'Backgrounded' } })
    const state = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    state.mockRestore()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ title: 'Backgrounded' })
  })

  it('a blur with nothing changed writes nothing; there is no Save button', () => {
    const { unmount } = mount(NOTE)
    fireEvent.blur(title())
    unmount()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('keeps the typed text and resends it after a failed write', async () => {
    onSave.mockRejectedValueOnce(new Error('nope'))
    mount(NOTE)
    fireEvent.change(title(), { target: { value: 'Unsaved' } })
    fireEvent.blur(title())
    await settle()
    expect(title().value).toBe('Unsaved')

    fireEvent.blur(title())
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith({ title: 'Unsaved' })
  })

  it('a refetched note does not clobber unsaved typing', () => {
    const { rerenderWith } = mount(NOTE)
    fireEvent.change(title(), { target: { value: 'Mine' } })
    rerenderWith({ ...NOTE, title: 'From another device' })
    expect(title().value).toBe('Mine')
  })
})

describe('NoteEditor — body', () => {
  it('shows rendered Markdown until the body is tapped, then the source', () => {
    mount(NOTE)
    expect(screen.queryByLabelText('Note body')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument()

    const body = openBody()
    expect(body.value).toBe('# Agenda\n- one')
    expect(body).toHaveFocus()
    expect(body.selectionStart).toBe(body.value.length)
    expect(
      screen.getByText(/# for a heading, - for a list/),
    ).toBeInTheDocument()

    fireEvent.blur(body)
    expect(screen.queryByLabelText('Note body')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument()
  })

  it('a blank note opens in the textarea with the hint as its placeholder', () => {
    mount(mkNote({ id: 'blank', title: '' }), { persisted: false })
    expect(screen.getByLabelText('Note body')).toHaveAttribute(
      'placeholder',
      'Write. # for a heading, - for a list, paste a link to link it.',
    )
    expect(title()).toHaveAttribute('placeholder', 'Untitled')
  })

  it('uses 16px body text on touch', () => {
    mount(NOTE, { touch: true })
    expect(openBody()).toHaveClass('text-[16px]')
  })
})

describe('NoteEditor — detached strip', () => {
  const strip = () => screen.queryByTestId('detached-strip')

  it('renders when both links are null and detachedLabel is set', () => {
    mount(
      mkNote({
        id: 'd',
        detachedLabel: 'Q3 planning',
        detachedAt: '2026-10-09T12:00:00.000Z',
      }),
    )
    expect(strip()).toHaveTextContent(
      'Detached from Q3 planning, which was deleted on Oct 9. The note was kept.',
    )
  })

  it.each([
    ['a freeform note with no memo', mkNote({ id: 'f' })],
    ['a note on a task', mkNote({ id: 't', taskId: 't-open' })],
    ['a note on a list', mkNote({ id: 's', subcategoryId: 's-atlas' })],
    [
      'a re-attached note that still carries a memo',
      mkNote({ id: 'r', taskId: 't-open', detachedLabel: 'Q3 planning' }),
    ],
  ])('does not render for %s', (_name, note) => {
    mount(note)
    expect(strip()).toBeNull()
  })
})

describe('NoteEditor — header', () => {
  it('attached: the chip opens the picker and the unlink control detaches', () => {
    const { props } = mount(mkNote({ id: 't', taskId: 't-open' }))
    fireEvent.click(screen.getByTestId('attachment-chip'))
    expect(props.onAttach).toHaveBeenCalledTimes(1)
    fireEvent.click(
      screen.getByRole('button', { name: 'Detach from Ship the pricing page' }),
    )
    expect(props.onDetach).toHaveBeenCalledTimes(1)
  })

  it('freeform: an Attach button, and no unlink control', () => {
    const { props } = mount(NOTE)
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(props.onAttach).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /^Detach from/ })).toBeNull()
  })

  it('pin reflects and toggles', () => {
    const { props } = mount(mkNote({ id: 'p', pinned: true }))
    const pin = screen.getByRole('button', { name: 'Unpin' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pin)
    expect(props.onTogglePin).toHaveBeenCalledTimes(1)
  })

  it('delete confirms first, naming the unaffected task', () => {
    const { props } = mount(mkNote({ id: 't', taskId: 't-open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete this note?')
    expect(dialog).toHaveTextContent(
      'This cannot be undone. The task Ship the pricing page is not affected.',
    )
    expect(props.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(props.onDelete).toHaveBeenCalledTimes(1)
  })

  it('delete copy for a list note and for a freeform note', () => {
    const view = mount(mkNote({ id: 's', subcategoryId: 's-atlas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'This cannot be undone. The list Atlas launch is not affected.',
    )
    view.unmount()

    mount(NOTE)
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('This cannot be undone.')
    expect(dialog).not.toHaveTextContent('is not affected')
  })
})

describe('NoteEditor — save state', () => {
  const state = () => screen.getByTestId('note-save-state')

  it('Saved when online with nothing pending or queued', async () => {
    mount(NOTE)
    await settle()
    expect(state()).toHaveTextContent(/^Saved$/)
  })

  it('Syncing (pulsing dot) while an edit is pending, then Saved', async () => {
    mount(NOTE)
    fireEvent.change(title(), { target: { value: 'x' } })
    expect(state()).toHaveTextContent(/^Syncing$/)
    expect(
      (state().firstElementChild as HTMLElement).style.animation,
    ).toContain('sync-pulse')

    act(() => void vi.advanceTimersByTime(600))
    await settle()
    expect(state()).toHaveTextContent(/^Saved$/)
  })

  it('Offline · saved on this device when offline with nothing queued', async () => {
    useSyncStore.setState({ state: 'offline' })
    mount(NOTE)
    await settle()
    expect(state()).toHaveTextContent('Offline · saved on this device')
  })

  it('Offline · N change(s) queued from the outbox count for this note', async () => {
    useSyncStore.setState({ state: 'offline' })
    countOutboxFor.mockResolvedValue(1)
    const view = mount(NOTE)
    await settle()
    expect(countOutboxFor).toHaveBeenCalledWith('notes', 'n1')
    expect(state()).toHaveTextContent('Offline · 1 change queued')
    view.unmount()

    countOutboxFor.mockResolvedValue(3)
    mount(NOTE)
    await settle()
    expect(state()).toHaveTextContent('Offline · 3 changes queued')
  })

  it('an untouched draft shows no save state', () => {
    mount(mkNote({ id: 'blank', title: '' }), { persisted: false })
    expect(screen.queryByTestId('note-save-state')).toBeNull()
  })
})
