import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/*
 * Notes editor for a task. Uses shadcn Dialog (not AlertDialog) — this
 * is content authoring, not a destructive confirm. The project's
 * convention since chunk 8 is: AlertDialog for destructive flows,
 * Dialog for content edits.
 *
 * Reset-on-open uses the chunk-8 prevOpen pattern (compare during
 * render) instead of useEffect to dodge React 19's set-state-in-effect
 * lint rule and to avoid the realtime-during-edit clobber that
 * chunk 7's draft-or-null sidesteps for TaskRow.
 *
 * Notes are nullable in the schema (ARCH §4). Empty draft is valid —
 * Save persists `null` for an empty string so we don't store the
 * literal "" and a future `WHERE notes IS NOT NULL` query stays
 * truthful.
 */

export type EditNotesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskTitle: string
  /** Current notes value as stored on the task; null if unset. */
  notes: string | null
  onSave: (notes: string | null) => void | Promise<void>
}

export default function EditNotesDialog({
  open,
  onOpenChange,
  taskTitle,
  notes,
  onSave,
}: EditNotesDialogProps) {
  const [draft, setDraft] = useState<string>(notes ?? '')
  const [saving, setSaving] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setDraft(notes ?? '')
  }

  async function handleSave() {
    setSaving(true)
    try {
      const trimmed = draft.trim()
      await onSave(trimmed.length === 0 ? null : draft)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit notes</DialogTitle>
          <DialogDescription>
            Notes for &ldquo;{taskTitle}&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          aria-label="Task notes"
          placeholder="Anything to remember about this task…"
          className="w-full rounded-sm border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
