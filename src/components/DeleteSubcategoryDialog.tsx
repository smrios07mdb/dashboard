import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Subcategory } from '@/db/types'
import { cn } from '@/lib/utils'

/*
 * Controlled dialog for subcategory deletion. Three internal flows:
 *
 *   - No tasks               → single destructive confirm → archive
 *   - Has tasks, no others   → cascade-delete-only confirm → archive
 *                              (no "move to" target available)
 *   - Has tasks + others     → radio between Move to <picker> and
 *                              Delete tasks too → confirm
 *
 * DeleteConfirm.tsx (chunk 7) handles only the simple
 * trigger+title+description+confirm shape — this dialog needs internal
 * state (selected action, target id), so it owns its own AlertDialog
 * wiring directly.
 *
 * Default focus is Cancel (AlertDialog default), which matches the
 * chunk-7 destructive-confirm precedent.
 */

export type DeleteSubcategoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  subcategory: Subcategory
  /** Total tasks belonging to this subcategory (any completion state). */
  taskCount: number
  /** Other non-archived subs in the same category — for the move picker. */
  otherSubsInCategory: Subcategory[]
  onConfirm: (
    options: { moveToId?: string; cascadeDelete?: boolean },
  ) => void | Promise<void>
}

type Action = 'move' | 'cascade'

export default function DeleteSubcategoryDialog({
  open,
  onOpenChange,
  subcategory,
  taskCount,
  otherSubsInCategory,
  onConfirm,
}: DeleteSubcategoryDialogProps) {
  const hasTasks = taskCount > 0
  const hasOthers = otherSubsInCategory.length > 0
  const defaultAction: Action = hasOthers ? 'move' : 'cascade'
  const [action, setAction] = useState<Action>(defaultAction)
  const [moveToId, setMoveToId] = useState<string>(
    otherSubsInCategory[0]?.id ?? '',
  )
  // Adjust-state-during-render pattern: when `open` transitions from
  // false to true, reset the radio + picker to fresh defaults so a
  // prior session's selection doesn't bleed into the new invocation.
  // (React 19's set-state-in-effect lint rule pushes us away from
  // useEffect for this — see React docs on storing prev props.)
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setAction(defaultAction)
      setMoveToId(otherSubsInCategory[0]?.id ?? '')
    }
  }

  const confirmDisabled = hasTasks && action === 'move' && !moveToId
  const confirmLabel = !hasTasks
    ? 'Delete'
    : action === 'move'
    ? 'Move tasks and delete'
    : 'Delete tasks and subcategory'
  const isDestructive = !hasTasks || action === 'cascade'

  async function handleConfirm() {
    if (confirmDisabled) return
    if (!hasTasks) {
      await onConfirm({})
    } else if (action === 'move') {
      await onConfirm({ moveToId })
    } else {
      await onConfirm({ cascadeDelete: true })
    }
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete &ldquo;{subcategory.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {!hasTasks
              ? 'This subcategory has no tasks. This cannot be undone.'
              : hasOthers
                ? `This subcategory has ${taskCount} task${taskCount === 1 ? '' : 's'}. What should happen to them?`
                : `This subcategory has ${taskCount} task${taskCount === 1 ? '' : 's'}. No other subcategories are available to move them to.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasTasks && hasOthers && (
          <div className="space-y-3 py-1">
            <label className="flex items-start gap-3 rounded-sm border border-border bg-background p-3 hover:bg-secondary/40">
              <input
                type="radio"
                name="delete-subcategory-action"
                value="move"
                checked={action === 'move'}
                onChange={() => setAction('move')}
                className="mt-1"
                aria-label="Move tasks to another subcategory"
              />
              <div className="flex flex-1 flex-col gap-2">
                <span className="text-[13px] font-medium text-foreground">
                  Move them to…
                </span>
                <select
                  value={moveToId}
                  onChange={(e) => setMoveToId(e.target.value)}
                  disabled={action !== 'move'}
                  aria-label="Target subcategory"
                  className="w-full rounded-sm border border-border bg-background px-2 py-1 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {otherSubsInCategory.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-sm border border-border bg-background p-3 hover:bg-secondary/40">
              <input
                type="radio"
                name="delete-subcategory-action"
                value="cascade"
                checked={action === 'cascade'}
                onChange={() => setAction('cascade')}
                className="mt-1"
                aria-label="Delete the tasks too"
              />
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[13px] font-medium text-destructive">
                  Delete the tasks too
                </span>
                <span className="text-[12px] text-muted-foreground">
                  This cannot be undone.
                </span>
              </div>
            </label>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirmDisabled}
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
            className={cn(
              isDestructive &&
                'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
