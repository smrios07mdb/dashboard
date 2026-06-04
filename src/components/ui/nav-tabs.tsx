import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * TopTabs / BottomTabs — the app's primary navigation (prototype `TopTabs` /
 * `BottomTabs`). Presentational and prop-driven; Chunk 24's shell wires them to
 * react-router. Active treatment uses `--accent` for both forms (unifying the
 * prototype's separate `--ink` underline / jade glow — see app/README §2).
 */
export interface NavItem {
  id: string
  label: string
  icon?: React.ReactNode
}

export interface NavTabsProps {
  items: NavItem[]
  value: string
  onChange: (id: string) => void
  className?: string
}

/** Desktop top-nav row: active = ink/600 + 2px `--accent` underline. */
export function TopTabs({ items, value, onChange, className }: NavTabsProps) {
  return (
    <nav className={cn('flex gap-0.5 border-b border-line', className)}>
      {items.map((it) => {
        const active = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative inline-flex items-center gap-2 px-4 py-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'font-semibold text-ink'
                : 'font-medium text-ink-3 hover:text-ink',
            )}
          >
            {it.icon}
            {it.label}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2.5 -bottom-px h-0.5 rounded-sm',
                active ? 'bg-[hsl(var(--accent))]' : 'bg-transparent',
              )}
            />
          </button>
        )
      })}
    </nav>
  )
}

/** Mobile bottom nav (<640px form of TopTabs). Active = ink/600 + `--accent` cap. */
export function BottomTabs({ items, value, onChange, className }: NavTabsProps) {
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] backdrop-blur-md',
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {items.map((it) => {
        const active = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center gap-1 px-1.5 pb-3 pt-2.5 text-[10px] tracking-[0.02em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'font-semibold text-ink' : 'font-medium text-ink-3',
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-[30%] top-0 h-0.5 rounded-b-sm bg-[hsl(var(--accent))]"
              />
            )}
            {it.icon}
            <span>{it.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
