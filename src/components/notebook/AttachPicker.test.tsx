import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Note } from '@/db/types'

import AttachPicker, { type AttachTarget } from './AttachPicker'
import { CTX, mkNote, NOTES } from './fixtures'

/*
 * Attach picker (chunk 58, D8): the three steps, what is and is not offered,
 * and what a pick reports. What the screen then writes is covered in
 * Notebook.test.tsx.
 */

const onPick = vi.fn<(target: AttachTarget | null) => void>()

/** Mount closed, then open — the picker resets its steps on open. */
function openFor(note: Note, notes: Note[] = NOTES) {
  const props = { onOpenChange: vi.fn(), note, notes, ctx: CTX, onPick }
  const view = render(<AttachPicker open={false} {...props} />)
  view.rerender(<AttachPicker open {...props} />)
  return screen.getByRole('dialog')
}

const row = (name: string | RegExp) => screen.getByRole('button', { name })

beforeEach(() => onPick.mockReset())

const FREEFORM = mkNote({ id: 'n-free' })

describe('AttachPicker', () => {
  it('step 1 lists Work and Personal; a freeform note has no Detach footer', () => {
    const dialog = openFor(FREEFORM)
    expect(within(dialog).getByText('Attach to')).toBeInTheDocument()
    expect(row('Work')).toBeInTheDocument()
    expect(row('Personal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detach' })).toBeNull()
  })

  it('step 2 lists non-archived subcategories only', () => {
    openFor(FREEFORM)
    fireEvent.click(row('Work'))
    expect(row('Atlas launch')).toBeInTheDocument()
    expect(screen.queryByText('Old initiative')).toBeNull()
    expect(screen.queryByText('Home')).toBeNull()
  })

  it('step 3 offers the list, then its tasks — completed ones struck, muted and pickable', () => {
    openFor(FREEFORM)
    fireEvent.click(row('Work'))
    fireEvent.click(row('Atlas launch'))

    expect(row('Attach to this list')).toBeInTheDocument()
    expect(screen.getByText('Or a task in Atlas launch')).toBeInTheDocument()

    const done = row(/Draft the announcement/)
    expect(done).toHaveClass('text-ink-3')
    expect(screen.getByText('Draft the announcement')).toHaveClass('line-through')
    expect(done).toBeEnabled()
    fireEvent.click(done)
    expect(onPick).toHaveBeenCalledWith({
      kind: 'task',
      id: 't-done',
      name: 'Draft the announcement',
    })
  })

  it('lists open tasks before completed ones', () => {
    const dialog = openFor(FREEFORM)
    fireEvent.click(row('Work'))
    fireEvent.click(row('Atlas launch'))
    const labels = within(dialog)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(labels.indexOf('Ship the pricing page1 note')).toBeGreaterThan(-1)
    expect(labels.findIndex((l) => l?.startsWith('Ship'))).toBeLessThan(
      labels.findIndex((l) => l?.startsWith('Draft')),
    )
  })

  it('shows the N NOTES micro-label on tasks that already hold notes', () => {
    // NOTES holds one note on t-open and one on t-done.
    openFor(FREEFORM)
    fireEvent.click(row('Work'))
    fireEvent.click(row('Atlas launch'))
    expect(
      within(row(/Ship the pricing page/)).getByText('1 note'),
    ).toBeInTheDocument()
  })

  it('pluralizes the micro-label', () => {
    openFor(FREEFORM, [...NOTES, mkNote({ id: 'extra', taskId: 't-open' })])
    fireEvent.click(row('Work'))
    fireEvent.click(row('Atlas launch'))
    expect(
      within(row(/Ship the pricing page/)).getByText('2 notes'),
    ).toBeInTheDocument()
  })

  it('picking the list reports a subcategory target', () => {
    openFor(FREEFORM)
    fireEvent.click(row('Work'))
    fireEvent.click(row('Atlas launch'))
    fireEvent.click(row('Attach to this list'))
    expect(onPick).toHaveBeenCalledWith({
      kind: 'subcategory',
      id: 's-atlas',
      name: 'Atlas launch',
    })
  })

  it('opens pre-navigated to the current attachment, marks it, and offers Detach', () => {
    const attached = NOTES.find((n) => n.id === 'n-task')!
    const dialog = openFor(attached)
    // Straight at step 3 of Work › Atlas launch.
    expect(row('Attach to this list')).toBeInTheDocument()
    const current = row(/Ship the pricing page/)
    expect(within(current).getByLabelText('Current attachment')).toBeInTheDocument()
    // Its own note is not counted against the task.
    expect(within(current).queryByText(/note/)).toBeNull()

    expect(
      within(dialog).getByText('Detaching keeps the note as freeform.'),
    ).toBeInTheDocument()
    fireEvent.click(row('Detach'))
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it('the breadcrumb steps back', () => {
    openFor(NOTES.find((n) => n.id === 'n-list')!)
    expect(row(/^Attached to this list/)).toBeInTheDocument()

    fireEvent.click(row('Work'))
    // Step 2 marks the list the note is on.
    expect(
      within(row(/^Atlas launch/)).getByLabelText('Current attachment'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Or a task in/)).toBeNull()

    fireEvent.click(row('Attach to'))
    expect(row('Personal')).toBeInTheDocument()
  })

  it('a note on an archived list opens at step 1, still with Detach', () => {
    openFor(mkNote({ id: 'n-arch', subcategoryId: 's-archived' }))
    expect(row('Work')).toBeInTheDocument()
    expect(row('Personal')).toBeInTheDocument()
    expect(row('Detach')).toBeInTheDocument()
  })
})
