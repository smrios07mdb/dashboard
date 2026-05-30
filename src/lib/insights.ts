/*
 * Insights aggregation (chunk 16 — ARCHITECTURE.md §12).
 *
 * Pure functions over completed tasks → stacked-bar chart model + an
 * exhaustive summary table. No I/O, no React — unit-tested in insights.test.ts.
 *
 * "Completed" = `completedAt !== null` (there is no `status` column). Day
 * bucketing keys on the UTC date portion of `completedAt`.
 */
import type { Category, Subcategory, Task } from '@/db/types'

/** Color bases per ARCH §12 / chunk-16 R8. */
const WORK_BASE = '#3a5a40'
const PERSONAL_BASE = '#a85a3c'
/** Neutral gray for the folded "Other" segment. */
export const OTHER_COLOR = '#6b6f76'
/** Stable series key for the grouped "Other" bucket. */
export const OTHER_KEY = '__other__'

export type ChartDay = {
  date: string // YYYY-MM-DD
  label: string // e.g. "May 20"
  /** Completed minutes keyed by series key (subcategory id, or OTHER_KEY). */
  minutes: Record<string, number>
}

export type SubSeries = {
  key: string
  name: string
  categoryName: string
  color: string
}

export type ChartModel = {
  days: ChartDay[]
  /** Stacking + legend order: descending by total minutes. */
  series: SubSeries[]
}

export type SummaryRow = {
  subcategoryId: string
  categoryId: string
  name: string
  tasks: number
  minutes: number
  pct: number
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function labelFor(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`
}

function lighten(hex: string, t: number): string {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * t)
  const h = (c: number) => mix(c).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

const byIdAsc = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/**
 * Deterministic color per subcategory: each category's subs are sorted by id
 * (stable across renders/filters) and assigned a lightening ramp off the
 * category base. First sub = base color exactly.
 */
export function buildColorMap(
  subcategories: Subcategory[],
  categories: Category[],
): Record<string, string> {
  const catById = new Map(categories.map((c) => [c.id, c]))
  const map: Record<string, string> = {}

  for (const [name, base] of [
    ['Work', WORK_BASE],
    ['Personal', PERSONAL_BASE],
  ] as const) {
    const subs = subcategories
      .filter((s) => catById.get(s.categoryId)?.name === name)
      .sort(byIdAsc)
    subs.forEach((s, i) => {
      map[s.id] = lighten(base, Math.min(i * 0.13, 0.7))
    })
  }
  // Subs whose category is unknown fall back to neutral gray.
  for (const s of subcategories) if (!(s.id in map)) map[s.id] = OTHER_COLOR
  return map
}

/**
 * Bucket completed minutes into per-day stacked rows. `dayKeys` (optional)
 * pins the x-axis to a fixed range with zero-fill; otherwise the days present
 * in the tasks are used. `series` is sorted descending by total minutes.
 */
export function aggregateForChart(
  tasks: Task[],
  subcategories: Subcategory[],
  categories: Category[],
  dayKeys?: string[],
): ChartModel {
  const colorMap = buildColorMap(subcategories, categories)
  const subById = new Map(subcategories.map((s) => [s.id, s]))
  const catById = new Map(categories.map((c) => [c.id, c]))

  let days: string[]
  if (dayKeys) {
    days = [...dayKeys]
  } else {
    const set = new Set<string>()
    for (const t of tasks) if (t.completedAt) set.add(t.completedAt.slice(0, 10))
    days = [...set].sort()
  }
  const dayIndex = new Map(days.map((d, i) => [d, i]))
  const rows: ChartDay[] = days.map((d) => ({
    date: d,
    label: labelFor(d),
    minutes: {},
  }))

  const totals = new Map<string, number>()
  for (const t of tasks) {
    if (!t.completedAt) continue
    const idx = dayIndex.get(t.completedAt.slice(0, 10))
    if (idx === undefined) continue
    if (!subById.has(t.subcategoryId)) continue
    rows[idx].minutes[t.subcategoryId] =
      (rows[idx].minutes[t.subcategoryId] ?? 0) + t.estimateMinutes
    totals.set(
      t.subcategoryId,
      (totals.get(t.subcategoryId) ?? 0) + t.estimateMinutes,
    )
  }

  const series: SubSeries[] = [...totals.entries()]
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([sid]) => {
      const s = subById.get(sid) as Subcategory
      return {
        key: sid,
        name: s.name,
        categoryName: catById.get(s.categoryId)?.name ?? '',
        color: colorMap[sid] ?? OTHER_COLOR,
      }
    })

  return { days: rows, series }
}

/**
 * Fold all but the top 7 subcategories (by total minutes) into a single
 * neutral "Other" series — but only when there are MORE than `threshold`
 * (default 8). At exactly 8, no grouping (ARCH §12 / R8). The summary table
 * stays exhaustive; this only affects the chart.
 */
export function applyOtherGrouping(
  model: ChartModel,
  threshold = 8,
): { bars: ChartModel; groupedNames: string[] } {
  if (model.series.length <= threshold) {
    return { bars: model, groupedNames: [] }
  }

  const KEEP = 7
  const kept = model.series.slice(0, KEEP)
  const folded = model.series.slice(KEEP)
  const foldedKeys = new Set(folded.map((s) => s.key))

  const days: ChartDay[] = model.days.map((d) => {
    const minutes: Record<string, number> = {}
    let other = 0
    for (const [k, v] of Object.entries(d.minutes)) {
      if (foldedKeys.has(k)) other += v
      else minutes[k] = v
    }
    if (other > 0) minutes[OTHER_KEY] = other
    return { date: d.date, label: d.label, minutes }
  })

  const series: SubSeries[] = [
    ...kept,
    { key: OTHER_KEY, name: 'Other', categoryName: 'Other', color: OTHER_COLOR },
  ]

  return { bars: { days, series }, groupedNames: folded.map((s) => s.name) }
}

/**
 * Exhaustive per-subcategory rollup (never grouped), sorted descending by
 * minutes, with each row's share of the grand total.
 */
export function summaryTable(
  tasks: Task[],
  subcategories: Subcategory[],
): SummaryRow[] {
  const subById = new Map(subcategories.map((s) => [s.id, s]))
  const agg = new Map<string, { tasks: number; minutes: number }>()

  for (const t of tasks) {
    if (!t.completedAt) continue
    if (!subById.has(t.subcategoryId)) continue
    const a = agg.get(t.subcategoryId) ?? { tasks: 0, minutes: 0 }
    a.tasks += 1
    a.minutes += t.estimateMinutes
    agg.set(t.subcategoryId, a)
  }

  const grand = [...agg.values()].reduce((s, a) => s + a.minutes, 0)

  return [...agg.entries()]
    .map(([sid, a]) => {
      const s = subById.get(sid) as Subcategory
      return {
        subcategoryId: sid,
        categoryId: s.categoryId,
        name: s.name,
        tasks: a.tasks,
        minutes: a.minutes,
        pct: grand ? (a.minutes / grand) * 100 : 0,
      }
    })
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        (a.subcategoryId < b.subcategoryId ? -1 : 1),
    )
}
