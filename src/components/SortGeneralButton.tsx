import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSyncStore } from '@/db/syncStore'
import type { RoutingProposal } from '@/lib/sorting'
import { runSort } from '@/lib/sortGeneral'
import { cn } from '@/lib/utils'

/*
 * Sort General on demand (chunk 90, ARCHITECTURE.md §10). Shown in the hero's
 * chip slot when nothing is pending, a key is saved and a General list holds
 * an open task. Lazy, with lib/sortGeneral, so the eager bundle carries only
 * the visibility check. Online-only.
 */

type SortGeneralButtonProps = {
  /** A press produced proposals: show them; run `done` when the sheet closes. */
  onSorted: (r: { rows: RoutingProposal[]; done: () => void }) => void
}

export default function SortGeneralButton({ onSorted }: SortGeneralButtonProps) {
  const navigate = useNavigate()
  // lib/network mirrors navigator.onLine into the sync store.
  const offline = useSyncStore((s) => s.state) === 'offline'
  const [sorting, setSorting] = useState(false)

  function press() {
    setSorting(true)
    runSort(navigate)
      .then((r) => r && onSorted(r))
      .finally(() => setSorting(false))
  }

  return (
    <>
      <button
        type="button"
        disabled={offline || sorting}
        onClick={press}
        // `cn`, not a bare string: without it Rollup splits `clsx` into its
        // own eager chunk, about 200 B more eager JS (chunk-90 budget).
        className={cn(
          'min-h-8 rounded-full border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-bg-alt disabled:opacity-50',
        )}
      >
        {sorting ? 'Sorting…' : 'Sort General'}
      </button>
      {offline && <span className="text-[12.5px] text-ink-3">Needs a connection</span>}
    </>
  )
}
