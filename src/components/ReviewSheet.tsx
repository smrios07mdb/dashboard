import { useEffect, useRef, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Category, Subcategory, Task } from '@/db/types'
import { REVIEW_SETTLE_MS } from '@/lib/review'
import { taskAge } from '@/lib/taskAge'
import { cn } from '@/lib/utils'

/*
 * The weekly review walk (chunk 74 — UX audit #10): one old task at a time,
 * Keep / Add to Today / Delete.
 *
 * The candidates are snapshotted when the sheet opens, so nothing it does
 * (adding a task to Today takes it out of the live candidates) reorders or
 * shrinks the walk. "Add to Today" is written at once. Deletes are only
 * collected: every close hands the ids to `onClose`, and the Dashboard runs
 * them through the chunk-72 Undo — while this modal is open sonner's Undo
 * toast cannot be clicked.
 *
 * The walk advances in place, so the same button sits under the pointer for
 * the next task. After every advance the buttons ignore activations for
 * `REVIEW_SETTLE_MS`, and the later clicks of a multi-click at any time
 * (chunk 74a): one click acts on one task.
 */

const BUTTON =
  'min-h-11 rounded-md border border-line bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

type ReviewSheetProps = {
  open: boolean
  /** The live candidates; read once per open. */
  candidates: Task[]
  categories: Category[]
  subcategories: Subcategory[]
  timeZone: string
  onToggleToday: (id: string, force?: boolean) => void
  /** Called exactly once per close, with the ids marked for delete. */
  onClose: (deleteIds: string[]) => void
}

type Walk = {
  tasks: Task[]
  index: number
  kept: number
  added: number
  deleteIds: string[]
}

function startWalk(tasks: Task[]): Walk {
  return { tasks, index: 0, kept: 0, added: 0, deleteIds: [] }
}

export default function ReviewSheet({
  open,
  candidates,
  categories,
  subcategories,
  timeZone,
  onToggleToday,
  onClose,
}: ReviewSheetProps) {
  const [walk, setWalk] = useState<Walk>(() => startWalk(candidates))
  const settleUntil = useRef<number>(0)
  // Re-snapshot on each open ("adjust state during render", prompts/README).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setWalk(startWalk(candidates))
  }
  // A fresh sheet acts on its first activation. In an effect, not the branch
  // above: a ref cannot be written during render (react-hooks/refs).
  useEffect(() => {
    if (open) settleUntil.current = 0
  }, [open])

  const task = walk.tasks[walk.index] as Task | undefined

  /** True when this activation should act (chunk 74a). */
  const ready = (e: React.MouseEvent) =>
    e.detail <= 1 && Date.now() >= settleUntil.current

  const keep = () => {
    setWalk((w) => ({ ...w, index: w.index + 1, kept: w.kept + 1 }))
    settleUntil.current = Date.now() + REVIEW_SETTLE_MS
  }
  const addToToday = (id: string) => {
    onToggleToday(id, true)
    setWalk((w) => ({ ...w, index: w.index + 1, added: w.added + 1 }))
    settleUntil.current = Date.now() + REVIEW_SETTLE_MS
  }
  const markDelete = (id: string) => {
    setWalk((w) => ({
      ...w,
      index: w.index + 1,
      deleteIds: [...w.deleteIds, id],
    }))
    settleUntil.current = Date.now() + REVIEW_SETTLE_MS
  }

  let where = ''
  if (task) {
    const sub = subcategories.find((s) => s.id === task.subcategoryId)
    const cat = sub && categories.find((c) => c.id === sub.categoryId)
    where = [
      [cat?.name, sub?.name].filter(Boolean).join(' › '),
      taskAge(task.createdAt, timeZone)?.long,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose(walk.deleteIds)
      }}
    >
      <DialogContent className="gap-3">
        <DialogTitle className="label text-[10px] font-medium leading-normal tracking-[0.16em]">
          Review
        </DialogTitle>
        <DialogDescription className="sr-only">
          Keep, plan or delete each old task.
        </DialogDescription>
        {task ? (
          <>
            <p className="label m-0">
              {walk.index + 1} of {walk.tasks.length}
            </p>
            <p className="m-0 break-words text-[16px] leading-snug text-ink">
              {task.title}
            </p>
            <p className="m-0 text-[13px] text-ink-3">{where}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={(e) => {
                  if (ready(e)) keep()
                }}
                className={BUTTON}
              >
                Keep
              </button>
              <button
                type="button"
                onClick={(e) => {
                  if (ready(e)) addToToday(task.id)
                }}
                className={BUTTON}
              >
                Add to Today
              </button>
              <button
                type="button"
                onClick={(e) => {
                  if (ready(e)) markDelete(task.id)
                }}
                className={cn(BUTTON, 'text-destructive')}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="m-0 text-[14px] text-ink">
              Done — {walk.kept} kept · {walk.added} added to Today ·{' '}
              {walk.deleteIds.length} deleted
            </p>
            <div className="pt-1">
              <button
                type="button"
                autoFocus
                onClick={(e) => {
                  if (ready(e)) onClose(walk.deleteIds)
                }}
                className={BUTTON}
              >
                Done
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
