import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))

import type { Task, TodayMark } from '@/db/types'

import { useTodayPlan } from './todayPlan'

/*
 * Chunk 43 (F1) made Today membership persistent; chunk 64 moved it from a
 * per-device localStorage entry (`hup:todayPlan`) to the synced `today_marks`
 * table. Only manual pins/removals are stored — resolved membership is always
 * re-derived from `autoTodayIds(tasks)` with today's marks layered on top, so
 * auto signals keep flowing as tasks change and yesterday's plan never
 * resurfaces. The hook is handed the marks and a writer; these tests drive
 * both.
 */

const STORAGE_KEY = 'hup:todayPlan'

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    userId: 'u1',
    subcategoryId: 's-work',
    title: overrides.id,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Same local-calendar day key the hook stamps its marks with. */
function todayKey(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function mark(
  id: string,
  kind: TodayMark['kind'],
  over: Partial<TodayMark> = {},
): TodayMark {
  return {
    id,
    userId: 'u1',
    day: todayKey(),
    kind,
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

type Props = { tasks: Task[]; marks: TodayMark[] | null; timeZone?: string }

// The runner's own zone: the fixtures above are built in its local frame.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

const writeMark = vi.fn<
  (taskId: string, kind: TodayMark['kind'], day: string) => Promise<unknown>
>(() => Promise.resolve())

function renderPlan(
  tasks: Task[],
  marks: TodayMark[] | null = [],
  timeZone?: string,
) {
  return renderHook(
    ({ tasks, marks, timeZone }: Props) =>
      useTodayPlan(tasks, marks, writeMark, timeZone ?? LOCAL_TZ),
    { initialProps: { tasks, marks, timeZone } as Props },
  )
}

beforeEach(() => {
  localStorage.clear()
  toastError.mockReset()
  writeMark.mockReset()
  writeMark.mockImplementation(() => Promise.resolve())
})

describe('useTodayPlan persistence (chunk 43, F1; marks since chunk 64)', () => {
  it('a manual pin survives a remount', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const first = renderPlan(tasks)
    expect(first.result.current.todaySet.has('a')).toBe(false)
    act(() => first.result.current.toggleToday('a'))
    expect(first.result.current.todaySet.has('a')).toBe(true)
    first.unmount()

    // The pin was written as a mark; a fresh mount given that mark has it.
    const [id, kind, day] = writeMark.mock.calls[0]
    const second = renderPlan(tasks, [mark(id, kind, { day })])
    expect(second.result.current.todaySet.has('a')).toBe(true)
  })

  it('a manual removal of an auto-signalled task survives a remount', () => {
    const tasks = [task({ id: 'p', priority: 1 }), task({ id: 'b' })]
    const first = renderPlan(tasks)
    expect(first.result.current.todaySet.has('p')).toBe(true)
    act(() => first.result.current.toggleToday('p'))
    expect(first.result.current.todaySet.has('p')).toBe(false)
    first.unmount()

    const [id, kind, day] = writeMark.mock.calls[0]
    expect(kind).toBe('remove')
    const second = renderPlan(tasks, [mark(id, kind, { day })])
    expect(second.result.current.todaySet.has('p')).toBe(false)
  })

  it('ignores a mark dated before today', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'p', priority: 1 })]
    const { result } = renderPlan(tasks, [
      mark('a', 'pin', { day: '2020-01-01' }),
      mark('p', 'remove', { day: '2020-01-01' }),
    ])
    // Yesterday's pin does not resurface; yesterday's removal does not stick.
    expect(result.current.todaySet.has('a')).toBe(false)
    expect(result.current.todaySet.has('p')).toBe(true)
    // …and nothing is written to tidy them up.
    expect(writeMark).not.toHaveBeenCalled()
  })

  it('removes a stale localStorage entry from storage, not just from the read (chunk 46)', () => {
    // A device opened, untouched and closed would otherwise keep yesterday's
    // deltas on disk indefinitely — behaviour right, storage wrong.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: '2020-01-01', pinned: ['a'], removed: [] }),
    )
    renderPlan([task({ id: 'a' })])
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(writeMark).not.toHaveBeenCalled()
  })

  it('ignores a mark whose task no longer exists', () => {
    const before = [task({ id: 'a' }), task({ id: 'b' })]
    const marks = [mark('a', 'pin')]
    const { result, rerender } = renderPlan(before, marks)
    expect(result.current.todaySet.has('a')).toBe(true)

    // Task `a` is deleted; its mark is still in hand until the next refresh.
    rerender({ tasks: [task({ id: 'b' })], marks })
    expect(result.current.todaySet.has('a')).toBe(false)
    expect([...result.current.todaySet]).toEqual([])
  })

  it('a task that gains an auto signal still appears even when not pinned', () => {
    // Today's marks pin only `x` — `p` has no mark, and its P1 signal must
    // still put it on the plan.
    const tasks = [task({ id: 'x' }), task({ id: 'p', priority: 1 })]
    const { result } = renderPlan(tasks, [mark('x', 'pin')])
    expect(result.current.todaySet.has('x')).toBe(true)
    expect(result.current.todaySet.has('p')).toBe(true)
  })

  it('applies nothing while marks are still loading (null), then applies them once', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'p', priority: 1 })]
    const { result, rerender } = renderPlan(tasks, null)
    // Not loaded yet: the auto seed alone.
    expect([...result.current.todaySet]).toEqual(['p'])

    rerender({ tasks, marks: [mark('a', 'pin'), mark('p', 'remove')] })
    expect([...result.current.todaySet]).toEqual(['a'])
  })

  it('keeps the marks intact while tasks are still loading (empty list)', () => {
    const marks = [mark('a', 'pin')]
    const { result, rerender } = renderPlan([], marks)
    expect(result.current.todaySet.size).toBe(0)
    rerender({ tasks: [task({ id: 'a' })], marks })
    expect(result.current.todaySet.has('a')).toBe(true)
    expect(writeMark).not.toHaveBeenCalled()
  })
})

