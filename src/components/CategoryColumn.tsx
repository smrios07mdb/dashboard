import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import AddSubcategoryInline from '@/components/AddSubcategoryInline'
import SubcategorySection from '@/components/SubcategorySection'
import type { Category, Subcategory, Task } from '@/db/types'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'

/*
 * One category column on the dashboard ("Work" or "Personal").
 *
 * Renders the category header with totals plus a card listing each
 * subcategory section. Chunk 8 adds:
 *   - DndContext + SortableContext scoped per column (within-category
 *     reorder only; cross-category drag is chunk 9's job)
 *   - AddSubcategoryInline at the bottom of the column
 *   - Per-sub touch/desktop reorder fallbacks via the header's menu
 *
 * Subcategories arrive already-filtered (Dashboard drops archived rows
 * before passing them down). Tasks belonging to subs that aren't in the
 * incoming list are dropped here as a defensive filter so an in-flight
 * archive doesn't leave orphan rows briefly visible.
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
  onCreateSubcategory: (input: {
    categoryId: string
    name: string
  }) => Promise<boolean>
  onRenameSubcategory: (id: string, name: string) => void | Promise<void>
  onDeleteSubcategory: (
    id: string,
    options: { moveToId?: string; cascadeDelete?: boolean },
  ) => void | Promise<void>
  onMergeSubcategory: (
    sourceId: string,
    targetId: string,
  ) => void | Promise<void>
  onReorderSubcategories: (
    categoryId: string,
    orderedIds: string[],
  ) => void | Promise<void>
  onMoveSubcategory: (id: string, direction: 'up' | 'down') => void
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
  onCreateSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  onMergeSubcategory,
  onReorderSubcategories,
  onMoveSubcategory,
}: CategoryColumnProps) {
  const isTouch = useIsTouchDevice()

  const allTasks = subcategories.flatMap((s) => tasksBySub[s.id] ?? [])
  const open = allTasks.filter((t) => !t.completedAt)
  const total = open.reduce((sum, t) => sum + t.estimateMinutes, 0)
  const accent = category.name === 'Work' ? 'var(--work)' : 'var(--personal)'

  // 5px activation distance prevents accidental drags from clicks on
  // the grip handle. Touch sensor stays inert because the handle is
  // hidden on touch devices.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  )

  const subIds = subcategories.map((s) => s.id)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = subIds.indexOf(String(active.id))
    const newIndex = subIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...subIds]
    const [moved] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, moved)
    void onReorderSubcategories(category.id, next)
  }

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
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={subIds}
              strategy={verticalListSortingStrategy}
            >
              {subcategories.map((sub, index) => (
                <SortableSubSection
                  key={sub.id}
                  subcategory={sub}
                  tasks={tasksBySub[sub.id] ?? []}
                  otherSubsInCategory={subcategories.filter(
                    (s) => s.id !== sub.id,
                  )}
                  canMoveUp={index > 0}
                  canMoveDown={index < subcategories.length - 1}
                  isTouch={isTouch}
                  onDrillDown={onDrillDown}
                  onCreateTask={onCreateTask}
                  onCompleteTask={onCompleteTask}
                  onEditTitle={onEditTitle}
                  onEditMinutes={onEditMinutes}
                  onDeleteTask={onDeleteTask}
                  onRenameSubcategory={onRenameSubcategory}
                  onDeleteSubcategory={onDeleteSubcategory}
                  onMergeSubcategory={onMergeSubcategory}
                  onMoveSubcategory={onMoveSubcategory}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
        <AddSubcategoryInline
          onCreate={({ name }) =>
            onCreateSubcategory({ categoryId: category.id, name })
          }
        />
      </div>
    </div>
  )
}

type SortableSubSectionProps = {
  subcategory: Subcategory
  tasks: Task[]
  otherSubsInCategory: Subcategory[]
  canMoveUp: boolean
  canMoveDown: boolean
  isTouch: boolean
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

function SortableSubSection({
  subcategory,
  ...rest
}: SortableSubSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subcategory.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <SubcategorySection
        subcategory={subcategory}
        dragHandleProps={{
          attributes: attributes as unknown as Record<string, unknown>,
          listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
        }}
        {...rest}
      />
    </div>
  )
}
