import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import DeleteSubcategoryDialog, {
  type DeleteSubcategoryDialogProps,
} from './DeleteSubcategoryDialog'
import type { Category, Subcategory } from '@/db/types'

/*
 * Deleting a list asks what happens to its open tasks (chunk 87, UX audit #4):
 * Move (any category) / Mark them done / Delete them. A list with no open
 * tasks gets one plain confirm. The dialog had no test before this.
 */

const cat = (id: string, name: 'Work' | 'Personal'): Category => ({
  id,
  userId: 'u1',
  name,
})

const sub = (
  id: string,
  categoryId: string,
  sortOrder = 0,
): Subcategory => ({
  id,
  userId: 'u1',
  categoryId,
  name: id,
  sortOrder,
  archivedAt: null,
})

// Categories carry no sort order; the repo returns them by name, so Personal
// comes first here and "own category first" is not just the array order.
const CATEGORIES = [cat('c-personal', 'Personal'), cat('c-work', 'Work')]
const SELF = sub('Inbox', 'c-work')

function setup(props: Partial<DeleteSubcategoryDialogProps> = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  const all: DeleteSubcategoryDialogProps = {
    open: true,
    onOpenChange,
    subcategory: SELF,
    openCount: 0,
    doneCount: 0,
    targets: [],
    categories: CATEGORIES,
    onConfirm,
    ...props,
  }
  const utils = render(<DeleteSubcategoryDialog {...all} />)
  return { ...utils, all, onConfirm, onOpenChange }
}

const radio = (name: string) => screen.getByRole('radio', { name })
const select = () => screen.getByRole('combobox', { name: 'Target list' })

describe('DeleteSubcategoryDialog', () => {
  it('0 open / 0 done: a plain confirm that sends kind none', async () => {
    const { onConfirm } = setup()
    expect(screen.getByText('Delete “Inbox”?')).toBeInTheDocument()
    expect(
      screen.getByText('This list has no open tasks. This cannot be undone.'),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'none' })
  })

  it('0 open / 4 done: says the completions stay, no radios', () => {
    setup({ doneCount: 4 })
    expect(
      screen.getByText(
        'This list has no open tasks. Its 4 completed tasks stay in your history. This cannot be undone.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('2 open with a same-category target: Move is the default, own category first', async () => {
    const { onConfirm } = setup({
      openCount: 2,
      doneCount: 1,
      targets: [sub('Home', 'c-personal'), sub('Deals', 'c-work', 2), sub('Calls', 'c-work', 1)],
    })
    expect(
      screen.getByText('This list has 2 open tasks. What should happen to them?'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(radio('Move them to…')).toBeChecked()
    const groups = [...select().querySelectorAll('optgroup')]
    expect(groups.map((g) => g.label)).toEqual(['Work', 'Personal'])
    expect([...groups[0].querySelectorAll('option')].map((o) => o.value)).toEqual([
      'Calls',
      'Deals',
    ])
    expect(select()).toHaveValue('Calls')
    await userEvent.click(
      screen.getByRole('button', { name: 'Move and delete list' }),
    )
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'move', toId: 'Calls' })
  })

  it('only other-category targets: Move is offered, defaulting there', async () => {
    const { onConfirm } = setup({
      openCount: 1,
      targets: [sub('Home', 'c-personal'), sub('General', 'c-personal')],
    })
    expect(
      screen.getByText('This list has 1 open task. What should happen to them?'),
    ).toBeInTheDocument()
    expect(radio('Move them to…')).toBeChecked()
    expect(select()).toHaveValue('Home')
    await userEvent.selectOptions(select(), 'General')
    await userEvent.click(
      screen.getByRole('button', { name: 'Move and delete list' }),
    )
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'move', toId: 'General' })
  })

  it('no targets: Move is hidden, Mark them done is the default', async () => {
    const { onConfirm } = setup({ openCount: 2 })
    expect(screen.queryByRole('radio', { name: 'Move them to…' })).toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(radio('Mark them done')).toBeChecked()
    expect(screen.getByText('They’ll show in Insights.')).toBeInTheDocument()
    const confirm = screen.getByRole('button', {
      name: 'Mark done and delete list',
    })
    expect(confirm).not.toHaveClass('bg-destructive')
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'complete' })
  })

  it('Delete them: destructive label, sends kind delete', async () => {
    const { onConfirm } = setup({
      openCount: 2,
      targets: [sub('Calls', 'c-work')],
    })
    await userEvent.click(radio('Delete them'))
    const confirm = screen.getByRole('button', { name: 'Delete tasks and list' })
    expect(confirm).toHaveClass('bg-destructive')
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'delete' })
  })

  it('reopening resets to the default', async () => {
    const { all, rerender } = setup({
      openCount: 2,
      targets: [sub('Calls', 'c-work')],
    })
    await userEvent.click(radio('Delete them'))
    expect(radio('Delete them')).toBeChecked()
    rerender(<DeleteSubcategoryDialog {...all} open={false} />)
    rerender(<DeleteSubcategoryDialog {...all} open />)
    expect(radio('Move them to…')).toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Move and delete list' }),
    ).toBeInTheDocument()
  })
})
