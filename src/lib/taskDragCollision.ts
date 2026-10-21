import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'

/** `useDraggable` ids for tasks are `task:<uuid>` (TaskRow). */
export function isTaskDragId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('task:')
}

/**
 * The screens' task-move handler. `viaDrag` only lets a drop and ⋯ → Move to…
 * read the same at the call site; it changes nothing (chunk 88).
 */
export type MoveTaskFn = (
  taskId: string,
  targetSubcategoryId: string,
  opts?: { viaDrag?: boolean },
) => void | Promise<void>

/** The `useSortable` container a droppable or the active drag belongs to. */
function sortableContainer(data: unknown): unknown {
  return (data as { sortable?: { containerId?: unknown } } | undefined)
    ?.sortable?.containerId
}

/**
 * Task drags (chunk 63): a drop counts only when the POINTER is inside a
 * list's `subdrop:<id>` droppable — since chunk 88 the whole list section
 * (SubcategorySection), across both Dashboard columns. Anywhere else (a gap,
 * a category header, between columns) resolves to no target, so the drop is
 * a no-op and the row returns.
 *
 * Other drags (the subcategory sortable reorder) keep `rectIntersection`, but
 * only over their own `subs:<categoryId>` container (chunk 88): with one
 * DndContext over both columns, a list could otherwise reorder into the
 * other category.
 */
export const taskDragCollision: CollisionDetection = (args) => {
  if (!isTaskDragId(args.active.id)) {
    const own = sortableContainer(args.active.data?.current)
    return rectIntersection({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => sortableContainer(c.data?.current) === own,
      ),
    })
  }
  return pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      String(c.id).startsWith('subdrop:'),
    ),
  })
}

/**
 * The move a drop asks for (chunk 88): a `task:` drag released over another
 * list's `subdrop:` target. Its own list, no target, or a list drag → null.
 */
export function resolveTaskDrop(
  event: DragEndEvent,
): { taskId: string; toSubId: string } | null {
  const { active, over } = event
  if (!over || !isTaskDragId(active.id)) return null
  const from = active.data.current as
    | { taskId?: string; currentSubcategoryId?: string }
    | undefined
  const to = over.data.current as
    | { type?: string; subcategoryId?: string }
    | undefined
  const taskId = from?.taskId
  const toSubId = to?.subcategoryId
  if (!taskId || !toSubId || to?.type !== 'subcategory') return null
  if (toSubId === from?.currentSubcategoryId) return null
  return { taskId, toSubId }
}
