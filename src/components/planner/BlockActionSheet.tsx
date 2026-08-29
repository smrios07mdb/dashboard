import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

/*
 * Block action sheet (chunk 37, D6/D7) — the touch + keyboard equivalent
 * of the desktop hover row: Mark done / Mark not done · Unschedule ·
 * Cancel. Opened by tapping a block on mobile or pressing Enter/Space on
 * a block anywhere. One component for both breakpoints (bottom side).
 */

export type BlockActionSheetProps = {
  open: boolean
  title: string
  /** Mono `HH:MM–HH:MM` range for the description line. */
  rangeText: string
  done: boolean
  onToggleDone: () => void
  onUnschedule: () => void
  onClose: () => void
}

export default function BlockActionSheet({
  open,
  title,
  rangeText,
  done,
  onToggleDone,
  onUnschedule,
  onClose,
}: BlockActionSheetProps) {
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
        <div className="flex flex-col gap-2">
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
