import { rectIntersection, type DragEndEvent } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'

import {
  isTaskDragId,
  resolveTaskDrop,
  taskDragCollision,
} from './taskDragCollision'

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

/*
 * Chunk 88: one DndContext over both Dashboard columns. The `subdrop:`
 * droppable is the whole list section, not its header. Work is x 0–500,
 * Personal x 540–1040; the 40px between them is a gap. Each section is also a
 * sortable item in its category's `subs:<categoryId>` container.
 */
const SECTIONS: Record<string, { r: Rect; container?: string }> = {
  'subdrop:A': { r: rect(0, 0, 500, 200) },
  'subdrop:B': { r: rect(0, 200, 500, 200) },
  'subdrop:P': { r: rect(540, 0, 500, 200) },
  A: { r: rect(0, 0, 500, 200), container: 'subs:work' },
  B: { r: rect(0, 200, 500, 200), container: 'subs:work' },
  P: { r: rect(540, 0, 500, 200), container: 'subs:personal' },
}

function mkSectionArgs(opts: {
  activeId: string
  activeContainer?: string
  collisionRect: Rect
  pointer: { x: number; y: number } | null
}) {
  const entries = Object.entries(SECTIONS)
  const droppableRects = new Map(entries.map(([id, s]) => [id, s.r]))
  const droppableContainers = entries.map(([id, s]) => ({
    id,
    key: id,
    data: {
      current: s.container ? { sortable: { containerId: s.container } } : {},
    },
    rect: { current: s.r },
    disabled: false,
    node: { current: null },
  }))
  return {
    active: {
      id: opts.activeId,
      data: {
        current: opts.activeContainer
          ? { sortable: { containerId: opts.activeContainer } }
          : {},
      },
    },
    collisionRect: opts.collisionRect,
    droppableRects,
    droppableContainers,
    pointerCoordinates: opts.pointer,
  } as never
}

describe('taskDragCollision — whole-list drop target (chunk 88)', () => {
  // Not a regression guard: the collision is geometry-only; the move of the
  // droppable to the section is guarded in SubcategorySection.test.tsx.
  it('a pointer in a section below its header resolves to that list', () => {
    const args = mkSectionArgs({
      activeId: 'task:t1',
      collisionRect: rect(560, 120, 420, 30),
      pointer: { x: 700, y: 140 },
    })
    expect(ids(taskDragCollision(args))).toEqual(['subdrop:P'])
  })

  // Not a regression guard: base resolves the gap to nothing too.
  it('a pointer in the gap between the columns resolves to nothing', () => {
    const args = mkSectionArgs({
      activeId: 'task:t1',
      collisionRect: rect(450, 120, 420, 30),
      pointer: { x: 520, y: 140 },
    })
    expect(taskDragCollision(args)).toEqual([])
  })

  it('a list reorder only sees its own category’s lists', () => {
    // Work list A dragged right over Personal list P.
    const args = mkSectionArgs({
      activeId: 'A',
      activeContainer: 'subs:work',
      collisionRect: rect(540, 0, 500, 200),
      pointer: { x: 790, y: 100 },
    })
    const hit = ids(taskDragCollision(args))
    expect(hit).not.toContain('P')
    expect(hit).not.toContain('subdrop:P')
    for (const id of hit) expect(['A', 'B']).toContain(id)
  })
})

describe('resolveTaskDrop (chunk 88)', () => {
  const taskActive = {
    id: 'task:t1',
    data: { current: { taskId: 't1', currentSubcategoryId: 'sw1' } },
  }
  const overList = (subId: string) => ({
    id: `subdrop:${subId}`,
    data: { current: { type: 'subcategory', subcategoryId: subId } },
  })
  const ev = (active: unknown, over: unknown) =>
    ({ active, over }) as unknown as DragEndEvent

  it('a task over another list resolves to that list', () => {
    expect(resolveTaskDrop(ev(taskActive, overList('sp1')))).toEqual({
      taskId: 't1',
      toSubId: 'sp1',
    })
  })

  it('a task over its own list is a no-op', () => {
    expect(resolveTaskDrop(ev(taskActive, overList('sw1')))).toBeNull()
  })

  it('a task over nothing is a no-op', () => {
    expect(resolveTaskDrop(ev(taskActive, null))).toBeNull()
  })

  it('a list drag is never a task move', () => {
    const listActive = {
      id: 'sw1',
      data: { current: { sortable: { containerId: 'subs:work' } } },
    }
    expect(resolveTaskDrop(ev(listActive, overList('sp1')))).toBeNull()
  })
})
