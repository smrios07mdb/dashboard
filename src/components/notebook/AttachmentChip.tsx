import type { NoteAttachment } from '@/lib/notes'
import { catColor } from '@/lib/cat'
import { cn } from '@/lib/utils'

/*
 * A note's attachment as a pill (chunk 58): category dot + the task or list
 * name, with a `TASK` micro-label on task chips at `md`. A detached note —
 * both links null, memo set — gets the hollow dashed chip with the old name
 * struck through. Renders a <button> when `onClick` is given.
 */
type AttachmentChipProps = {
  attachment: NoteAttachment
  size?: 'sm' | 'md'
  onClick?: () => void
  className?: string
}

export default function AttachmentChip({
  attachment,
  size = 'md',
  onClick,
  className,
}: AttachmentChipProps) {
  const detached = attachment.kind === 'detached'
  const title = detached
    ? `Detached from ${attachment.name}`
    : attachment.kind === 'task'
      ? `${attachment.categoryName} · ${attachment.subcategory.name} · ${attachment.name}`
      : `${attachment.categoryName} · ${attachment.name}`
  const body = (
    <>
      <span
        aria-hidden
        className="size-[7px] shrink-0 rounded-full"
        style={{
          background: detached
            ? 'var(--ink-4)'
            : catColor(attachment.categoryName),
        }}
      />
      <span
        className={cn(
          'min-w-0 truncate',
          detached && 'line-through decoration-ink-4',
        )}
      >
        {attachment.name}
      </span>
      {attachment.kind === 'task' && size === 'md' && (
        <span className="label text-[8.5px] tracking-[0.12em]">task</span>
      )}
    </>
  )
  const classes = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium',
    size === 'sm'
      ? 'py-px pl-1.5 pr-[7px] text-[11px]'
      : 'py-[3px] pl-[7px] pr-[9px] text-[12px]',
    detached
      ? 'border-dashed border-line-strong bg-transparent text-ink-3'
      : 'border-line bg-surface text-ink-2',
    className,
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        data-testid="attachment-chip"
        data-detached={detached || undefined}
        className={cn(
          classes,
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {body}
      </button>
    )
  }
  return (
    <span
      title={title}
      data-testid="attachment-chip"
      data-detached={detached || undefined}
      className={classes}
    >
      {body}
    </span>
  )
}
