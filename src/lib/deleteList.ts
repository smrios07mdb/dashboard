/*
 * Deleting a list (chunk 87, UX audit #4): one helper for the Dashboard and
 * CategoryView. The task step for the user's choice runs first; the list is
 * archived only after it resolves, so a failed step archives nothing.
 *
 * Completed tasks:
 *   - move     → open and completed tasks move to the target.
 *   - complete → open tasks get one `completedAt`; completed ones stay with
 *                the archived list.
 *   - delete   → open and completed tasks are deleted.
 *   - none     → completed tasks stay with the archived list.
 *
 * No per-task Undo: the list is archived in the same step, so restoring a
 * task would land it in an archived list. Open tasks that arrive after the
 * dialog opened are covered: `tasks` is read at confirm time, and anything
 * that still slips past surfaces in the Recovered card.
 */
import { repo } from '@/db/repo'
import type { Subcategory, Task } from '@/db/types'
import type { DeleteListChoice } from '@/components/DeleteSubcategoryDialog'

export type DeleteListResult = {
  archived: Subcategory
  updated: Task[]
  deletedIds: string[]
}

export async function deleteList(
  id: string,
  choice: DeleteListChoice,
  tasks: Task[],
): Promise<DeleteListResult> {
  const rows = tasks.filter((t) => t.subcategoryId === id)
  let updated: Task[] = []
  let deletedIds: string[] = []

  if (choice.kind === 'move' && rows.length > 0) {
    updated = await repo.tasks.bulkUpdate(
      rows.map((t) => ({ id: t.id, patch: { subcategoryId: choice.toId } })),
    )
  } else if (choice.kind === 'complete') {
    const open = rows.filter((t) => !t.completedAt)
    if (open.length > 0) {
      const completedAt = new Date().toISOString()
      updated = await repo.tasks.bulkUpdate(
        open.map((t) => ({ id: t.id, patch: { completedAt } })),
      )
    }
  } else if (choice.kind === 'delete' && rows.length > 0) {
    deletedIds = rows.map((t) => t.id)
    await repo.tasks.bulkDelete(deletedIds)
  }

  const archived = await repo.subcategories.archive(id)
  return { archived, updated, deletedIds }
}

/** The toast after each choice. */
export const DELETE_LIST_TOAST: Record<DeleteListChoice['kind'], string> = {
  move: 'Tasks moved, list deleted',
  complete: 'Tasks marked done, list deleted',
  delete: 'List and tasks deleted',
  none: 'List deleted',
}
