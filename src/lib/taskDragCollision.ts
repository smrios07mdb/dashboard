import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core'

/** `useDraggable` ids for tasks are `task:<uuid>` (TaskRow). */
export function isTaskDragId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('task:')
}

/**
 * Task drags (chunk 63, Day-7 #4): a drop counts only when the POINTER is
 * inside a subcategory header (`subdrop:<id>`, SubcategoryHeader). Anywhere
 * else — the other category's column, a section body, a gap — resolves to no
 * target, so the drop is a no-op and the row returns. Other drags (the
 * subcategory sortable reorder) keep `rectIntersection`, the dnd-kit default
 * they have always used.
 */
export const taskDragCollision: CollisionDetection = (args) => {
  if (!isTaskDragId(args.active.id)) return rectIntersection(args)
  return pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      String(c.id).startsWith('subdrop:'),
    ),
  })
}
