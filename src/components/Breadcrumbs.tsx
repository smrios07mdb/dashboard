import { Link } from 'react-router-dom'

import type { Category, Subcategory } from '@/db/types'

/*
 * Breadcrumb trail rendered at the top of drill-down screens
 * (CategoryView, SubcategoryView). The Dashboard does NOT render
 * Breadcrumbs — keeping it screen-owned, not layout-owned, avoids
 * route-conditional rendering in ProtectedLayout.
 *
 * Trail shapes:
 *   /category/:id     → All › Work
 *   /subcategory/:id  → All › Work › Project A
 *
 * Each segment except the last is a Link. The component is dumb: it
 * takes already-resolved Category/Subcategory rows from the caller
 * (the screen has them loaded). No useParams here — the screen knows
 * better than to look the IDs up twice.
 */

export type BreadcrumbsProps = {
  category?: Category | null
  subcategory?: Subcategory | null
}

export default function Breadcrumbs({
  category,
  subcategory,
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground"
    >
      {/* "All" → /  */}
      {category || subcategory ? (
        <Link
          to="/"
          className="rounded-sm px-1 py-0.5 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          All
        </Link>
      ) : (
        <span className="px-1 py-0.5 text-foreground">All</span>
      )}

      {category && (
        <>
          <Separator />
          {subcategory ? (
            <Link
              to={`/category/${category.id}`}
              className="rounded-sm px-1 py-0.5 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {category.name}
            </Link>
          ) : (
            <span className="px-1 py-0.5 font-medium text-foreground">
              {category.name}
            </span>
          )}
        </>
      )}

      {subcategory && (
        <>
          <Separator />
          <span className="px-1 py-0.5 font-medium text-foreground">
            {subcategory.name}
          </span>
        </>
      )}
    </nav>
  )
}

function Separator() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      ›
    </span>
  )
}
