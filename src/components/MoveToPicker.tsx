import { type ReactNode } from 'react'

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import type { Category, Subcategory } from '@/db/types'

/*
 * Cascading "Move to…" picker built on shadcn's DropdownMenuSub
 * primitives. Two shapes:
 *
 *   - Default export `<MoveToPicker>`: a nested submenu. The trigger
 *     reads "Move to…" and lives inside the caller's parent menu
 *     (used by TaskMenu's three-dot dropdown).
 *
 *   - Named export `<MoveToPickerContent>`: just the categories list,
 *     each opening a child submenu of subcategories. Renders directly
 *     inside a top-level `<DropdownMenuContent>` — used by
 *     SubcategoryView's bulk-toolbar Move-to button.
 *
 * Filters in both shapes:
 *   - Archived subs are dropped (render-layer filter, chunk-8 pattern).
 *   - The `currentSubcategoryId`, if provided, is excluded — moving to
 *     where the source(s) already live is a no-op.
 *
 * If a category has zero eligible targets after filtering, the
 * category's submenu shows an italic "No targets" stub rather than an
 * empty submenu. Keeps the picker honest about why a category is
 * present but empty.
 */

type CommonProps = {
  categories: Category[]
  subcategories: Subcategory[]
  /** Subcategory id of the source task(s); excluded from the target list. */
  currentSubcategoryId?: string | null
  onSelect: (targetSubcategoryId: string) => void
}

export type MoveToPickerProps = CommonProps & {
  /** Trigger label inside the parent menu — typically "Move to…". */
  label?: ReactNode
}

/** Builds the {categoryId → eligible subs[]} map applied by both shapes. */
function buildSubsByCat(
  subcategories: Subcategory[],
  currentSubcategoryId?: string | null,
): Record<string, Subcategory[]> {
  const m: Record<string, Subcategory[]> = {}
  for (const s of subcategories) {
    if (s.archivedAt) continue
    if (s.id === currentSubcategoryId) continue
    ;(m[s.categoryId] ??= []).push(s)
  }
  for (const k of Object.keys(m)) {
    m[k].sort((a, b) => a.sortOrder - b.sortOrder)
  }
  return m
}

function CategorySubmenus({
  categories,
  subcategories,
  currentSubcategoryId,
  onSelect,
}: CommonProps) {
  const subsByCat = buildSubsByCat(subcategories, currentSubcategoryId)
  return (
    <>
      {categories.map((cat) => {
        const subs = subsByCat[cat.id] ?? []
        return (
          <DropdownMenuSub key={cat.id}>
            <DropdownMenuSubTrigger>{cat.name}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {subs.length === 0 ? (
                <DropdownMenuItem disabled className="italic">
                  No targets
                </DropdownMenuItem>
              ) : (
                subs.map((sub) => (
                  <DropdownMenuItem
                    key={sub.id}
                    onSelect={() => onSelect(sub.id)}
                  >
                    {sub.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}

/** Nested submenu shape — used inside a parent dropdown. */
export default function MoveToPicker({
  label = 'Move to…',
  ...rest
}: MoveToPickerProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <CategorySubmenus {...rest} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Top-level shape — categories list rendered directly inside a
 *  `<DropdownMenuContent>`. Used by SubcategoryView's bulk toolbar. */
export function MoveToPickerContent(props: CommonProps) {
  return <CategorySubmenus {...props} />
}
