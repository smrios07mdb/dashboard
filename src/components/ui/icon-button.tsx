import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * IconBtn — square, icon-only button (prototype `IconBtn`). Used for chevrons,
 * three-dot menus, bell, trash, sheet-close, etc. Ghost hover tints to `--bg-alt`.
 *
 * `label` is required and applied as both `aria-label` and `title`.
 */
type IconButtonTone = 'ghost' | 'danger' | 'accent' | 'ink'

const toneClass: Record<IconButtonTone, string> = {
  ghost: 'text-ink-3',
  danger: 'text-destructive',
  accent: 'text-[hsl(var(--accent))]',
  ink: 'text-ink-2',
}

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: IconButtonTone
  /** Square size in px. Default 28. */
  size?: number
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, tone = 'ghost', size = 28, className, style, children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        toneClass[tone],
        className,
      )}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = 'IconButton'

export { IconButton as IconBtn }
