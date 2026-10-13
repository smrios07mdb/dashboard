import { rectIntersection } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'

import { isTaskDragId, taskDragCollision } from './taskDragCollision'

/*
 * Pure collision tests against the real `@dnd-kit/core` (chunk 63, Day-7 #4).
 *
 * Geometry: one Work column `x 0–500` holding two subcategories. Each has a
 * header droppable (`subdrop:<id>`, SubcategoryHeader) and a sortable section
 * (raw id). The Personal column is everything right of x = 500 and registers
 * nothing in this context — each Dashboard column is its own DndContext.
 */

type Rect = {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

const RECTS: Record<string, Rect> = {
  'subdrop:A': rect(0, 0, 500, 40),
  A: rect(0, 0, 500, 200),
  'subdrop:B': rect(0, 200, 500, 40),
  B: rect(0, 200, 500, 200),
}

function mkArgs(opts: {
  activeId: string
  collisionRect: Rect
  pointer: { x: number; y: number } | null
}) {
  const droppableRects = new Map(Object.entries(RECTS))
  const droppableContainers = Object.entries(RECTS).map(([id, r]) => ({
    id,
    key: id,
    data: { current: {} },
    rect: { current: r },
    disabled: false,
    node: { current: null },
  }))
  return {
    active: { id: opts.activeId },
    collisionRect: opts.collisionRect,
    droppableRects,
    droppableContainers,
    pointerCoordinates: opts.pointer,
  } as never
}

function ids(collisions: { id: unknown }[]) {
  return collisions.map((c) => c.id)
}

// The dragged task row is as wide as its column (500×30).
const ROW_OVER_BOUNDARY = rect(450, 205, 500, 30)

describe('taskDragCollision', () => {
  it('pins the bug: pointer in the other column, row still overlapping Work', () => {
    const args = mkArgs({
      activeId: 'task:t1',
      collisionRect: ROW_OVER_BOUNDARY,
      pointer: { x: 700, y: 220 },
    })
    // The defect: the dnd-kit default resolves to a Work header.
    expect(ids(rectIntersection(args))[0]).toBe('subdrop:B')
    expect(taskDragCollision(args)).toEqual([])
  })

  it('resolves to the header the pointer is on, and only the header', () => {
    const args = mkArgs({
      activeId: 'task:t1',
      collisionRect: rect(50, 205, 500, 30),
      pointer: { x: 300, y: 220 },
    })
    expect(ids(taskDragCollision(args))).toEqual(['subdrop:B'])
  })

  it('resolves to nothing when the pointer is on a section body', () => {
    const args = mkArgs({
      activeId: 'task:t1',
      collisionRect: rect(0, 295, 500, 30),
      pointer: { x: 200, y: 310 },
    })
    expect(taskDragCollision(args)).toEqual([])
  })

  it('leaves the subcategory reorder on rectIntersection', () => {
    const args = mkArgs({
      activeId: 'A',
      collisionRect: rect(0, 150, 500, 200),
      pointer: { x: 250, y: 250 },
    })
    const expected = rectIntersection(args)
    expect(expected.length).toBeGreaterThan(0)
    expect(taskDragCollision(args)).toEqual(expected)
  })

  it('resolves to nothing without pointer coordinates', () => {
    const args = mkArgs({
      activeId: 'task:t1',
      collisionRect: rect(0, 205, 500, 30),
      pointer: null,
    })
    expect(taskDragCollision(args)).toEqual([])
  })
})

describe('isTaskDragId', () => {
  it('matches only the task: prefix', () => {
    expect(isTaskDragId('task:x')).toBe(true)
    expect(isTaskDragId('subdrop:x')).toBe(false)
    expect(isTaskDragId('x')).toBe(false)
    expect(isTaskDragId(undefined)).toBe(false)
  })
})
