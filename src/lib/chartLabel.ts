/*
 * Pure {range, categoryFilter} → chart aria-label (chunk 20 — UX-07).
 *
 * The recharts Insights chart is opaque to the a11y tree; this string is its
 * `role="img"` label, summarising what's plotted and the active filter so a
 * screen reader gets the gist (the semantic data-table below carries the
 * numbers). Types mirror Insights' local `Range` / `CatFilter`.
 */
export type ChartRange = 7 | 30 | 90
export type ChartCategoryFilter = 'all' | 'work' | 'personal'

const CATEGORY_PHRASE: Record<ChartCategoryFilter, string> = {
  all: 'all categories',
  work: 'the Work category',
  personal: 'the Personal category',
}

export function chartLabel({
  range,
  categoryFilter,
}: {
  range: ChartRange
  categoryFilter: ChartCategoryFilter
}): string {
  return `Completed minutes per day for the last ${range} days, ${CATEGORY_PHRASE[categoryFilter]}, by subcategory.`
}
