import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Chunk 87: the delete dialog is stubbed to read the counts it receives.
const deleteDialogProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }))
vi.mock('@/components/DeleteSubcategoryDialog', () => ({
  default: (props: Record<string, unknown>) => {
    deleteDialogProps.last = props
    return null
  },
}))

// Chunk 88: a test can hold the list's droppable "over" with a given drag.
const drop = vi.hoisted(() => ({
  over: null as null | { activeId: string; currentSubcategoryId?: string },
  ids: [] as string[],
}))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    useDroppable: (args: Parameters<typeof actual.useDroppable>[0]) => {
      drop.ids.push(String(args.id))
      const real = actual.useDroppable(args)
      if (!drop.over) return real
      return {
        ...real,
        isOver: true,
        active: {
          id: drop.over.activeId,
          data: {
            current: { currentSubcategoryId: drop.over.currentSubcategoryId },
          },
        },
      } as unknown as ReturnType<typeof actual.useDroppable>
    },
  }
})

import SubcategorySection from './SubcategorySection'
import type { Category, Subcategory, Task } from '@/db/types'
import type { HorizonFilter } from '@/lib/horizon'

/*
 * Regression guard for the Chunk 27 completion cheer (rowFlush + "+XP" floater
 * + checkbox pop).
 *
 * The cheer was silently dead in the real app: the just-completed "linger" Set
 * was seeded in a `useEffect`, which commits AFTER the completion render. For
 * one render the just-completed task fell out of `visibleIncomplete`, its
 * TaskRow unmounted, the effect then re-added the id, and the row REMOUNTED as
 * a fresh instance — tripping TaskRow's mount guard so the cheer never fired.
 * No existing test rendered SubcategorySection through a real open→done
 * transition (every completed-task case in Dashboard.test.tsx is completed AT
 * mount), so the dead FX shipped green.
 *
 * This drives the actual reconciliation the bug hinged on: render(open) →
 * rerender(same id, now done). With the fix (`justCompletedIds` reading
 * `prevTasks.current` during render) the TaskRow instance stays mounted and the
 * cheer fires; on the pre-fix derivation the row remounts and the mount guard
 * suppresses it, so the first floater assertion fails.
 */

const cat = (id: string, name: 'Work' | 'Personal'): Category => ({
  id,
  name,
  userId: 'u1',
})
const sub = (id: string, categoryId: string): Subcategory => ({
  id,
  name: id,
  categoryId,
  sortOrder: 0,
  userId: 'u1',
  archivedAt: null,
})
const task = (id: string, completedAt: string | null = null): Task => ({
  id,
  userId: 'u1',
  subcategoryId: 's1',
  title: id,
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})
const baseProps = (tasks: Task[]) => ({
  subcategory: sub('s1', 'c-work'),
  allCategories: [cat('c-work', 'Work')],
  allSubcategories: [sub('s1', 'c-work')],
  tasks,
  otherSubsInCategory: [] as Subcategory[],
  canMoveUp: false,
  canMoveDown: false,
  isTouch: false,
  onDrillDown: vi.fn(),
  onCreateTask: vi.fn().mockResolvedValue(true),
  onCompleteTask: vi.fn(),
  onEditTitle: vi.fn(),
  onEditMinutes: vi.fn(),
  onDeleteTask: vi.fn(),
  onMoveTaskToSubcategory: vi.fn(),
  onSetTaskReminder: vi.fn(),
  onSetTaskDue: vi.fn(),
  onSetTaskPriority: vi.fn(),
  sortKey: 'priority' as const,
  horizon: 'all' as HorizonFilter,
  onRenameSubcategory: vi.fn(),
  onDeleteSubcategory: vi.fn(),
  onMergeSubcategory: vi.fn(),
  onMoveSubcategory: vi.fn(),
})

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString()

// Completing a 30-minute task is worth 10 + 30 = 40 XP (see taskXP).
// Chunk 86: recent, so the completion stays on the list (30-day rule, D2).
const DONE_AT = daysAgo(2)

