import { Fragment, useState, type ReactNode } from 'react'

import { Check, ChevronRight, Unlink } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Note, Task } from '@/db/types'
import { catColor } from '@/lib/cat'
import { subColor } from '@/lib/gamify'
import type { NoteContext } from '@/lib/notes'
import { cn } from '@/lib/utils'

/*
 * Attach picker (chunk 58, D8): Work / Personal → list → "Attach to this
 * list" or one of its tasks. A stepped Dialog with 44px rows and a tappable
 * breadcrumb, not `MoveToPicker`'s dropdown cascade — hover-opened submenus
 * and 32px rows fail on touch (DESIGN_NOTES).
 *
 * Only non-archived lists are offered. Completed tasks are struck and muted
 * but still pickable. A task may hold many notes, so there is no conflict
 * case: picking always attaches.
 */

export type AttachTarget =
  | { kind: 'task'; id: string; name: string }
  | { kind: 'subcategory'; id: string; name: string }

type AttachPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  note: Note
  /** Every note — for the `N NOTES` label on tasks that already hold some. */
  notes: Note[]
  ctx: NoteContext
  /** `null` = Detach. */
  onPick: (target: AttachTarget | null) => void
}

function PickRow({
  onClick,
  right,
  muted,
  children,
}: {
  onClick: () => void
  right?: ReactNode
  muted?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-[14px] transition-colors hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        muted ? 'text-ink-3' : 'text-ink',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5 truncate">
        {children}
      </span>
      {right}
    </button>
  )
}

/** Open tasks first, then completed; oldest first within each. */
function byOpenThenCreated(a: Task, b: Task): number {
  const done = Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt))
  return done || a.createdAt.localeCompare(b.createdAt)
}

export default function AttachPicker({
  open,
  onOpenChange,
  note,
  notes,
  ctx,
  onPick,
}: AttachPickerProps) {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null)

  const liveSubs = ctx.subcategories.filter((s) => !s.archivedAt)

  // Reset on open, pre-navigated to where the note is attached (React-19
  // adjust-state-during-render — prompts/README).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      const task = note.taskId
        ? ctx.tasks.find((t) => t.id === note.taskId)
        : undefined
      const at = liveSubs.find(
        (s) => s.id === (task ? task.subcategoryId : note.subcategoryId),
      )
      setCategoryId(at?.categoryId ?? null)
      setSubcategoryId(at?.id ?? null)
    }
  }

  const category = ctx.categories.find((c) => c.id === categoryId) ?? null
  const sub = liveSubs.find((s) => s.id === subcategoryId) ?? null
  const attached = note.taskId !== null || note.subcategoryId !== null

  const crumbs: { label: string; onClick?: () => void }[] = [
    {
      label: 'Attach to',
      onClick: () => {
        setCategoryId(null)
        setSubcategoryId(null)
      },
    },
  ]
  if (category) {
    crumbs.push({ label: category.name, onClick: () => setSubcategoryId(null) })
  }
  if (category && sub) crumbs.push({ label: sub.name })

  const check = (
    <Check aria-label="Current attachment" size={15} className="shrink-0 text-[hsl(var(--accent))]" />
  )
  const chevron = <ChevronRight aria-hidden size={15} className="shrink-0 text-ink-4" />

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] gap-0 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-1.5 pr-6 text-[15px] font-semibold leading-normal">
            {crumbs.map((c, i) => (
              <Fragment key={c.label}>
                {i > 0 && (
                  <ChevronRight aria-hidden size={13} className="text-ink-4" />
                )}
                {c.onClick && i < crumbs.length - 1 ? (
                  <button
                    type="button"
                    onClick={c.onClick}
                    className="-my-2 rounded-sm py-2 font-medium text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.label}
                  </button>
                ) : (
                  <span>{c.label}</span>
                )}
              </Fragment>
            ))}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a list or a task to attach this note to.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 mt-3">
          {!category &&
            ctx.categories.map((c) => (
              <PickRow
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                right={chevron}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: catColor(c.name) }}
                />
                {c.name}
              </PickRow>
            ))}

          {category &&
            !sub &&
            liveSubs
              .filter((s) => s.categoryId === category.id)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((s) => (
                <PickRow
                  key={s.id}
                  onClick={() => setSubcategoryId(s.id)}
                  right={note.subcategoryId === s.id ? check : chevron}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      background: subColor(s.id),
                      boxShadow: `0 0 0 3px color-mix(in srgb, ${subColor(s.id)} 18%, transparent)`,
                    }}
                  />
                  <span className="truncate">{s.name}</span>
                </PickRow>
              ))}

          {category && sub && (
            <>
              <PickRow
                onClick={() =>
                  onPick({ kind: 'subcategory', id: sub.id, name: sub.name })
                }
                right={note.subcategoryId === sub.id ? check : undefined}
              >
                <span className="font-semibold">
                  {note.subcategoryId === sub.id
                    ? 'Attached to this list'
                    : 'Attach to this list'}
                </span>
              </PickRow>
              <div className="label truncate px-3 pb-1 pt-3">
                Or a task in {sub.name}
              </div>
              {ctx.tasks
                .filter((t) => t.subcategoryId === sub.id)
                .sort(byOpenThenCreated)
                .map((t) => {
                  const count = notes.filter(
                    (n) => n.taskId === t.id && n.id !== note.id,
                  ).length
                  return (
                    <PickRow
                      key={t.id}
                      onClick={() =>
                        onPick({ kind: 'task', id: t.id, name: t.title })
                      }
                      muted={Boolean(t.completedAt)}
                      right={
                        note.taskId === t.id ? (
                          check
                        ) : count > 0 ? (
                          <span className="label shrink-0">
                            {count} {count === 1 ? 'note' : 'notes'}
                          </span>
                        ) : undefined
                      }
                    >
                      <span
                        className={cn(
                          'truncate',
                          t.completedAt && 'line-through',
                        )}
                      >
                        {t.title}
                      </span>
                    </PickRow>
                  )
                })}
            </>
          )}
        </div>

        {attached && (
          <div className="mt-3.5 flex items-center justify-between gap-2.5 border-t border-line pt-3">
            <span className="text-[12px] text-ink-3">
              Detaching keeps the note as freeform.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onPick(null)}
            >
              <Unlink aria-hidden />
              Detach
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
