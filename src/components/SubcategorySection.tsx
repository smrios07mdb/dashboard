import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import AddTaskInline from '@/components/AddTaskInline'
import SubcategoryHeader from '@/components/SubcategoryHeader'
import TaskRow from '@/components/TaskRow'
import type { Category, Subcategory, Task } from '@/db/types'
import { subColor } from '@/lib/gamify'
import { cn } from '@/lib/utils'

/*
 * One subcategory section inside a category column.
 *
 * Chunk 8 extracted the header into SubcategoryHeader; this section is
 * now mostly a thin shell around the header + task list + add-task
 * inline. The section receives `dragHandleProps` from CategoryColumn's
 * sortable wrapper and forwards them to SubcategoryHeader so the grip
 * icon there carries the drag listeners.
 *
 * Tasks render incomplete-only by default; a "N COMPLETED" expander
 * reveals the completed rows in-place. The filter lives here, not in
 * the repo — completed tasks still need to load so the expander has
 * something to show.
 */

export type SubcategorySectionProps = {
  subcategory: Subcategory
  allCategories: Category[]
  allSubcategories: Subcategory[]
  tasks: Task[]
  otherSubsInCategory: Subcategory[]
  canMoveUp: boolean
  canMoveDown: boolean
  isTouch: boolean
  dragHandleProps?: {
    attributes: Record<string, unknown>
    listeners: Record<string, unknown>
  }
  onDrillDown: (id: string) => void
  onCreateTask: (input: {
    subcategoryId: string
    title: string
    estimateMinutes: number
  }) => Promise<boolean>
  onCompleteTask: (id: string, completed: boolean) => void | Promise<void>
  onEditTitle: (id: string, title: string) => void | Promise<void>
  onEditMinutes: (id: string, minutes: number) => void | Promise<void>
  onDeleteTask: (id: string) => void | Promise<void>
  onMoveTaskToSubcategory: (
    taskId: string,
    targetSubcategoryId: string,
  ) => void | Promise<void>
  onSetTaskReminder: (
    id: string,
    remindAt: string | null,
  ) => void | Promise<void>
  onEditTaskNotes: (id: string, notes: string | null) => void | Promise<void>
  onRenameSubcategory: (id: string, name: string) => void | Promise<void>
  onDeleteSubcategory: (
    id: string,
    options: { moveToId?: string; cascadeDelete?: boolean },
  ) => void | Promise<void>
  onMergeSubcategory: (
    sourceId: string,
    targetId: string,
  ) => void | Promise<void>
  onMoveSubcategory: (id: string, direction: 'up' | 'down') => void
}

