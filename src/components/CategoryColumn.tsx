import SubcategorySection from '@/components/SubcategorySection'
import type { Category, Subcategory, Task } from '@/db/types'

/*
 * One category column on the dashboard ("Work" or "Personal").
 *
 * Renders the category header with totals plus a card listing each
 * subcategory section. Hands every task-mutation callback down to
 * SubcategorySection unchanged — Dashboard owns the handlers.
 */

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export type CategoryColumnProps = {
  category: Category
  subcategories: Subcategory[]
  tasksBySub: Record<string, Task[]>
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

export default function CategoryColumn({
  category,
  subcategories,
  tasksBySub,
  onDrillDown,
  onCreateTask,
  onCompleteTask,
  onEditTitle,
  onEditMinutes,
  onDeleteTask,
}: CategoryColumnProps) {
  const allTasks = subcategories.flatMap((s) => tasksBySub[s.id] ?? [])
  const open = allTasks.filter((t) => !t.completedAt)
  const total = open.reduce((sum, t) => sum + t.estimateMinutes, 0)
  const accent = category.name === 'Work' ? 'var(--work)' : 'var(--personal)'

  return (
    <div>
      <header
        role="button"
        tabIndex={0}
        onDoubleClick={() => onDrillDown(category.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onDrillDown(category.id)
          }
        }}
        className="mb-3 grid cursor-pointer items-baseline gap-3 pb-3 [grid-template-columns:4px_1fr_auto_auto_auto]"
      >
        <span
          aria-hidden
          className="mt-2 h-7 w-[4px] self-stretch rounded-sm"
          style={{ background: accent }}
        />
        <h2
          className="m-0 text-[24px] font-semibold text-foreground"
          style={{ letterSpacing: '-0.025em' }}
        >
          {category.name}
        </h2>
        <span className="label">{open.length} open</span>
        <span className="font-mono text-[16px] font-medium text-secondary-foreground tabular-nums">
          {formatMinutes(total)}
        </span>
        <button
          type="button"
          aria-label={`Open ${category.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onDrillDown(category.id)
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-[20px] leading-none text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>›</span>
        </button>
      </header>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {subcategories.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            No subcategories yet.
          </div>
        ) : (
          subcategories.map((sub) => (
            <SubcategorySection
              key={sub.id}
              subcategory={sub}
              tasks={tasksBySub[sub.id] ?? []}
              onDrillDown={onDrillDown}
              onCreateTask={onCreateTask}
              onCompleteTask={onCompleteTask}
              onEditTitle={onEditTitle}
              onEditMinutes={onEditMinutes}
              onDeleteTask={onDeleteTask}
            />
          ))
        )}
      </div>
    </div>
  )
}
