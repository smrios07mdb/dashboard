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

/*
 * Controlled merge dialog. Pick a target subcategory, confirm; the
 * caller fans out into bulk-update + archive via repo.
 *
 * If the source subcategory has zero tasks the body still surfaces
 * "Move 0 tasks…" but the operation is allowed — merge effectively
 * archives the (empty) source and is a no-op for tasks.
 *
 * The dialog assumes there is at least one merge target. If a
 * subcategory has no peers, SubcategoryHeader disables the "Merge
 * into…" menu item before it ever reaches here.
 */

export type MergeSubcategoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  subcategory: Subcategory
  taskCount: number
  otherSubsInCategory: Subcategory[]
  onConfirm: (targetId: string) => void | Promise<void>
}

export default function MergeSubcategoryDialog({
  open,
  onOpenChange,
  subcategory,
  taskCount,
  otherSubsInCategory,
  onConfirm,
}: MergeSubcategoryDialogProps) {
  const [targetId, setTargetId] = useState<string>(
    otherSubsInCategory[0]?.id ?? '',
  )
  // Adjust-state-during-render pattern (see DeleteSubcategoryDialog):
  // reset the target picker when the dialog reopens so a stale id from
  // the prior session doesn't carry over.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setTargetId(otherSubsInCategory[0]?.id ?? '')
  }

  const targetSub = otherSubsInCategory.find((s) => s.id === targetId)
  const targetName = targetSub?.name ?? ''
  const taskLabel = `${taskCount} task${taskCount === 1 ? '' : 's'}`

  async function handleConfirm() {
    if (!targetId) return
    await onConfirm(targetId)
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Merge &ldquo;{subcategory.name}&rdquo; into…
          </AlertDialogTitle>
          <AlertDialogDescription>
            {targetName
              ? `Move ${taskLabel} from "${subcategory.name}" to "${targetName}" and archive "${subcategory.name}".`
              : 'Choose a target subcategory.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-1">
          <label className="flex flex-col gap-2">
            <span className="label">Target</span>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              aria-label="Target subcategory"
              className="w-full rounded-sm border border-border bg-background px-2 py-1 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {otherSubsInCategory.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!targetId}
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
          >
            Merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
