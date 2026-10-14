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
import type { Category, Subcategory } from '@/db/types'
import { cn } from '@/lib/utils'

/*
 * Controlled dialog for deleting a list (chunk 87, UX audit #4). It decides by
 * the list's OPEN tasks:
 *
 *   - No open tasks → one plain destructive confirm → archive. Completed
 *                     tasks stay with the archived list (history).
 *   - Open tasks    → radio between Move them to… (any live list, any
 *                     category), Mark them done, and Delete them → confirm.
 *
 * What each choice does with completed rows lives in `lib/deleteList`.
 *
 * DeleteConfirm.tsx (chunk 7) handles only the simple
 * trigger+title+description+confirm shape — this dialog needs internal
 * state (selected action, target id), so it owns its own AlertDialog
 * wiring directly.
 *
 * Default focus is Cancel (AlertDialog default), which matches the
 * chunk-7 destructive-confirm precedent.
 */

/** What to do with the list's tasks; `none` when it has no open ones. */
export type DeleteListChoice =
  | { kind: 'none' }
  | { kind: 'move'; toId: string }
  | { kind: 'complete' }
  | { kind: 'delete' }

export type DeleteSubcategoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  subcategory: Subcategory
  /** Open tasks in this list. */
  openCount: number
  /** Completed tasks in this list (any age). */
  doneCount: number
  /** Every live list except this one, in any category — the move picker. */
  targets: Subcategory[]
  categories: Category[]
  onConfirm: (choice: DeleteListChoice) => void | Promise<void>
}

type Action = 'move' | 'complete' | 'delete'

/** Targets grouped by category: this list's own first, then `categories` order. */
function groupTargets(
  targets: Subcategory[],
  categories: Category[],
  ownCategoryId: string,
): { category: Category; subs: Subcategory[] }[] {
  const ordered = [
    ...categories.filter((c) => c.id === ownCategoryId),
    ...categories.filter((c) => c.id !== ownCategoryId),
  ]
  return ordered
    .map((category) => ({
      category,
      subs: targets
        .filter((s) => s.categoryId === category.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((g) => g.subs.length > 0)
}

const plural = (n: number) => (n === 1 ? '' : 's')

export default function DeleteSubcategoryDialog({
  open,
  onOpenChange,
  subcategory,
  openCount,
  doneCount,
  targets,
  categories,
  onConfirm,
}: DeleteSubcategoryDialogProps) {
  const hasOpen = openCount > 0
  const groups = groupTargets(targets, categories, subcategory.categoryId)
  const defaultTargetId = groups[0]?.subs[0]?.id ?? ''
  const canMove = defaultTargetId !== ''
  const defaultAction: Action = canMove ? 'move' : 'complete'
  const [action, setAction] = useState<Action>(defaultAction)
  const [moveToId, setMoveToId] = useState<string>(defaultTargetId)
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
      setMoveToId(defaultTargetId)
    }
  }

  const confirmDisabled = hasOpen && action === 'move' && !moveToId
  const confirmLabel = !hasOpen
    ? 'Delete'
    : action === 'move'
      ? 'Move and delete list'
      : action === 'complete'
        ? 'Mark done and delete list'
        : 'Delete tasks and list'
  const isDestructive = !hasOpen || action === 'delete'

  async function handleConfirm() {
    if (confirmDisabled) return
    if (!hasOpen) await onConfirm({ kind: 'none' })
    else if (action === 'move') await onConfirm({ kind: 'move', toId: moveToId })
    else await onConfirm({ kind: action })
    onOpenChange(false)
  }

  const card =
    'flex items-start gap-3 rounded-sm border border-border bg-background p-3 hover:bg-secondary/40'

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete &ldquo;{subcategory.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasOpen
              ? `This list has ${openCount} open task${plural(openCount)}. What should happen to them?`
              : `This list has no open tasks.${
                  doneCount > 0
                    ? doneCount === 1
                      ? ' Its 1 completed task stays in your history.'
                      : ` Its ${doneCount} completed tasks stay in your history.`
                    : ''
                } This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasOpen && (
          <div className="space-y-3 py-1">
            {canMove && (
              <label className={card}>
                <input
                  type="radio"
                  name="delete-subcategory-action"
                  value="move"
                  checked={action === 'move'}
                  onChange={() => setAction('move')}
                  className="mt-1"
                  aria-label="Move them to…"
                />
                <div className="flex flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-foreground">
                    Move them to…
                  </span>
                  <select
                    value={moveToId}
                    onChange={(e) => setMoveToId(e.target.value)}
                    disabled={action !== 'move'}
                    aria-label="Target list"
                    className="w-full rounded-sm border border-border bg-background px-2 py-1 text-base sm:text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {groups.map(({ category, subs }) => (
                      <optgroup key={category.id} label={category.name}>
                        {subs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </label>
            )}
            <label className={card}>
              <input
                type="radio"
                name="delete-subcategory-action"
                value="complete"
                checked={action === 'complete'}
                onChange={() => setAction('complete')}
                className="mt-1"
                aria-label="Mark them done"
              />
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[13px] font-medium text-foreground">
                  Mark them done
                </span>
                <span className="text-[12px] text-muted-foreground">
                  They&rsquo;ll show in Insights.
                </span>
              </div>
            </label>
            <label className={card}>
              <input
                type="radio"
                name="delete-subcategory-action"
                value="delete"
                checked={action === 'delete'}
                onChange={() => setAction('delete')}
                className="mt-1"
                aria-label="Delete them"
              />
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[13px] font-medium text-destructive">
                  Delete them
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
