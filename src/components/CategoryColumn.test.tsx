import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
    // Chunk 76: required prop.
    horizon: 'all',
    onChangeHorizon: vi.fn(),
    onCreateSubcategory: vi.fn(),
    onRenameSubcategory: vi.fn(),
    onDeleteSubcategory: vi.fn(),
    onMergeSubcategory: vi.fn(),
    onReorderSubcategories: vi.fn(),
    onMoveSubcategory: vi.fn(),
    ...overrides,
  } as CategoryColumnProps
  // TaskMenu → BlockTimeSheet calls useNavigate() once rows render.
  render(<CategoryColumn {...props} />, { wrapper: MemoryRouter })
  const name = screen.getByRole('heading', { level: 2, name: props.category.name })
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

  // Chunk 86 (D3): the time total is gone; line two is found from sort.
  it('puts the sort control and › on line two, apart from the name and pill', () => {
    const { header, name } = renderColumn()
    expect(screen.queryByText('0m')).toBeNull()
    const sort = screen.getByRole('button', { name: /^Sort tasks/ })
    const open = screen.getByRole('button', { name: 'Open Work' })
    const pill = screen.getByText('0 open')

    const lineTwo = sort.parentElement as HTMLElement
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

  // Smoke fix: at 1024px with saved margins the column is 239px and a no-wrap
  // line two (266px) overflowed leftward out of the `justify-end` header.
  it('lets line two wrap and shrink inside a narrow column', () => {
    renderColumn()
    const lineTwo = screen.getByRole('button', { name: 'Open Work' })
      .parentElement as HTMLElement
    expect(lineTwo).toHaveClass('flex-wrap', 'min-w-0', 'justify-end')
    expect(lineTwo).not.toHaveClass('shrink-0')
  })
})

describe('CategoryColumn "N open" pill (chunk 75)', () => {
  // White on the base category colour is under 4.5:1; the pill sits on the
  // text-safe `-ink` variant instead.
  it.each([
    ['Work', 'var(--work-ink)'],
    ['Personal', 'var(--personal-ink)'],
  ] as const)('%s sits on %s', (name, background) => {
    const cat = { id: `cat-${name}`, name, userId: 'u1' }
    renderColumn({ category: cat, allCategories: [cat] })
    expect(screen.getByText('0 open').getAttribute('style')).toContain(
      `background: ${background}`,
    )
  })
})

describe('CategoryColumn horizon (chunk 76)', () => {
  const sub = {
    id: 's1',
    name: 'Inbox',
    categoryId: 'cat-work',
    sortOrder: 0,
    userId: 'u1',
    archivedAt: null,
  }
  const task = (id: string, priority: 1 | 2 | 3 | null) => ({
    id,
    userId: 'u1',
    subcategoryId: 's1',
    title: id,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const tasksBySub = { s1: [task('Soon', 2), task('Someday', 3)] }

  it('the pill counts near rows only under near', () => {
    renderColumn({
      subcategories: [sub],
      allSubcategories: [sub],
      tasksBySub,
      horizon: 'near',
    })
    expect(screen.getByText('1 open')).toBeInTheDocument()
  })

  it('the pill counts every open row under all', () => {
    renderColumn({
      subcategories: [sub],
      allSubcategories: [sub],
      tasksBySub,
      horizon: 'all',
    })
    expect(screen.getByText('2 open')).toBeInTheDocument()
  })

  it('shows no time total in the header (chunk 86, D3)', () => {
    const three = { s1: [task('A', null), task('B', null), task('C', null)] }
    const { header } = renderColumn({
      subcategories: [sub],
      allSubcategories: [sub],
      tasksBySub: three,
      horizon: 'all',
    })
    // Three 30 m rows read `1h 30m` before chunk 86.
    expect(screen.queryByText('1h 30m')).toBeNull()
    expect(header.textContent).not.toMatch(/\d+h|\d+m\b/)
  })

  it('mounts the horizon control on line two, before sort, without drilling', () => {
    const { onDrillDown } = renderColumn()
    const group = screen.getByRole('radiogroup', { name: 'Horizon' })
    const sort = screen.getByRole('button', { name: /^Sort tasks/ })
    expect(group.nextElementSibling).toBe(sort)
    fireEvent.click(screen.getByRole('radio', { name: 'Near' }))
    fireEvent.doubleClick(screen.getByRole('radio', { name: 'Near' }))
    fireEvent.keyDown(screen.getByRole('radio', { name: 'All' }), { key: 'Enter' })
    expect(onDrillDown).not.toHaveBeenCalled()
  })
})
