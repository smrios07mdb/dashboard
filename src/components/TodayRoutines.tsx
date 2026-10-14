import { useId, useMemo, useState } from 'react'

import { ChevronDown } from '@/components/icons'
import RoutinePanel from '@/components/RoutinePanel'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useRoutines } from '@/state/useRoutines'

/*
 * Routines inside Today (chunk 78): the Morning and Night checklists as an
 * optional, collapsible block. It replaces the Routines tab.
 *
 * The header counts today's checked items over today's live items (`Add`
 * when there are none), so the data loads with the block, collapsed or not.
 * Collapsed by default; the open state is per viewer in localStorage and
 * falls back to collapsed when storage is unavailable.
 *
 * In the stacked and rail Today layouts it sits at the bottom of the Today
 * panel (`TodayPanel`'s `routines` slot). With Today as a banner or off, the
 * Dashboard renders it on its own, `standalone`, with its own card.
 */

const OPEN_KEY = 'hup:todayRoutinesOpen'

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function storeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Storage blocked: the state still holds for this visit.
  }
}

export default function TodayRoutines({
  standalone = false,
}: {
  /** Own card chrome, for when there is no Today panel to sit in. */
  standalone?: boolean
}) {
  const { user } = useSession()
  const r = useRoutines(user?.id ?? null)
  const [open, setOpen] = useState(loadOpen)
  const bodyId = useId()

  const counts = useMemo(() => {
    const live = r.items.filter((i) => !i.archivedAt)
    const checked = new Set(
      r.logs
        .filter((l) => l.dateKey === r.todayKey && l.completed)
        .map((l) => l.routineItemId),
    )
    return { live: live.length, checked: live.filter((i) => checked.has(i.id)).length }
  }, [r.items, r.logs, r.todayKey])

  function toggle() {
    const next = !open
    setOpen(next)
    storeOpen(next)
  }

  const panel = (routine: 'morning' | 'night') => (
    <RoutinePanel
      routine={routine}
      items={r.items}
      logs={r.logs}
      todayKey={r.todayKey}
      onToggle={r.onToggle}
      onCreate={(label) => r.onCreate(routine, label)}
      onRename={r.onRename}
      onArchive={r.onArchive}
      onReorder={(ids) => void r.reorderByIds(routine, ids)}
      onMove={(id, dir) => r.onMove(routine, id, dir)}
    />
  )

  return (
    <section
      className={cn(
        standalone
          ? 'rounded-md border border-line bg-surface px-[18px] py-3 shadow-md'
          : 'mt-3.5 border-t border-line pt-2.5',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex min-h-9 w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="label">Routines</span>
        <span className="ml-auto font-mono text-[12px] text-ink-3">
          {r.loading ? '' : counts.live === 0 ? 'Add' : `${counts.checked}/${counts.live}`}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn('text-ink-3 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={bodyId} className="mt-2 flex flex-col gap-4 pb-1">
          {panel('morning')}
          {panel('night')}
        </div>
      )}
    </section>
  )
}
