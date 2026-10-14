import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { repo } from '@/db/repo'
import { useUIStore } from '@/state/uiStore'

/*
 * Settings → Data → Archived items (chunk 86, D5). Mounted only while open:
 * it reads `repo.data.archivedCounts()` on mount, and Remove runs
 * `repo.data.purgeArchived()`, which re-reads what to delete server-side and
 * keeps every list that still holds a task or a note. Lazy, so the eager
 * Settings bundle carries only the row and its button.
 */

const PURGE_ERROR = 'Could not remove archived items. Try again.'

type ArchivedCounts = { routineItems: number; lists: number; listsKept: number }

export default function ArchivedItemsDialog({ onClose }: { onClose: () => void }) {
  const [counts, setCounts] = useState<ArchivedCounts | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    repo.data
      .archivedCounts()
      .then((c) => {
        if (!cancelled) setCounts(c)
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Archived counts failed', e)
        toast.error(PURGE_ERROR)
        onClose()
      })
    return () => {
      cancelled = true
    }
    // Load once per open; `onClose` identity does not matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onConfirm() {
    setBusy(true)
    try {
      const res = await repo.data.purgeArchived()
      toast(`Removed ${res.lists} lists and ${res.routineItems} routine items`)
      useUIStore.getState().forceDashboardRefresh()
      onClose()
    } catch (e) {
      console.error('Purge archived failed', e)
      toast.error(PURGE_ERROR)
      setBusy(false)
    }
  }

  const nothing = counts !== null && counts.lists + counts.routineItems === 0

  return (
    <AlertDialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove archived items</AlertDialogTitle>
          <AlertDialogDescription>
            {counts === null
              ? 'Counting…'
              : nothing
                ? 'Nothing to remove.'
                : `Remove ${counts.lists} archived lists and ${counts.routineItems} archived routine items?${
                    counts.listsKept > 0
                      ? ` ${counts.listsKept} archived lists that still hold tasks or notes are kept.`
                      : ''
                  } This can't be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Stay open until the purge settles; onConfirm closes it.
              e.preventDefault()
              void onConfirm()
            }}
            disabled={counts === null || nothing || busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? 'Removing…' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
