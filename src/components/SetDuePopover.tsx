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
 * Due-date picker (chunk 66, Day-7 #11). A native `<input type="date">` in a
 * shadcn Popover. Open state is owned by TaskRow, which has two entries
 * (chunk 71): the row's due when-chip, passed as `trigger`, and TaskMenu →
 * "Set due date…". With no trigger the popover anchors to a zero-size span
 * in its own grid slot, exactly like PriorityPicker's menu-only entry.
 *
 * Value contract:
 *   - A due date is a calendar day in `settings.timezone` (resolved by
 *     `loadUserTimezone`, as the reminder picker does). It is stored as the
 *     instant of 00:00 on that day in that zone.
 *   - On open, an existing `dueAt` is shown as its day in that zone, so a
 *     due date imported with a time of day still opens on the right day.
 *
 * Until the zone resolves the input and Save are disabled; when it differs
 * from the device's zone a `Dates in <zone>` line says so. Clear shows only
 * when the task already has a due date.
 */

export type SetDuePopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing due date as an ISO string, or null if none set. */
  dueAt: string | null
  /** The button that anchors + toggles the popover. Omit for an invisible anchor. */
  trigger?: React.ReactNode
  onSave: (isoTimestamp: string) => void | Promise<void>
  onClear: () => void | Promise<void>
  /** Passed to the content: where focus goes on close (TaskRow, chunk 77a). */
  onCloseAutoFocus?: (e: Event) => void
}

/** ISO → "YYYY-MM-DD", its calendar day in `tz` (the date-input format). */
// eslint-disable-next-line react-refresh/only-export-components -- exported for the unit tests (chunk 66)
export function toDueInputValue(iso: string | null, tz: string): string {
  if (!iso) return ''
  if (Number.isNaN(new Date(iso).getTime())) return ''
  return formatInTimeZone(iso, tz, 'yyyy-MM-dd')
}

/**
 * "YYYY-MM-DD" → ISO of 00:00 on that day in `tz`. Null on invalid input. On a
 * day with no 00:00 (a skipped midnight) this is the day's first instant.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for the unit tests (chunk 66)
export function fromDueInputValue(s: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return zonedWallToDate(`${s}T00:00`, tz)?.toISOString() ?? null
}

export default function SetDuePopover({
  open,
  onOpenChange,
  dueAt,
  trigger,
  onSave,
  onClear,
  onCloseAutoFocus,
}: SetDuePopoverProps) {
  const [value, setValue] = useState<string>('')
  // `settings.timezone` for this open; null until `loadUserTimezone` resolves.
  const [tz, setTz] = useState<string | null>(null)
  // Reset-on-open: the same prevOpen pattern as SetReminderPopover.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    setValue('')
    setTz(null)
  }

  const dueAtRef = useRef(dueAt)
  useEffect(() => {
    dueAtRef.current = dueAt
  }, [dueAt])

  // Bumped on every open/close so a resolution from an earlier open is dropped.
  const openSeq = useRef(0)
  useEffect(() => {
    const seq = ++openSeq.current
    if (!open) return
    void loadUserTimezone().then((resolved) => {
      if (openSeq.current !== seq) return
      setTz(resolved)
      setValue(toDueInputValue(dueAtRef.current, resolved))
    })
  }, [open])

  const iso = tz ? fromDueInputValue(value, tz) : null
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
        // Menu-only entry: anchor to a zero-size span in the due slot. -ml-3
        // cancels the grid gap the extra column adds while the popover is
        // open (PriorityPicker's idiom).
        <PopoverAnchor asChild>
          <span aria-hidden className="-ml-3 w-0" />
        </PopoverAnchor>
      )}
      <PopoverContent
        className="w-64 space-y-3"
        align="end"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="label">Due date</div>
        {showZone && (
          <div className="text-[11px] text-ink-3">Dates in {tz}</div>
        )}
        <input
          type="date"
          value={value}
          disabled={tz === null}
          aria-busy={tz === null ? true : undefined}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Due date"
          aria-invalid={value.length > 0 && !iso ? true : undefined}
          className={cn(
            'w-full rounded-sm border border-border bg-background px-2 py-1 text-base sm:text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value.length > 0 &&
              !iso &&
              'border-destructive focus-visible:ring-destructive',
          )}
        />
        <div className="flex items-center justify-end gap-2">
          {dueAt && (
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
            disabled={!iso}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
