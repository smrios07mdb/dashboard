import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import AddTaskInline from '@/components/AddTaskInline'
import SubcategoryHeader from '@/components/SubcategoryHeader'
import TaskRow from '@/components/TaskRow'
import type { Category, Subcategory, Task } from '@/db/types'
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
  const incomplete = tasks.filter((t) => !t.completedAt)
  const completed = tasks.filter((t) => !!t.completedAt)
  const minutes = incomplete.reduce((sum, t) => sum + t.estimateMinutes, 0)

  return (
    <section className="border-t border-border first:border-t-0">
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
          <div className="border-t border-border px-4 py-3 text-[12px] italic text-muted-foreground">
            No tasks here.
          </div>
        ) : incomplete.length === 0 && completed.length > 0 && !showCompleted ? (
          <div className="border-t border-border px-4 py-3 text-[12px] italic text-muted-foreground">
            All done. {completed.length} completed.
          </div>
        ) : (
          incomplete.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
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
        {completed.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowCompleted((s) => !s)}
              aria-expanded={showCompleted}
              className="label flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-3 transition-transform',
                  showCompleted && 'rotate-180',
                )}
              />
              {showCompleted ? 'Hide completed' : `${completed.length} completed`}
            </button>
            {showCompleted &&
              completed.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
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