describe('useTodayPlan synced marks (chunk 64)', () => {
  it('a toggle writes a mark', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const { result } = renderPlan(tasks)

    act(() => result.current.toggleToday('a'))
    expect(result.current.todaySet.has('a')).toBe(true)
    expect(writeMark).toHaveBeenCalledTimes(1)
    expect(writeMark).toHaveBeenLastCalledWith('a', 'pin', todayKey())

    act(() => result.current.toggleToday('a'))
    expect(result.current.todaySet.has('a')).toBe(false)
    expect(writeMark).toHaveBeenCalledTimes(2)
    expect(writeMark).toHaveBeenLastCalledWith('a', 'remove', todayKey())
    // The plan no longer lives in localStorage.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('a remote mark applies without a local toggle', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const { result, rerender } = renderPlan(tasks)
    expect(result.current.todaySet.has('a')).toBe(false)

    rerender({ tasks, marks: [mark('a', 'pin')] })
    expect(result.current.todaySet.has('a')).toBe(true)

    rerender({ tasks, marks: [mark('a', 'remove')] })
    expect(result.current.todaySet.has('a')).toBe(false)
    expect(writeMark).not.toHaveBeenCalled()
  })

  it('the newer observation wins between a local toggle and a mark', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const { result, rerender } = renderPlan(tasks)
    act(() => result.current.toggleToday('a'))
    expect(result.current.todaySet.has('a')).toBe(true)

    // A refresh carrying a mark from before the toggle cannot flip it back.
    rerender({
      tasks,
      marks: [mark('a', 'remove', { updatedAt: '2000-01-01T00:00:00+00:00' })],
    })
    expect(result.current.todaySet.has('a')).toBe(true)

    // A genuinely later toggle on another device does.
    rerender({
      tasks,
      marks: [mark('a', 'remove', { updatedAt: '2999-01-01T00:00:00+00:00' })],
    })
    expect(result.current.todaySet.has('a')).toBe(false)
  })

  it('moves a today-dated localStorage entry onto marks once', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: todayKey(), pinned: ['a'], removed: ['p'] }),
    )
    const tasks = [task({ id: 'a' }), task({ id: 'p', priority: 1 })]
    const { result, rerender } = renderPlan(tasks, [])

    expect(writeMark).toHaveBeenCalledTimes(2)
    expect(writeMark).toHaveBeenCalledWith('a', 'pin', todayKey())
    expect(writeMark).toHaveBeenCalledWith('p', 'remove', todayKey())
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    // The device's plan shows straight away, before any echo.
    expect([...result.current.todaySet]).toEqual(['a'])

    rerender({ tasks: [...tasks], marks: [] })
    expect(writeMark).toHaveBeenCalledTimes(2)
  })

  it('a server mark already present for today wins over the stored entry', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: todayKey(), pinned: ['a'], removed: ['p'] }),
    )
    const tasks = [task({ id: 'a' }), task({ id: 'p', priority: 1 })]
    const marks = [mark('a', 'remove')]
    const { result, rerender } = renderPlan(tasks, marks)

    expect(writeMark).toHaveBeenCalledTimes(1)
    expect(writeMark).toHaveBeenCalledWith('p', 'remove', todayKey())
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(result.current.todaySet.has('a')).toBe(false)

    rerender({ tasks: [...tasks], marks: [...marks] })
    expect(writeMark).toHaveBeenCalledTimes(1)
  })

  it('waits for marks to load before moving the stored entry', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: todayKey(), pinned: ['a'], removed: [] }),
    )
    const tasks = [task({ id: 'a' })]
    const { rerender } = renderPlan(tasks, null)
    expect(writeMark).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    rerender({ tasks, marks: [] })
    expect(writeMark).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('a failed write toasts and keeps the plan', async () => {
    writeMark.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('conflict'), { status: 409 })),
    )
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const { result } = renderPlan(tasks)

    await act(async () => {
      result.current.toggleToday('a')
    })

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Could not save Today plan — retry')
    expect(result.current.todaySet.has('a')).toBe(true)
  })
})

