import { ArrowRight } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { Note } from '@/db/types'
import { noteExcerpt, noteFirstLine, noteRel } from '@/lib/notes'

/*
 * Block action sheet (chunk 37, D6/D7) — the touch + keyboard equivalent
 * of the desktop hover row: [Move to next open slot — carry only, chunk
 * 38] · Mark done / Mark not done · Unschedule · Cancel. Opened by tapping
 * a block on mobile or pressing Enter/Space on a block anywhere. One
 * component for both breakpoints (bottom side).
 *
 * Chunk 59 (handoff §5): when the block's task has notes, a read-only
 * `--surface-2` card sits between the range line and the actions — the newest
 * note's first line and a three-line excerpt, with `Open →` handing over to
 * the task notes sheet.
 */

export type BlockActionSheetProps = {
  open: boolean
  title: string
  /** Mono `HH:MM–HH:MM` range for the description line. */
  rangeText: string
  done: boolean
  /** Past + not done — adds the leading "Move to next open slot" button. */
  carry?: boolean
  /** The task's notes, newest first. Absent or empty = no card. */
  notes?: Note[]
  /** `Open →` on the note card; the caller closes this sheet and opens the notes. */
  onOpenNotes?: (noteId: string) => void
  onCarryMove?: () => void
  onToggleDone: () => void
  onUnschedule: () => void
  onClose: () => void
}

export default function BlockActionSheet({
  open,
  title,
  rangeText,
  done,
  carry = false,
  notes = [],
  onOpenNotes,
  onCarryMove,
  onToggleDone,
  onUnschedule,
  onClose,
}: BlockActionSheetProps) {
  const newest = notes[0]
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="flex flex-col gap-4 rounded-t-xl"
        data-side="bottom"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-[15px] font-semibold tracking-[-.01em]">
            {title}
          </SheetTitle>
          <SheetDescription className="num mono text-[11px] text-ink-3">
            {rangeText}
          </SheetDescription>
        </SheetHeader>
        {newest && (
          <div
            data-testid="block-note-card"
            className="rounded-md border border-line bg-surface-2 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="label">
                {notes.length > 1 ? `Notes · ${notes.length}` : 'Note'}
              </span>
              <span className="num text-[10px] text-ink-3">
                {notes.length > 1 ? 'latest' : 'updated'}{' '}
                {noteRel(newest.updatedAt)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenNotes?.(newest.id)}
                className="ml-auto h-7 px-1.5 text-accent-ink"
              >
                Open
                <ArrowRight aria-hidden />
              </Button>
            </div>
            <div className="mt-1.5 text-[13px] font-semibold text-ink">
              {noteFirstLine(newest)}
            </div>
            <div className="mt-1 line-clamp-3 text-[12.5px] leading-normal text-ink-2">
              {noteExcerpt(newest)}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {carry && onCarryMove && (
            <Button variant="outline" onClick={onCarryMove}>
              Move to next open slot
            </Button>
          )}
          <Button variant="outline" onClick={onToggleDone}>
            {done ? 'Mark not done' : 'Mark done'}
          </Button>
          <Button
            variant="outline"
            onClick={onUnschedule}
            style={{ color: 'hsl(var(--destructive))' }}
          >
            Unschedule
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
