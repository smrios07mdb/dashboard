import type { ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

/*
 * Reusable destructive-confirmation dialog.
 *
 * Wraps shadcn's AlertDialog so the role=alertdialog semantics (Cancel
 * focused by default, Escape to dismiss) are uniform across:
 *   - Task delete (chunk 7)
 *   - Subcategory delete (chunk 8)
 *   - Routine item delete (chunk 10)
 *   - Any future "this cannot be undone" prompt
 */

type DeleteConfirmProps = {
  /** The element that opens the dialog (typically a trash button). */
  trigger: ReactNode
  /** Title shown at the top of the dialog. */
  title: string
  /** One-line description shown below the title. */
  description: string
  /** Label for the destructive button (defaults to "Delete"). */
  confirmLabel?: string
  /** Called when the user confirms. */
  onConfirm: () => void | Promise<void>
}

export default function DeleteConfirm({
  trigger,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
}: DeleteConfirmProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void onConfirm()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
