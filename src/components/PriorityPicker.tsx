import { Check } from 'lucide-react'

import PriorityChip, { type PriorityValue } from '@/components/PriorityChip'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/*
 * Three-option priority picker (chunk 33). Architecture mirrors
 * SetReminderPopover: open state is owned by TaskRow, which gives the
 * popover two entry points — tapping the row's chip (the trigger) and
 * TaskMenu → "Set priority…" (opens programmatically).
 *
 * When the task has no priority there is no chip to anchor on, so the
 * caller omits `trigger` and a zero-size PopoverAnchor renders in the
 * chip's grid slot instead. TaskRow only mounts this component while a
 * chip is visible or the picker is open, so the empty anchor never
 * lingers in the layout.
 *
 * "Clear priority" (→ null) shows only when a priority is set, per the
 * handoff. Null means "no priority": no chip, sorts after P3.
 */

const OPTIONS: { value: PriorityValue; name: string; desc: string }[] = [
  { value: 1, name: 'Urgent', desc: 'Needs to happen today' },
  { value: 2, name: 'Soon', desc: 'This week' },
  { value: 3, name: 'Whenever', desc: 'No pressure' },
]

export type PriorityPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  priority: PriorityValue | null
  /**
   * The chip button that anchors + toggles the popover. Omit when the
   * task has no visible chip (menu-only entry) — an invisible anchor is
   * rendered in its place.
   */
  trigger?: React.ReactNode
  onPick: (priority: PriorityValue | null) => void | Promise<void>
}

export default function PriorityPicker({
  open,
  onOpenChange,
  priority,
  trigger,
  onPick,
}: PriorityPickerProps) {
  async function pick(value: PriorityValue | null) {
    await onPick(value)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : (
        // Menu-only entry: nothing visible to anchor on, so anchor to a
        // zero-size span in the chip slot. -ml-3 cancels the grid gap the
        // extra column would otherwise add while the popover is open.
        <PopoverAnchor asChild>
          <span aria-hidden className="-ml-3 w-0" />
        </PopoverAnchor>
      )}
      <PopoverContent className="w-56 p-1" align="end">
        <div className="label px-2.5 pb-1 pt-1.5 text-[9px]">Priority</div>
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => void pick(opt.value)}
            className="grid w-full grid-cols-[30px_1fr_auto] items-center gap-2 rounded-sm px-2.5 py-2 text-left hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PriorityChip priority={opt.value} />
            <span>
              <span className="block text-[13px] font-medium leading-tight text-ink">
                {opt.name}
              </span>
              <span className="block text-[11px] leading-tight text-ink-3">
                {opt.desc}
              </span>
            </span>
            {priority === opt.value && (
              <Check
                aria-hidden
                className="size-3.5 text-[var(--accent-ink)]"
              />
            )}
          </button>
        ))}
        {priority !== null && (
          <button
            type="button"
            onClick={() => void pick(null)}
            className="mt-0.5 w-full rounded-sm border-t border-line px-2.5 py-2 text-left text-[12px] text-ink-3 hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear priority
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
