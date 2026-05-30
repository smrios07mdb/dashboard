import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import {
  aggregateForChart,
  applyOtherGrouping,
  summaryTable,
  type ChartModel,
} from '@/lib/insights'

type Range = 7 | 30 | 90
type CatFilter = 'all' | 'work' | 'personal'

const RANGES: Range[] = [7, 30, 90]
const CAT_FILTERS: { id: CatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'work', label: 'Work' },
  { id: 'personal', label: 'Personal' },
]

/** Last `n` calendar days (UTC), oldest first, as YYYY-MM-DD. */
function lastNDays(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    )
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function fmtMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

const PILL_GROUP =
  'inline-flex rounded-full border border-border bg-secondary p-0.5'
function pill(active: boolean): string {
  return `rounded-full px-3.5 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active
      ? 'bg-card font-semibold text-foreground shadow-[0_1px_0_var(--line)]'
      : 'font-medium text-muted-foreground hover:text-foreground'
  }`
}

export default function Insights() {
  const [range, setRange] = useState<Range>(30)
  const [catFilter, setCatFilter] = useState<CatFilter>('all')
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [subcategories, setSubcategories] = useState<Subcategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    // `loading` is toggled true in the range handler (event-driven) and reset
    // in .finally below — never set synchronously in the effect body (avoids
    // react-hooks/set-state-in-effect; the project's established pattern).
    let cancelled = false
    const days = lastNDays(range)
    const from = `${days[0]}T00:00:00.000Z`
    const to = new Date().toISOString()
    Promise.all([
      repo.tasks.listCompletedInRange(from, to),
      repo.subcategories.list(),
      repo.categories.list(),
    ])
      .then(([t, s, c]) => {
        if (cancelled) return
        setTasks(t)
        setSubcategories(s)
        setCategories(c)
      })
      .catch((e) => {
        console.error('Insights load failed', e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range])

  const dayKeys = useMemo(() => lastNDays(range), [range])

  // Filter subcategories by the active category toggle.
  const filteredSubs = useMemo(() => {
    if (catFilter === 'all') return subcategories.filter((s) => !s.archivedAt)
    const want = catFilter === 'work' ? 'Work' : 'Personal'
    const catIds = new Set(
      categories.filter((c) => c.name === want).map((c) => c.id),
    )
    return subcategories.filter((s) => !s.archivedAt && catIds.has(s.categoryId))
  }, [subcategories, categories, catFilter])

  const ungrouped: ChartModel = useMemo(
    () => aggregateForChart(tasks, filteredSubs, categories, dayKeys),
    [tasks, filteredSubs, categories, dayKeys],
  )
  const { bars, groupedNames } = useMemo(
    () => applyOtherGrouping(ungrouped),
    [ungrouped],
  )
  const summary = useMemo(
    () => summaryTable(tasks, filteredSubs),
    [tasks, filteredSubs],
  )

  const chartData = useMemo(
    () => bars.days.map((d) => ({ label: d.label, ...d.minutes })),
    [bars],
  )
  const totalMinutes = summary.reduce((s, r) => s + r.minutes, 0)
  const grandTotal = totalMinutes

  // Lookups for the full-breakdown tooltip (expands what's inside "Other").
  const ungroupedByLabel = useMemo(
    () => new Map(ungrouped.days.map((d) => [d.label, d])),
    [ungrouped],
  )
  const subMeta = useMemo(
    () => new Map(ungrouped.series.map((s) => [s.key, s])),
    [ungrouped],
  )
  const catName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? ''

  return (
    <div>
      <div className="label mb-2">Insights</div>
      <h1
        className="mb-5 text-[28px] font-semibold"
        style={{ letterSpacing: '-0.02em' }}
      >
        Insights
      </h1>

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className={PILL_GROUP} role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={pill(range === r)}
              aria-pressed={range === r}
              onClick={() => {
                if (r !== range) setLoading(true)
                setRange(r)
              }}
            >
              {r} days
            </button>
          ))}
        </div>
        <div className={PILL_GROUP} role="group" aria-label="Category">
          {CAT_FILTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={pill(catFilter === c.id)}
              aria-pressed={catFilter === c.id}
              onClick={() => setCatFilter(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        {loading ? (
          <div
            className="h-[280px] animate-pulse rounded-md bg-secondary motion-reduce:animate-none"
            aria-hidden
          />
        ) : totalMinutes === 0 ? (
          <div className="px-6 py-16 text-center text-[13px] leading-relaxed text-muted-foreground">
            <div className="mb-1 text-[16px] font-semibold text-secondary-foreground">
              No completed tasks in this range.
            </div>
            Complete a task and its estimated minutes show up here. Try a wider
            range or a different category.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--line)"
                  strokeDasharray="2 4"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--line)' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}m`}
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: 'var(--accent-soft)' }}
                  content={({ active, label }) => {
                    if (!active || typeof label !== 'string') return null
                    const day = ungroupedByLabel.get(label)
                    if (!day) return null
                    const rows = Object.entries(day.minutes)
                      .filter(([, v]) => v > 0)
                      .sort((a, b) => b[1] - a[1])
                    if (rows.length === 0) return null
                    return (
                      <div className="rounded-md border border-border bg-popover px-3 py-2 text-[12px] shadow-lg">
                        <div className="mb-1 font-medium text-foreground">
                          {label}
                        </div>
                        {rows.map(([key, v]) => (
                          <div
                            key={key}
                            className="flex items-center gap-2 text-secondary-foreground"
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-[2px]"
                              style={{ background: subMeta.get(key)?.color }}
                            />
                            <span className="mr-3">
                              {subMeta.get(key)?.name ?? key}
                            </span>
                            <span className="ml-auto font-mono">{v}m</span>
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />
                {bars.series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="minutes"
                    fill={s.color}
                    name={s.name}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4">
              {bars.series.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1.5 text-[12px] text-secondary-foreground"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[2px]"
                    style={{ background: s.color }}
                  />
                  {s.name}
                </span>
              ))}
            </div>
            {groupedNames.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                “Other” groups {groupedNames.length} smaller subcategories — hover
                a bar for the full breakdown.
              </p>
            )}
          </>
        )}
      </div>

      {/* Summary table (exhaustive — never grouped) */}
      {!loading && summary.length > 0 && (
        <table className="mt-6 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-left">
              <th className="label py-2.5">Subcategory</th>
              <th className="label py-2.5">Category</th>
              <th className="label py-2.5 text-right">Tasks</th>
              <th className="label py-2.5 text-right">Minutes</th>
              <th className="label py-2.5 text-right">% total</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.subcategoryId} className="border-b border-border">
                <td className="py-3 text-foreground">{row.name}</td>
                <td className="py-3 text-muted-foreground">
                  {catName(row.categoryId)}
                </td>
                <td className="py-3 text-right font-mono text-secondary-foreground">
                  {row.tasks}
                </td>
                <td className="py-3 text-right font-mono text-secondary-foreground">
                  {fmtMinutes(row.minutes)}
                </td>
                <td className="py-3 text-right font-mono text-secondary-foreground">
                  {row.pct.toFixed(1)}%
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-3 font-semibold">Total</td>
              <td />
              <td />
              <td className="py-3 text-right font-mono font-semibold">
                {fmtMinutes(grandTotal)}
              </td>
              <td className="py-3 text-right font-mono font-semibold">
                100.0%
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}
