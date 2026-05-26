import { useRef, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/*
 * Inline "+ Add subcategory" affordance shown at the bottom of each
 * category column. Mirrors AddTaskInline: closed state shows a single
 * ghost button; open state shows the name input + Add button.
 *
 * On successful create, the form stays open with the input cleared and
 * focus back in the field so several can be added in sequence.
 *
 * Validation is silent (aria-invalid + Enter is a no-op on empty).
 * Escape closes. Toast belongs to the parent on a successful create.
 */

export type AddSubcategoryInlineProps = {
  /**
   * Resolves true on a successful create so the form clears + refocuses;
   * false leaves the populated input alone so the user can retry.
   */
  onCreate: (input: { name: string }) => Promise<boolean>
}

export default function AddSubcategoryInline({
  onCreate,
}: AddSubcategoryInlineProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const trimmed = name.trim()
  const invalid = trimmed.length === 0
  const disabled = submitting || invalid

  function reset(opts: { keepOpen: boolean }) {
    setName('')
    if (opts.keepOpen) {
      queueMicrotask(() => inputRef.current?.focus())
    } else {
      setOpen(false)
    }
  }

  async function submit() {
    if (disabled) return
    setSubmitting(true)
    try {
      const ok = await onCreate({ name: trimmed })
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
          queueMicrotask(() => inputRef.current?.focus())
        }}
        className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3.5" aria-hidden />
        Add subcategory
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
      className="grid items-center gap-2 border-t border-border px-3 py-2 [grid-template-columns:1fr_auto]"
    >
      <Input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New subcategory"
        aria-label="New subcategory name"
        aria-invalid={invalid && name.length > 0 ? true : undefined}
        className={cn(
          'h-8 bg-background px-2 py-1 text-[13px]',
          invalid &&
            name.length > 0 &&
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
