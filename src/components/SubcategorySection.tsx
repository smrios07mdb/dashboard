import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import AddTaskInline from '@/components/AddTaskInline'
import TaskRow from '@/components/TaskRow'
import type { Subcategory, Task } from '@/db/types'
import { cn } from '@/lib/utils'

/*
 * One subcategory section inside a category column.
 *
 * Header shows the subcategory name + open-task count + sum of
 * incomplete `estimateMinutes`. Chevron is the canonical drill-down
 * affordance (ARCHITECTURE §13); double-click on the header is the
 * desktop accelerator.
 *
 * Tasks render incomplete-only by default; a "N COMPLETED" expander
 * reveals the completed rows in-place. The filter lives here, not in
 * the repo — completed tasks still need to load so the expander has
 * something to show.
 *
 * AddTaskInline sits at the bottom of the section.
 */

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export type SubcategorySectionProps = {
  subcategory: Subcategory
  tasks: Task[]
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
}

export default function SubcategorySection({
  subcategory,
  tasks,
  onDrillDown,
  onCreateTask,
  onCompleteTask,
  onEditTitle,
  onEditMinutes,
  onDeleteTask,
}: SubcategorySectionProps) {
  const [showCompleted, setShowCompleted] = useState(false)
  const incomplete = tasks.filter((t) => !t.completedAt)
  const completed = tasks.filter((t) => !!t.completedAt)
  const minutes = incomplete.reduce((sum, t) => sum + t.estimateMinutes, 0)

  return (
    <section className="border-t border-border first:border-t-0">
      <header
        role="button"
        tabIndex={0}
        onDoubleClick={() => onDrillDown(subcategory.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onDrillDown(subcategory.id)
          }
        }}
        className="grid cursor-pointer items-center gap-2 px-3 py-3 hover:bg-secondary/40 [grid-template-columns:1fr_auto_auto_auto]"
      >
        <span className="text-[14px] font-medium text-foreground">
          {subcategory.name}
        </span>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {incomplete.length}
        </span>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {formatMinutes(minutes)}
        </span>
        <button
          type="button"
          aria-label={`Open ${subcategory.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onDrillDown(subcategory.id)
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[16px] leading-none text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>›</span>
        </button>
      </header>
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
              onComplete={onCompleteTask}
              onEditTitle={onEditTitle}
              onEditMinutes={onEditMinutes}
              onDelete={onDeleteTask}
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
                  onComplete={onCompleteTask}
                  onEditTitle={onEditTitle}
                  onEditMinutes={onEditMinutes}
                  onDelete={onDeleteTask}
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
