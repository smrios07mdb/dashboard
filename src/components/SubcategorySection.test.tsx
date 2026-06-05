import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SubcategorySection from './SubcategorySection'
import type { Category, Subcategory, Task } from '@/db/types'

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
  notes: null,
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
  onEditTaskNotes: vi.fn(),
  onRenameSubcategory: vi.fn(),
  onDeleteSubcategory: vi.fn(),
  onMergeSubcategory: vi.fn(),
  onMoveSubcategory: vi.fn(),
})

// Completing a 30-minute task is worth 10 + 30 = 40 XP (see taskXP).
const DONE_AT = '2026-01-02T00:00:00.000Z'

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
