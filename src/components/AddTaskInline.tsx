import { useRef, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/*
 * Inline "+ Add task" affordance shown at the bottom of each
 * subcategory section.
 *
 * Closed state: a single ghost "+ New task" button.
 * Open state: title input + minutes input + Add button. Enter on the
 * title submits. Escape closes. On successful create, the form stays
 * open with title cleared, minutes reset to the default, and focus
 * returned to the title input — matches the chunk-7 prompt's "focus
 * moves to title for next task entry" requirement.
 *
 * Validation: empty title is rejected silently (Enter is a no-op,
 * the title input shows aria-invalid + a red border). Toasts are
 * reserved for completed mutations.
 */

const DEFAULT_MINUTES = 30
const MAX_MINUTES = 24 * 60

function isValidMinutesString(s: string): boolean {
  if (!/^\d+$/.test(s.trim())) return false
  const n = Number(s)
  return Number.isInteger(n) && n >= 0 && n <= MAX_MINUTES
}

export type AddTaskInlineProps = {
  /**
   * Called when the user submits a valid task. Should resolve to true
   * if the create succeeded (so we can clear + refocus) or false on
   * failure (so we leave the form populated for retry).
   */
  onCreate: (input: {
    title: string
    estimateMinutes: number
  }) => Promise<boolean>
}

export default function AddTaskInline({ onCreate }: AddTaskInlineProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES))
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement | null>(null)

  const trimmedTitle = title.trim()
  const titleInvalid = trimmedTitle.length === 0
  const minutesInvalid = !isValidMinutesString(minutes)
  const disabled = submitting || titleInvalid || minutesInvalid

  function reset(opts: { keepOpen: boolean }) {
    setTitle('')
    setMinutes(String(DEFAULT_MINUTES))
    if (opts.keepOpen) {
      // Microtask so React commits the cleared state before we focus.
      queueMicrotask(() => titleRef.current?.focus())
    } else {
      setOpen(false)
    }
  }

  async function submit() {
    if (disabled) return
    setSubmitting(true)
    try {
      const ok = await onCreate({
        title: trimmedTitle,
        estimateMinutes: Number(minutes),
      })
      if (ok) reset({ keepOpen: true })
    } finally {
      setSubmitting(false)
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void submit()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          queueMicrotask(() => titleRef.current?.focus())
        }}
        className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3.5" aria-hidden />
        New task
      </button>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          reset({ keepOpen: false })
        }
      }}
      className="grid items-center gap-2 border-t border-border px-3 py-2 [grid-template-columns:1fr_72px_auto]"
    >
      <Input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task"
        aria-label="New task title"
        aria-invalid={titleInvalid || undefined}
        className={cn(
          'h-8 bg-background px-2 py-1 text-[13px]',
          titleInvalid &&
            title.length > 0 &&
            'border-destructive focus-visible:ring-destructive',
        )}
      />
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_MINUTES}
        step={5}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        aria-label="Estimate minutes"
        aria-invalid={minutesInvalid || undefined}
        className={cn(
          'h-8 bg-background px-2 py-1 text-right font-mono text-[12px] tabular-nums',
          minutesInvalid &&
            'border-destructive focus-visible:ring-destructive',
        )}
      />
      <Button
        type="submit"
        size="sm"
        disabled={disabled}
        className="h-8 px-3 text-[12px]"
      >
        {submitting ? 'Adding…' : 'Add'}
      </Button>
    </form>
  )
}
