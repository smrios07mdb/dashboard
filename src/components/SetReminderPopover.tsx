import { useEffect, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { browserTimezone, loadUserTimezone } from '@/lib/userTimezone'
import { cn } from '@/lib/utils'
import { zonedWallToDate } from '@/lib/zonedTime'

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
 * scope.
 *
 * Value contract (chunk 61):
 *   - Input value uses the HTML5 format `YYYY-MM-DDTHH:mm`, read as a
 *     wall-clock time in `settings.timezone` (resolved by
 *     `loadUserTimezone`; browser zone if settings are unreadable).
 *   - On save, we convert that wall time to an ISO string (UTC) for
 *     storage.
 *   - On open, an existing remindAt is rendered back as a wall time in
 *     `settings.timezone`, once the zone has resolved.
 *
 * Until the zone resolves the input and Save are disabled; when it
 * differs from the device's zone a `Times in <zone>` line says so.
 *
 * Empty input is "no time selected" — Save is disabled. Clear is
 * available whenever the task already has a reminder, regardless of
 * current input.
 *
 * Chunk 71: `trigger` is optional. TaskRow passes the reminder when-chip
 * when the row shows one; otherwise (⋯ → "Set reminder…") the popover
 * anchors to a zero-size span in its own grid slot, like PriorityPicker's
 * menu-only entry.
 */

export type SetReminderPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing reminder as ISO string, or null if none set. */
  remindAt: string | null
  /** The button that anchors + toggles the popover. Omit for an invisible anchor. */
  trigger?: React.ReactNode
  onSave: (isoTimestamp: string) => void | Promise<void>
  onClear: () => void | Promise<void>
  /** Passed to the content: where focus goes on close (TaskRow, chunk 77a). */
  onCloseAutoFocus?: (e: Event) => void
}

/** ISO → "YYYY-MM-DDTHH:mm" wall time in `tz` (the datetime-local format). */
// eslint-disable-next-line react-refresh/only-export-components -- exported for the unit tests (chunk 61)
export function toZonedInputValue(iso: string | null, tz: string): string {
  if (!iso) return ''
  if (Number.isNaN(new Date(iso).getTime())) return ''
  return formatInTimeZone(iso, tz, "yyyy-MM-dd'T'HH:mm")
}

/**
 * "YYYY-MM-DDTHH:mm" wall time in `tz` → ISO string. Null on invalid input.
 * A repeated wall time (a fall-back) is its earlier instant; a skipped one (a
 * spring-forward gap) is shifted forward by the gap (chunk 82).
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for the unit tests (chunk 61)
export function fromZonedInputValue(s: string, tz: string): string | null {
  if (!s) return null
  return zonedWallToDate(s, tz)?.toISOString() ?? null
}

export default function SetReminderPopover({
  open,
  onOpenChange,
  remindAt,
  trigger,
  onSave,
  onClear,
  onCloseAutoFocus,
}: SetReminderPopoverProps) {
  const [value, setValue] = useState<string>('')
  // `settings.timezone` for this open; null until `loadUserTimezone` resolves.
  const [tz, setTz] = useState<string | null>(null)
  // Reset-on-open: same prevOpen pattern as chunk-8 dialogs. The value
  // is emptied here and filled from remindAt once the zone resolves.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    setValue('')
    setTz(null)
  }

  const remindAtRef = useRef(remindAt)
  useEffect(() => {
    remindAtRef.current = remindAt
  }, [remindAt])

  // Bumped on every open/close so a resolution from an earlier open is dropped.
  const openSeq = useRef(0)
  useEffect(() => {
    const seq = ++openSeq.current
    if (!open) return
    void loadUserTimezone().then((resolved) => {
      if (openSeq.current !== seq) return
      setTz(resolved)
      setValue(toZonedInputValue(remindAtRef.current, resolved))
    })
  }, [open])

  const iso = tz ? fromZonedInputValue(value, tz) : null
  const saveDisabled = !iso
  const showZone = tz !== null && tz !== browserTimezone()

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
      {trigger ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : (
        // Menu-only entry: anchor to a zero-size span in the reminder slot.
        // -ml-3 cancels the grid gap the extra column adds while the popover
        // is open (PriorityPicker's idiom).
        <PopoverAnchor asChild>
          <span aria-hidden className="-ml-3 w-0" />
        </PopoverAnchor>
      )}
      <PopoverContent
        className="w-72 space-y-3"
        align="end"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="label">Reminder</div>
        {showZone && (
          <div className="text-[11px] text-ink-3">Times in {tz}</div>
        )}
        <input
          type="datetime-local"
          value={value}
          disabled={tz === null}
          aria-busy={tz === null ? true : undefined}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Reminder date and time"
          aria-invalid={value.length > 0 && !iso ? true : undefined}
          className={cn(
            'w-full rounded-sm border border-border bg-background px-2 py-1 text-base sm:text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
