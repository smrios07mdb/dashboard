import { createPortal } from 'react-dom'
import { DragOverlay, useDndContext } from '@dnd-kit/core'

import { subColor } from '@/lib/gamify'
import { isTaskDragId } from '@/lib/taskDragCollision'

/*
 * What a task drag shows under the pointer (chunk 88, D4): the list's hue dot
 * and the title on one line. It renders through `DragOverlay`, so a row
 * dragged out of its column is never clipped by the card's `overflow-hidden`.
 */

const MAX_WIDTH = 420

export default function TaskDragGhost({
  title,
  subcategoryId,
  width,
}: {
  title: string
  subcategoryId: string
  /** The source row's width at drag start; capped at 420 px. */
  width: number
}) {
  const hue = subColor(subcategoryId)
  return (
    <div
      data-testid="task-drag-ghost"
      className="flex cursor-grabbing items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2 shadow-md"
      style={{ width: Math.min(width, MAX_WIDTH) }}
    >
      <span
        aria-hidden
        data-hue-dot
        className="size-[9px] shrink-0 rounded-[3px]"
        style={{ background: hue }}
      />
      <span className="min-w-0 truncate text-[14px] text-ink">{title}</span>
    </div>
  )
}

/**
 * Mount once inside a screen's DndContext. Renders the ghost only for task
 * drags (list reorders keep their own sortable transform). Portalled to
 * `body`: `.category-cols` is a size container, which would become the
 * containing block of the overlay's `position: fixed` and offset it.
 */
export function TaskDragOverlay() {
  const { active, activeNodeRect } = useDndContext()
  if (!active || !isTaskDragId(active.id)) return null
  const data = active.data.current as
    | { title?: string; subcategoryId?: string }
    | undefined
  return createPortal(
    <DragOverlay dropAnimation={null}>
      <TaskDragGhost
        title={data?.title ?? ''}
        subcategoryId={data?.subcategoryId ?? ''}
        width={activeNodeRect?.width ?? MAX_WIDTH}
      />
    </DragOverlay>,
    document.body,
  )
}