describe('SubcategorySection completion cheer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires the cheer on a real open→done transition, then drops the row into the completed bucket', () => {
    // TaskMenu → BlockTimeSheet calls useNavigate(), so a Router is required.
    // Passing `wrapper` makes RTL apply it to `rerender` too.
    const { container, rerender } = render(
      <SubcategorySection {...baseProps([task('Submit report')])} />,
      { wrapper: MemoryRouter },
    )

    // Open: the task is in the main list, no celebration yet.
    expect(screen.getByText('Submit report')).toBeInTheDocument()
    expect(container.querySelector('.xp-floater')).toBeNull()
    expect(container.querySelector('.row-flush')).toBeNull()
    expect(screen.queryByRole('button', { name: /\d+ completed/i })).toBeNull()

    // The SAME task id flips open→done. The fix keeps its TaskRow mounted
    // across this render, so the completed transition fires the cheer; the
    // pre-fix derivation unmounts/remounts the row and the mount guard
    // suppresses it (which would make the next assertion fail).
    act(() => {
      rerender(
        <SubcategorySection {...baseProps([task('Submit report', DONE_AT)])} />,
      )
    })

    // Cheer fired on the still-mounted instance: a "+40" floater, the row
    // flush, and the row is still visible (not yet tucked into the bucket).
    const floater = container.querySelector('.xp-floater')
    expect(floater).not.toBeNull()
    expect(floater).toHaveTextContent('+40')
    expect(container.querySelector('.row-flush')).not.toBeNull()
    expect(screen.getByText('Submit report')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\d+ completed/i })).toBeNull()

    // The linger (~1.1s) and the cheer cleanup (~0.95s) both elapse.
    act(() => {
      vi.advanceTimersByTime(1200)
    })

    // Cheer torn down; the row has dropped into the collapsed "N completed"
    // bucket (the expander appears and the row leaves the visible list).
    expect(container.querySelector('.xp-floater')).toBeNull()
    expect(container.querySelector('.row-flush')).toBeNull()
    expect(
      screen.getByRole('button', { name: /1 completed/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Submit report')).toBeNull()
  })
})

describe('SubcategorySection horizon filter (chunk 76)', () => {
  const inDays = (n: number) =>
    new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()
  const t = (id: string, extra: Partial<Task> = {}): Task => ({
    ...task(id),
    ...extra,
  })
  const renderWith = (tasks: Task[], horizon: HorizonFilter) =>
    render(<SubcategorySection {...baseProps(tasks)} horizon={horizon} />, {
      wrapper: MemoryRouter,
    })

  it('shows only near rows under near, and the header count matches', () => {
    renderWith(
      [
        t('Soon one', { priority: 2 }),
        t('Dated one', { dueAt: inDays(3) }),
        t('Someday one', { priority: 3 }),
      ],
      'near',
    )
    expect(screen.getByText('Soon one')).toBeInTheDocument()
    expect(screen.getByText('Dated one')).toBeInTheDocument()
    expect(screen.queryByText('Someday one')).toBeNull()
    // SubcategoryHeader renders the open count; chunk 86 (D3) dropped the
    // open minutes (two 30 m rows read `1h` before).
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('1h')).toBeNull()
  })

  it('says "Nothing near term." when every open row is long, and the completed expander still works', () => {
    renderWith(
      [t('Someday one', { priority: 3 }), t('Done one', { completedAt: DONE_AT })],
      'near',
    )
    expect(screen.getByText('Nothing near term.')).toBeInTheDocument()
    expect(screen.queryByText('Someday one')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '1 completed' }))
    expect(screen.getByText('Done one')).toBeInTheDocument()
  })

  it('says "Nothing long term." when every open row is near', () => {
    renderWith([t('Urgent one', { priority: 1 })], 'long')
    expect(screen.getByText('Nothing long term.')).toBeInTheDocument()
    expect(screen.queryByText('Urgent one')).toBeNull()
  })

  it('filters nothing under all', () => {
    renderWith(
      [t('Soon one', { priority: 2 }), t('Someday one', { priority: 3 })],
      'all',
    )
    expect(screen.getByText('Soon one')).toBeInTheDocument()
    expect(screen.getByText('Someday one')).toBeInTheDocument()
    expect(screen.queryByText(/^Nothing (near|long) term\.$/)).toBeNull()
  })
})

