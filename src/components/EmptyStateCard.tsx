import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { Category } from '@/db/types'

/*
 * First-run empty state (chunk 20 — UX-05; DESIGN_NOTES §3).
 *
 * Dashed-border centered card shown by the Dashboard when the account has no
 * non-archived subcategories. A brand-new account has the seeded Work/Personal
 * categories but no subcategory, and a task can't exist without one, so the
 * user's first real action is creating a list — each CTA routes into a category
 * with the inline "Add subcategory" input auto-opened.
 *
 * Calm, non-gamified copy (DESIGN_BRIEF). Styling rides the live theme tokens
 * (border/card/primary), not literal hex, so it matches the running palette.
 * Focus rings are bumped to 2px to meet the DESIGN_BRIEF A11y bar (the shared
 * Button primitive defaults to 1px).
 */
export type EmptyStateCardProps = {
  categories: Category[]
  onPickCategory: (categoryId: string) => void
}

export default function EmptyStateCard({
  categories,
  onPickCategory,
}: EmptyStateCardProps) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-md border-2 border-dashed border-border bg-card/30 px-6 py-16 text-center">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground"
      >
        <Plus className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-[18px] font-semibold text-foreground">
          Set up your first list
        </h2>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          Lists live under Work and Personal. Create one to start adding tasks.
        </p>
      </div>
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {categories.map((cat) => (
            <Button
              key={cat.id}
              type="button"
              onClick={() => onPickCategory(cat.id)}
              className="focus-visible:ring-2"
            >
              <Plus aria-hidden />
              New list in {cat.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
