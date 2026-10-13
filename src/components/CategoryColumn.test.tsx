import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import CategoryColumn, { type CategoryColumnProps } from './CategoryColumn'

/*
 * Chunk 68 (UX audit #2): the category header wraps instead of stretching its
 * column. jsdom does not lay out, so these assert the structure that makes the
 * wrap possible; the smoke measures real widths.
 */

const category = { id: 'cat-work', name: 'Work', userId: 'u1' }

function renderColumn(overrides: Partial<CategoryColumnProps> = {}) {
  const onDrillDown = vi.fn()
  const props = {
    category,
    allCategories: [category],
    allSubcategories: [],
    subcategories: [],
    tasksBySub: {},
    onDrillDown,
    onCreateTask: vi.fn(),
    onCompleteTask: vi.fn(),
    onEditTitle: vi.fn(),
    onEditMinutes: vi.fn(),
    onDeleteTask: vi.fn(),
    onMoveTaskToSubcategory: vi.fn(),
    onSetTaskReminder: vi.fn(),
    onSetTaskDue: vi.fn(),
    onSetTaskPriority: vi.fn(),
    sortKey: 'priority',
    onChangeSortKey: vi.fn(),
    onCreateSubcategory: vi.fn(),
    onRenameSubcategory: vi.fn(),
    onDeleteSubcategory: vi.fn(),
    onMergeSubcategory: vi.fn(),
    onReorderSubcategories: vi.fn(),
    onMoveSubcategory: vi.fn(),
    ...overrides,
  } as CategoryColumnProps
  render(<CategoryColumn {...props} />)
  const name = screen.getByRole('heading', { level: 2, name: 'Work' })
  const header = name.closest('header') as HTMLElement
  return { onDrillDown, name, header }
}

describe('CategoryColumn header — phone width (chunk 68)', () => {
  it('lets the header and the name shrink, and titles the name', () => {
    const { header, name } = renderColumn()
    expect(header).toHaveClass('min-w-0', 'flex-wrap')
    expect(header.className).not.toContain('grid-template-columns')
    expect(name).toHaveClass('min-w-0', 'truncate')
    expect(name).toHaveAttribute('title', 'Work')
  })

  it('drills down on Enter, and exactly once from the › button', () => {
    const { header, onDrillDown } = renderColumn()
    expect(header).toHaveAttribute('role', 'button')
    expect(header).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(header, { key: 'Enter' })
    expect(onDrillDown).toHaveBeenCalledTimes(1)
    expect(onDrillDown).toHaveBeenLastCalledWith('category', 'cat-work')

    // One call from the button itself; nothing more from the header above it.
    onDrillDown.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Open Work' }))
    expect(onDrillDown).toHaveBeenCalledTimes(1)
    expect(onDrillDown).toHaveBeenLastCalledWith('category', 'cat-work')
  })

  it('puts the total, sort control and › on line two, apart from the name and pill', () => {
    const { header, name } = renderColumn()
    const total = screen.getByText('0m')
    const sort = screen.getByRole('button', { name: /^Sort tasks/ })
    const open = screen.getByRole('button', { name: 'Open Work' })
    const pill = screen.getByText('0 open')

    const lineTwo = total.parentElement as HTMLElement
    expect(sort.parentElement).toBe(lineTwo)
    expect(open.parentElement).toBe(lineTwo)
    expect(lineTwo.parentElement).toBe(header)

    const lineOne = name.parentElement as HTMLElement
    expect(pill.parentElement).toBe(lineOne)
    expect(lineOne.parentElement).toBe(header)
    expect(lineOne).not.toBe(lineTwo)
    expect(lineTwo).not.toContainElement(name)
    expect(lineTwo).not.toContainElement(pill)

    // Line one fills the row below `sm`, which is what drops line two under it.
    expect(lineOne).toHaveClass('min-w-0', 'basis-full', 'sm:basis-auto')
  })
})
