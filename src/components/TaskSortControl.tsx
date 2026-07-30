import { ArrowUpDown } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  TASK_SORT_OPTIONS,
  type TaskSortKey,
} from '@/lib/taskSort'
import { cn } from '@/lib/utils'

/*
 * Compact list-sort control (chunk 33). A `.label`-style trigger showing
 * the active key (`SORT · PRIORITY`) opening a 3-option radio menu —
 * Dashboard column headers and both drill-down headers all mount this
 * against the same global preference (lib/taskSort).
 *
 * Trigger chrome mirrors the chunk-31 sort button on SubcategoryView
 * (bordered mono uppercase pill) so the two drill-downs stay visually
 * consistent.
 */

export type TaskSortControlProps = {
  value: TaskSortKey
  onChange: (key: TaskSortKey) => void
  className?: string
}

export default function TaskSortControl({
  value,
  onChange,
  className,
}: TaskSortControlProps) {
  const active = TASK_SORT_OPTIONS.find((o) => o.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Sort tasks — currently by ${active?.label ?? 'priority'}`}
          // Headers that double as click/drill targets mount this inside
          // them; keep the click from bubbling into the drill handler.
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3 hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <ArrowUpDown aria-hidden className="size-3" />
          Sort · {active?.label ?? 'Priority'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as TaskSortKey)}
        >
          {TASK_SORT_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