// Chunk 86 (D2): completions older than 30 days leave the list.
describe('SubcategorySection — 30-day completions (chunk 86)', () => {
  const renderWith = (tasks: Task[]) =>
    render(<SubcategorySection {...baseProps(tasks)} />, {
      wrapper: MemoryRouter,
    })

  it('counts and lists only recent completions in the expander', () => {
    renderWith([
      task('Open one'),
      task('Recent done', daysAgo(2)),
      task('Old done', daysAgo(40)),
    ])
    fireEvent.click(screen.getByRole('button', { name: '1 completed' }))
    expect(screen.getByText('Recent done')).toBeInTheDocument()
    expect(screen.queryByText('Old done')).toBeNull()
  })

  it('a list with open rows and only old completions shows no expander', () => {
    renderWith([task('Open one'), task('Old done', daysAgo(40))])
    expect(screen.getByText('Open one')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /completed/i })).toBeNull()
    expect(screen.queryByText('Old done')).toBeNull()
  })

  it('a list with only old completions reads "All done." — never an empty body', () => {
    renderWith([task('Old done', daysAgo(40)), task('Older', daysAgo(90))])
    expect(screen.getByText('All done.')).toBeInTheDocument()
    expect(screen.queryByText(/completed/)).toBeNull()
    expect(screen.queryByText('Old done')).toBeNull()
  })

  it('all done with a recent completion keeps "All done. N completed."', () => {
    renderWith([task('Recent done', daysAgo(1)), task('Old done', daysAgo(40))])
    expect(screen.getByText('All done. 1 completed.')).toBeInTheDocument()
  })

  it('renders no time total in the header (D3)', () => {
    // Three 30 m open rows read `1h 30m` before chunk 86.
    renderWith([task('A'), task('B'), task('C')])
    expect(screen.queryByText('1h 30m')).toBeNull()
    // Rows keep their own `30m`; the header row has none.
    const header = screen.getByTestId('list-counts').parentElement as HTMLElement
    expect(header.textContent).not.toMatch(/\d+h|\d+m\b/)
  })
})

describe('SubcategorySection — delete-list counts (chunk 87)', () => {
  it('passes open/done counts from all tasks, not the horizon-filtered rows', () => {
    // No priority or dates: every open row is long term, so "near" hides them.
    const tasks = [
      task('Open A'),
      task('Open B'),
      task('Done recent', daysAgo(2)),
      task('Done old', daysAgo(90)),
    ]
    const other = sub('s2', 'c-personal')
    const archived = { ...sub('s3', 'c-work'), archivedAt: daysAgo(1) }
    render(
      <SubcategorySection
        {...baseProps(tasks)}
        allCategories={[cat('c-work', 'Work'), cat('c-personal', 'Personal')]}
        allSubcategories={[sub('s1', 'c-work'), other, archived]}
        horizon="near"
      />,
      { wrapper: MemoryRouter },
    )
    expect(screen.getByText('Nothing near term.')).toBeInTheDocument()
    const props = deleteDialogProps.last!
    expect(props.openCount).toBe(2)
    expect(props.doneCount).toBe(2)
    expect(props.targets).toEqual([other])
    expect(props.categories).toEqual([
      cat('c-work', 'Work'),
      cat('c-personal', 'Personal'),
    ])
  })
})

// Chunk 88 (D2): the whole list is the drop target, and it lights up only
// when the drop would move the task.
describe('SubcategorySection — whole-list drop target (chunk 88)', () => {
  afterEach(() => {
    drop.over = null
    drop.ids = []
  })

  const HIGHLIGHT = [
    'bg-accent-soft',
    'ring-1',
    'ring-inset',
    'ring-[hsl(var(--ring))]',
  ]

  function renderSection() {
    const { container } = render(
      <SubcategorySection {...baseProps([task('t1'), task('t2')])} />,
      { wrapper: MemoryRouter },
    )
    const section = container.querySelector('section')!
    return { section, header: section.querySelector('header')! }
  }

  it('registers one subdrop droppable for the list', () => {
    renderSection()
    expect(drop.ids.filter((id) => id === 'subdrop:s1').length).toBeGreaterThan(0)
  })

  it('a task from another list over it highlights the section, not the header', () => {
    drop.over = { activeId: 'task:x', currentSubcategoryId: 's-other' }
    const { header, section } = renderSection()
    expect(section).toHaveClass(...HIGHLIGHT)
    expect(header).not.toHaveClass('bg-accent-soft')
    // The section holds the task rows, so a drop on a row lands here.
    expect(section).toContainElement(screen.getByRole('group', { name: 't1' }))
  })

  it('its own task over it shows no highlight', () => {
    drop.over = { activeId: 'task:t1', currentSubcategoryId: 's1' }
    const { header, section } = renderSection()
    expect(section).not.toHaveClass('bg-accent-soft')
    expect(header).not.toHaveClass('bg-accent-soft')
  })
})
