import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 66: the due-date picker stores a calendar day in `settings.timezone`
 * as 00:00 of that day in that zone. `@/lib/userTimezone` is mocked (settings
 * zone Asia/Tokyo, device zone America/New_York) so every assertion is
 * independent of the zone of the machine running the suite.
 */

const { loadUserTimezone } = vi.hoisted(() => ({
  loadUserTimezone: vi.fn(),
}))

vi.mock('@/lib/userTimezone', () => ({
  browserTimezone: () => 'America/New_York',
  loadUserTimezone,
}))

import type { Task } from '@/db/types'

import SetDuePopover, {
  fromDueInputValue,
  toDueInputValue,
} from './SetDuePopover'
import TaskMenu from './TaskMenu'

// Radix Popover / DropdownMenu need these jsdom shims.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

function popover(
  props: Partial<React.ComponentProps<typeof SetDuePopover>> = {},
) {
  return (
    <SetDuePopover
      open
      onOpenChange={() => {}}
      dueAt={null}
      onSave={() => {}}
      onClear={() => {}}
      {...props}
    />
  )
}

const input = () => screen.getByLabelText('Due date') as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save' })

describe('SetDuePopover — calendar day in settings.timezone (chunk 66)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadUserTimezone.mockResolvedValue('Asia/Tokyo')
  })

  it('(1) saves the picked day as 00:00 of that day in settings.timezone', async () => {
    const onSave = vi.fn()
    render(popover({ onSave }))
    await waitFor(() => expect(input()).not.toBeDisabled())

    fireEvent.change(input(), { target: { value: '2026-10-20' } })
    await act(async () => {
      fireEvent.click(save())
    })
    // 00:00 Oct 20 in Tokyo (UTC+9) is 15:00 Oct 19 UTC.
    expect(onSave).toHaveBeenCalledWith('2026-10-19T15:00:00.000Z')
  })

  it('(2) opens an existing due date on its day in settings.timezone', async () => {
    render(popover({ dueAt: '2026-10-19T15:00:00.000Z' }))
    await waitFor(() => expect(input().value).toBe('2026-10-20'))
  })

  it('(3) a due date imported with a time of day opens on its day', async () => {
    // 23:30 Oct 20 in Tokyo.
    render(popover({ dueAt: '2026-10-20T14:30:00.000Z' }))
    await waitFor(() => expect(input().value).toBe('2026-10-20'))
  })

  it('(4) input and Save stay disabled until the zone resolves', () => {
    loadUserTimezone.mockReturnValue(new Promise(() => {}))
    render(popover())
    expect(input()).toBeDisabled()
    expect(save()).toBeDisabled()
  })

  it('(5) names the zone when it differs from the device’s', async () => {
    render(popover())
    expect(await screen.findByText('Dates in Asia/Tokyo')).toBeInTheDocument()
  })

  it('(6) Clear shows only when a due date is set, and clears it', async () => {
    const { unmount } = render(popover())
    await waitFor(() => expect(input()).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    unmount()

    const onClear = vi.fn()
    render(popover({ dueAt: '2026-10-19T15:00:00.000Z', onClear }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  // Chunk 82: a day whose midnight is skipped or repeated still stores that
  // day's first instant, on every host.
  it('(8) a skipped midnight stores the day’s first instant', () => {
    const iso = fromDueInputValue('2026-03-08', 'America/Havana')
    expect(iso).toBe('2026-03-08T05:00:00.000Z')
    expect(toDueInputValue(iso, 'America/Havana')).toBe('2026-03-08')
  })

  it('(9) a repeated midnight stores the earlier instant', () => {
    expect(fromDueInputValue('2026-11-01', 'America/Havana')).toBe(
      '2026-11-01T04:00:00.000Z',
    )
  })

  it('(7) converters', () => {
    expect(fromDueInputValue('2026-10-20', 'America/New_York')).toBe(
      '2026-10-20T04:00:00.000Z',
    )
    expect(fromDueInputValue('', 'America/New_York')).toBeNull()
    expect(fromDueInputValue('20/10/2026', 'America/New_York')).toBeNull()
    expect(toDueInputValue('2026-10-20T04:00:00.000Z', 'America/New_York')).toBe(
      '2026-10-20',
    )
    expect(toDueInputValue(null, 'America/New_York')).toBe('')
    expect(toDueInputValue('not a date', 'America/New_York')).toBe('')
  })
})

describe('TaskMenu due-date item (chunk 66)', () => {
  const base: Task = {
    id: 't1',
    userId: 'u1',
    subcategoryId: 's1',
    title: 'Atlas launch',
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }

  function menu(task: Task, onOpenDue = vi.fn()) {
    render(
      <MemoryRouter>
        <TaskMenu
          task={task}
          categories={[]}
          subcategories={[]}
          onMoveToSubcategoryId={vi.fn()}
          onOpenReminder={vi.fn()}
          onOpenPriority={vi.fn()}
          onOpenDue={onOpenDue}
          notes={[]}
          onOpenNotes={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.keyDown(
      screen.getByRole('button', { name: `Actions for "${task.title}"` }),
      { key: 'Enter' },
    )
    return onOpenDue
  }

  it('offers "Set due date…" and opens the picker', async () => {
    const onOpenDue = menu(base)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Set due date…/ }))
    expect(onOpenDue).toHaveBeenCalledTimes(1)
  })

  it('reads "Edit due date" when the task has one', async () => {
    menu({ ...base, dueAt: '2026-10-20T04:00:00.000Z' })
    expect(
      await screen.findByRole('menuitem', { name: /Edit due date/ }),
    ).toBeInTheDocument()
  })
})
