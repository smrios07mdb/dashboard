import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { Task } from '@/db/types'
import { usePlannerDrag } from './usePlannerDrag'

/*
 * Drag hook (chunk 37, D7): the 5px activation threshold — a 3px move then
 * pointerup is a click (no drop, no drag state), a 6px move over the grid
 * activates and drops with a snapped `over`; move/resize clamp and snap.
 * `getBoundingClientRect` is mocked; the grid is 666px wide (56 gutter +
 * 5×100 + 2×55) with the 08:00–19:00 window.
 */

const task: Task = {
  id: 't-1',
  userId: 'u-1',
  subcategoryId: 'sub-1',
  title: 'Task',
  notes: null,
  estimateMinutes: 45,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
}

const gridEl = {
  getBoundingClientRect: () => ({
    left: 0,
    top: 0,
    width: 666,
    height: 572,
    right: 666,
    bottom: 572,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }),
} as unknown as HTMLElement

function pointerDownEvent(x: number, y: number) {
  const target = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  }
  return {
    button: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: target,
    preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLElement>
}

function moveTo(x: number, y: number) {
  window.dispatchEvent(
    new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }),
  )
}
function up() {
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
}

function setup(onDrop = vi.fn()) {
  const gridRef = { current: gridEl }
  const hook = renderHook(() =>
    usePlannerDrag({
      gridRef,
      getWindow: () => ({ h0: 8 * 60, h1: 19 * 60 }),
      enabled: true,
      onDrop,
    }),
  )
  return { hook, onDrop }
}

afterEach(() => {
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

describe('usePlannerDrag (chunk 37)', () => {
  it('a 3px move then pointerup is a click — no drag state, no drop', () => {
    const { hook, onDrop } = setup()
    act(() => hook.result.current.startTray(pointerDownEvent(20, 20), task, 'Work', 45))
    act(() => moveTo(22, 22))
    expect(hook.result.current.drag).toBeNull()
    expect(document.body.style.cursor).toBe('')
    act(() => up())
    expect(onDrop).not.toHaveBeenCalled()
    expect(hook.result.current.drag).toBeNull()
  })

  it('a 6px move activates, then a drop over the grid reports a snapped over', () => {
    const { hook, onDrop } = setup()
    act(() => hook.result.current.startTray(pointerDownEvent(20, 20), task, 'Work', 45))
    act(() => moveTo(20, 26))
    expect(hook.result.current.drag?.kind).toBe('tray')
    expect(document.body.style.cursor).toBe('grabbing')
    expect(document.body.style.userSelect).toBe('none')
    // Column 2 (WED: x 256–356), y = 130px → 150m → 10:30.
    act(() => moveTo(300, 130))
    expect(hook.result.current.drag).toMatchObject({
      kind: 'tray',
      px: 300,
      py: 130,
      over: { day: 2, startMin: 630, endMin: 675 },
    })
    act(() => up())
    expect(onDrop).toHaveBeenCalledWith({
      kind: 'tray',
      task,
      over: { day: 2, startMin: 630, endMin: 675 },
    })
    expect(hook.result.current.drag).toBeNull()
    expect(document.body.style.cursor).toBe('')
  })

  it('a tray drop clamps into the visible window', () => {
    const { hook, onDrop } = setup()
    act(() => hook.result.current.startTray(pointerDownEvent(20, 20), task, 'Work', 60))
    // Bottom edge of the grid → start clamps to 18:00 so the 60m block fits.
    act(() => moveTo(100, 570))
    act(() => up())
    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ over: { day: 0, startMin: 18 * 60, endMin: 19 * 60 } }),
    )
  })

  it('Escape cancels an active drag without dropping', () => {
    const { hook, onDrop } = setup()
    act(() => hook.result.current.startTray(pointerDownEvent(20, 20), task, 'Work', 45))
    act(() => moveTo(300, 130))
    expect(hook.result.current.drag).not.toBeNull()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(hook.result.current.drag).toBeNull()
    act(() => up())
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('move keeps the block duration and the grab offset; no-op drop when unchanged', () => {
    const { hook, onDrop } = setup()
    const block = { id: 'b', taskId: 't-1', day: 1, startMin: 600, endMin: 660, done: false }
    // Grab 15 minutes into the block (y for 10:15 = 2.25h × 52 = 117px).
    act(() => hook.result.current.startMove(pointerDownEvent(200, 117), block, 'Work'))
    act(() => up())
    expect(onDrop).not.toHaveBeenCalled()
    // Drag 52px down (one hour) → block moves to 11:00–12:00 on THU.
    act(() => hook.result.current.startMove(pointerDownEvent(200, 117), block, 'Work'))
    act(() => moveTo(400, 169))
    act(() => up())
    expect(onDrop).toHaveBeenCalledWith({
      kind: 'move',
      block,
      over: { day: 3, startMin: 660, endMin: 720 },
    })
  })

  it('resize snaps to 15m and never goes under the 15m minimum', () => {
    const { hook, onDrop } = setup()
    const block = { id: 'b', taskId: 't-1', day: 1, startMin: 600, endMin: 660, done: false }
    act(() => hook.result.current.startResize(pointerDownEvent(200, 169), block))
    // Drag way above the block start → clamps to start + 15.
    act(() => moveTo(200, 50))
    expect(hook.result.current.drag).toMatchObject({
      kind: 'resize',
      over: { day: 1, startMin: 600, endMin: 615 },
    })
    act(() => up())
    expect(onDrop).toHaveBeenCalledWith({ kind: 'resize', block, endMin: 615 })
  })

  it('does nothing when disabled (touch devices)', () => {
    const gridRef = { current: gridEl }
    const onDrop = vi.fn()
    const hook = renderHook(() =>
      usePlannerDrag({
        gridRef,
        getWindow: () => ({ h0: 480, h1: 1140 }),
        enabled: false,
        onDrop,
      }),
    )
    act(() => hook.result.current.startTray(pointerDownEvent(20, 20), task, 'Work', 45))
    act(() => moveTo(300, 130))
    expect(hook.result.current.drag).toBeNull()
    act(() => up())
    expect(onDrop).not.toHaveBeenCalled()
  })
})