describe('useTodayPlan day rollover with the tab open (chunk 44)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a toggle after local midnight drops yesterday’s marks and stamps the new day', () => {
    vi.setSystemTime(new Date(2026, 7, 31, 22, 0, 0))
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const { result, rerender } = renderPlan(tasks)
    act(() => result.current.toggleToday('a'))
    expect(result.current.todaySet.has('a')).toBe(true)
    expect(writeMark).toHaveBeenLastCalledWith('a', 'pin', '2026-08-31')
    // The write echoes back as a mark for the 31st.
    rerender({ tasks, marks: [mark('a', 'pin', { day: '2026-08-31' })] })
    expect(result.current.todaySet.has('a')).toBe(true)

    // The tab stays open across midnight; the next toggle observes the roll.
    vi.setSystemTime(new Date(2026, 8, 1, 0, 5, 0))
    act(() => result.current.toggleToday('b'))

    // Exactly one write — the toggle, stamped with the new day. The roll
    // itself writes nothing.
    expect(writeMark).toHaveBeenCalledTimes(2)
    expect(writeMark).toHaveBeenLastCalledWith('b', 'pin', '2026-09-01')
    expect(result.current.todaySet.has('b')).toBe(true)
    expect(result.current.todaySet.has('a')).toBe(false)
  })

  it('a same-day clock advance keeps the marks apart from the toggle', () => {
    vi.setSystemTime(new Date(2026, 7, 31, 9, 0, 0))
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const { result, rerender } = renderPlan(tasks)
    act(() => result.current.toggleToday('a'))
    rerender({ tasks, marks: [mark('a', 'pin', { day: '2026-08-31' })] })

    vi.setSystemTime(new Date(2026, 7, 31, 18, 0, 0))
    act(() => result.current.toggleToday('b'))

    expect(writeMark.mock.calls).toEqual([
      ['a', 'pin', '2026-08-31'],
      ['b', 'pin', '2026-08-31'],
    ])
    expect(result.current.todaySet.has('a')).toBe(true)
    expect(result.current.todaySet.has('b')).toBe(true)
  })
})

describe('useTodayPlan in the Settings time zone (chunk 66)', () => {
  // 2026-10-14T02:30Z is Oct 13, 22:30 in New York and Oct 14 in UTC.
  const LATE_NY = new Date('2026-10-14T02:30:00.000Z')
  // Midnight Oct 14 in New York, as a due date is stored.
  const DUE_OCT_14_NY = '2026-10-14T04:00:00.000Z'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(LATE_NY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stamps a toggle with the day in the Settings zone, not the device’s', () => {
    const tasks = [task({ id: 'a' })]
    const ny = renderPlan(tasks, [], 'America/New_York')
    act(() => ny.result.current.toggleToday('a'))
    expect(writeMark).toHaveBeenLastCalledWith('a', 'pin', '2026-10-13')
    ny.unmount()

    const utc = renderPlan(tasks, [], 'UTC')
    act(() => utc.result.current.toggleToday('a'))
    expect(writeMark).toHaveBeenLastCalledWith('a', 'pin', '2026-10-14')
  })

  it('counts only marks dated today in the Settings zone', () => {
    const tasks = [task({ id: 'a' })]
    const marks = [mark('a', 'pin', { day: '2026-10-13' })]
    expect(
      renderPlan(tasks, marks, 'America/New_York').result.current.todaySet.has('a'),
    ).toBe(true)
    expect(renderPlan(tasks, marks, 'UTC').result.current.todaySet.has('a')).toBe(
      false,
    )
  })

  it('re-derives the auto plan when the Settings zone changes', () => {
    const tasks = [task({ id: 'd', dueAt: DUE_OCT_14_NY })]
    const { result, rerender } = renderPlan(tasks, [], 'America/New_York')
    // Still Oct 13 in New York: due tomorrow, not on today's plan.
    expect(result.current.todaySet.has('d')).toBe(false)
    // Oct 14 in UTC, and the due date falls on Oct 14 there: due today.
    rerender({ tasks, marks: [], timeZone: 'UTC' })
    expect(result.current.todaySet.has('d')).toBe(true)
    expect(writeMark).not.toHaveBeenCalled()
  })
})