export default function SubcategorySection({
  subcategory,
  allCategories,
  allSubcategories,
  tasks,
  otherSubsInCategory,
  canMoveUp,
  canMoveDown,
  isTouch,
  dragHandleProps,
  onDrillDown,
  onCreateTask,
  onCompleteTask,
  onEditTitle,
  onEditMinutes,
  onDeleteTask,
  onMoveTaskToSubcategory,
  onSetTaskReminder,
  onEditTaskNotes,
  onRenameSubcategory,
  onDeleteSubcategory,
  onMergeSubcategory,
  onMoveSubcategory,
}: SubcategorySectionProps) {
  const [showCompleted, setShowCompleted] = useState(false)
  const hue = subColor(subcategory.id)
  const incomplete = tasks.filter((t) => !t.completedAt)
  const completed = tasks.filter((t) => !!t.completedAt)
  const minutes = incomplete.reduce((sum, t) => sum + t.estimateMinutes, 0)

  // Just-completed "linger": when a task flips to done, hold its id in a Set
  // for ~1.1s so it stays in the visible list and its rowFlush + "+XP"
  // floater can play, before it drops into the collapsed "N completed"
  // bucket. Without this the row leaves the incomplete list instantly and the
  // celebration never renders. Timers intentionally aren't cleaned up on
  // re-render — each must fire to release its own id (clearing them on a
  // later `tasks` change would strand a row in the lingering state).
  const [linger, setLinger] = useState<Set<string>>(() => new Set())
  const prevTasks = useRef(tasks)
  const lingerTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    const prevById = new Map(prevTasks.current.map((t) => [t.id, t]))
    const newlyDone = tasks.filter(
      (t) => t.completedAt && prevById.get(t.id) && !prevById.get(t.id)!.completedAt,
    )
    prevTasks.current = tasks
    if (newlyDone.length === 0) return
    setLinger((s) => {
      const next = new Set(s)
      newlyDone.forEach((t) => next.add(t.id))
      return next
    })
    newlyDone.forEach((t) => {
      const timer = setTimeout(() => {
        setLinger((s) => {
          const next = new Set(s)
          next.delete(t.id)
          return next
        })
      }, 1100)
      lingerTimers.current.push(timer)
    })
  }, [tasks])
  // Clear only still-pending linger timers on unmount (section collapsed,
  // reordered, deleted/merged, or navigated away mid-linger). Deliberately
  // NOT cleared on a `tasks` change — each timer must fire to release its own
  // id, or a row would be stranded in the lingering state. The array is only
  // ever pushed to (never reassigned), so the captured reference stays live;
  // clearing an already-fired timer is a harmless no-op.
  useEffect(() => {
    const timers = lingerTimers.current
    return () => timers.forEach(clearTimeout)
  }, [])

  // Rows shown in the main list: open tasks + any lingering just-completed
  // ones. The collapsed bucket excludes lingerers so a row never shows twice.
  // A task that completed since the previous render: keep it visible THIS
  // render (don't wait for `linger` to catch up next tick) so its TaskRow
  // instance is never unmounted across open→done. Otherwise the remount trips
  // TaskRow's mount guard and the completion cheer (flush/+XP/pop) never fires.
  // `prevTasks.current` is written only in the linger effect (post-commit), so
  // during THIS render it still holds the previous render's tasks — the read
  // that catches the open→done transition before the row would unmount and trip
  // TaskRow's mount guard. The read is safe (the ref is never written during
  // render); react-hooks/refs flags this legitimate compare-to-previous-render
  // idiom, and moving it to an effect would reintroduce the dead-cheer bug.
  const justCompletedIds = new Set(
    tasks
      .filter(
        // eslint-disable-next-line react-hooks/refs
        (t) =>
          t.completedAt &&
          prevTasks.current.some((p) => p.id === t.id && !p.completedAt),
      )
      .map((t) => t.id),
  )
  const visibleIncomplete = tasks.filter(
    (t) => !t.completedAt || linger.has(t.id) || justCompletedIds.has(t.id),
  )
  const bucketCompleted = completed.filter(
    (t) => !linger.has(t.id) && !justCompletedIds.has(t.id),
  )

  return (
    <section className="border-t border-line first:border-t-0">
      <SubcategoryHeader
        subcategory={subcategory}
        incompleteCount={incomplete.length}
        incompleteMinutes={minutes}
        taskCount={tasks.length}
        otherSubsInCategory={otherSubsInCategory}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        isTouch={isTouch}
        dragHandleProps={dragHandleProps}
        onDrillDown={onDrillDown}
        onRename={(name) => onRenameSubcategory(subcategory.id, name)}
        onDeleteSubcategory={onDeleteSubcategory}
        onMergeSubcategory={onMergeSubcategory}
        onMoveUp={() => onMoveSubcategory(subcategory.id, 'up')}
        onMoveDown={() => onMoveSubcategory(subcategory.id, 'down')}
      />
      <div>
        {tasks.length === 0 ? (
          <div className="border-t border-line px-4 py-3 text-[12px] italic text-ink-3">
            No tasks here.
          </div>
        ) : visibleIncomplete.length === 0 && completed.length > 0 && !showCompleted ? (
          <div className="border-t border-line px-4 py-3 text-[12px] italic text-ink-3">
            All done. {completed.length} completed.
          </div>
        ) : (
          visibleIncomplete.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              hue={hue}
              categories={allCategories}
              subcategories={allSubcategories}
              onComplete={onCompleteTask}
              onEditTitle={onEditTitle}
              onEditMinutes={onEditMinutes}
              onDelete={onDeleteTask}
              onMoveToSubcategory={onMoveTaskToSubcategory}
              onSetReminder={onSetTaskReminder}
              onEditNotes={onEditTaskNotes}
            />
          ))
        )}
        {bucketCompleted.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowCompleted((s) => !s)}
              aria-expanded={showCompleted}
              className="label flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-ink-3 transition-colors hover:bg-bg-alt/60 hover:text-ink"
            >
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-3 transition-transform',
                  showCompleted && 'rotate-180',
                )}
              />
              {showCompleted ? 'Hide completed' : `${bucketCompleted.length} completed`}
            </button>
            {showCompleted &&
              bucketCompleted.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  hue={hue}
                  categories={allCategories}
                  subcategories={allSubcategories}
                  onComplete={onCompleteTask}
                  onEditTitle={onEditTitle}
                  onEditMinutes={onEditMinutes}
                  onDelete={onDeleteTask}
                  onMoveToSubcategory={onMoveTaskToSubcategory}
                  onSetReminder={onSetTaskReminder}
                  onEditNotes={onEditTaskNotes}
                />
              ))}
          </>
        )}
        <AddTaskInline
          onCreate={({ title, estimateMinutes }) =>
            onCreateTask({
              subcategoryId: subcategory.id,
              title,
              estimateMinutes,
            })
          }
        />
      </div>
    </section>
  )
}
