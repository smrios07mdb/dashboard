import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import type { Task } from '@/db/types'

import { useTodayPlan } from './todayPlan'

/*
 * Chunk 43 (F1): Today membership persists per-device via day-scoped
 * localStorage deltas (`hup:todayPlan`). Only manual pins/removals are
 * stored — resolved membership is always re-derived from
 * `autoTodayIds(tasks)` with the deltas layered on top, so auto signals
 * keep flowing as tasks change and yesterday's plan never resurfaces.
 */

const STORAGE_KEY = 'hup:todayPlan'

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    userId: 'u1',
    subcategoryId: 's-work',
    title: overrides.id,
    notes: null,
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

/** Same local-calendar day key the hook stamps its stored entry with. */
function todayKey(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function storedDeltas(): { date: string; pinned: string[]; removed: string[] } {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
}

beforeEach(() => {
  localStorage.clear()
})

describe('useTodayPlan persistence (chunk 43, F1)', () => {
  it('a manual pin survives a remount', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const first = renderHook(() => useTodayPlan(tasks))
    expect(first.result.current.todaySet.has('a')).toBe(false)
    act(() => first.result.current.toggleToday('a'))
    expect(first.result.current.todaySet.has('a')).toBe(true)
    first.unmount()

    const second = renderHook(() => useTodayPlan(tasks))
    expect(second.result.current.todaySet.has('a')).toBe(true)
  })

  it('a manual removal of an auto-signalled task survives a remount', () => {
    const tasks = [task({ id: 'p', priority: 1 }), task({ id: 'b' })]
    const first = renderHook(() => useTodayPlan(tasks))
    expect(first.result.current.todaySet.has('p')).toBe(true)
    act(() => first.result.current.toggleToday('p'))
    expect(first.result.current.todaySet.has('p')).toBe(false)
    first.unmount()

    const second = renderHook(() => useTodayPlan(tasks))
    expect(second.result.current.todaySet.has('p')).toBe(false)
  })

  it('discards a stored entry dated before today', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: '2020-01-01', pinned: ['a'], removed: ['p'] }),
    )
    const tasks = [task({ id: 'a' }), task({ id: 'p', priority: 1 })]
    const { result } = renderHook(() => useTodayPlan(tasks))
    // Yesterday's pin does not resurface; yesterday's removal does not stick.
    expect(result.current.todaySet.has('a')).toBe(false)
    expect(result.current.todaySet.has('p')).toBe(true)
  })

  it('prunes deleted task ids from the stored deltas', () => {
    const before = [task({ id: 'a' }), task({ id: 'b' })]
    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: Task[] }) => useTodayPlan(tasks),
      { initialProps: { tasks: before } },
    )
    act(() => result.current.toggleToday('a'))
    expect(storedDeltas().pinned).toEqual(['a'])

    // Task `a` is deleted; the id-set change reconciles and prunes.
    rerender({ tasks: [task({ id: 'b' })] })
    expect(result.current.todaySet.has('a')).toBe(false)
    expect(storedDeltas().pinned).toEqual([])
  })

  it('a task that gains an auto signal still appears even when not pinned', () => {
    // Stored deltas from earlier today pin only `x` — `p` is absent from both
    // delta sets, and its P1 signal must still put it on the plan.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: todayKey(), pinned: ['x'], removed: [] }),
    )
    const tasks = [task({ id: 'x' }), task({ id: 'p', priority: 1 })]
    const { result } = renderHook(() => useTodayPlan(tasks))
    expect(result.current.todaySet.has('x')).toBe(true)
    expect(result.current.todaySet.has('p')).toBe(true)
  })

  it('keeps stored deltas intact while tasks are still loading (empty list)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: todayKey(), pinned: ['a'], removed: [] }),
    )
    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: Task[] }) => useTodayPlan(tasks),
      { initialProps: { tasks: [] as Task[] } },
    )
    // Loading state must not prune the stored pin against the empty list.
    rerender({ tasks: [task({ id: 'a' })] })
    expect(result.current.todaySet.has('a')).toBe(true)
    expect(storedDeltas().pinned).toEqual(['a'])
  })
})
