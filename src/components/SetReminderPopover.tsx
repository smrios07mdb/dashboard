import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/*
 * Native datetime-local picker wrapped in a shadcn Popover.
 *
 * Per the chunk-9 prompt: write `remindAt` only. Actual notification
 * delivery is chunk 14 (Edge Function + Web Push); this surface just
 * captures the timestamp.
 *
 * Native `<input type="datetime-local">` was chosen over react-day-
 * picker or a custom widget because Safari (desktop + iOS) and
 * Chrome/Firefox all render a usable picker out of the box. The cost
 * of adding a JS picker library wouldn't pay for itself at chunk-9
 * scope. If chunk 14 surfaces UX gaps (e.g. timezone confusion or
 * iOS-Safari quirks), revisit then.
 *
 * Value contract:
 *   - Input value uses the local-time HTML5 format `YYYY-MM-DDTHH:mm`.
 *   - On save, we convert to an ISO string (UTC) for storage.
 *   - On open, an existing remindAt is rendered back in local form.
 *
 * Empty input is "no time selected" — Save is disabled. Clear is
 * available whenever the task already has a reminder, regardless of
 * current input.
 */

export type SetReminderPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing reminder as ISO string, or null if none set. */
  remindAt: string | null
  trigger: React.ReactNode
  onSave: (isoTimestamp: string) => void | Promise<void>
  onClear: () => void | Promise<void>
}

/** ISO → "YYYY-MM-DDTHH:mm" in local TZ (the datetime-local format). */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** "YYYY-MM-DDTHH:mm" (local) → ISO string. Returns null on invalid input. */
function fromLocalInputValue(s: string): string | null {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export default function SetReminderPopover({
  open,
  onOpenChange,
  remindAt,
  trigger,
  onSave,
  onClear,
}: SetReminderPopoverProps) {
  const [value, setValue] = useState<string>(() => toLocalInputValue(remindAt))
  // Reset-on-open: same prevOpen pattern as chunk-8 dialogs so the
  // input mirrors the task's current remindAt each time the popover
  // opens, without an effect.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setValue(toLocalInputValue(remindAt))
  }

  const iso = fromLocalInputValue(value)
  const saveDisabled = !iso

  async function handleSave() {
    if (!iso) return
    await onSave(iso)
    onOpenChange(false)
  }

  async function handleClear() {
    await onClear()
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <div className="label">Reminder</div>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Reminder date and time"
          aria-invalid={value.length > 0 && !iso ? true : undefined}
          className={cn(
            'w-full rounded-sm border border-border bg-background px-2 py-1 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value.length > 0 &&
              !iso &&
              'border-destructive focus-visible:ring-destructive',
          )}
        />
        <div className="flex items-center justify-end gap-2">
          {remindAt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleClear()}
              className="mr-auto"
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saveDisabled}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
