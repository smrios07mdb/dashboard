import { useEffect, useMemo, useState } from 'react'
import { Filter, TrendingDown, TrendingUp } from 'lucide-react'
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
import { chartLabel } from '@/lib/chartLabel'
import { dateKeyDaysAgo, startOfDayIso, today } from '@/lib/clock'
import {
  aggregateForChart,
  applyOtherGrouping,
  OTHER_COLOR,
  summaryTable,
  type ChartModel,
} from '@/lib/insights'
import { browserTimezone, loadUserTimezone } from '@/lib/userTimezone'

type Range = 7 | 30 | 90
type CatFilter = 'all' | 'work' | 'personal'

const RANGES: Range[] = [7, 30, 90]
const CAT_FILTERS: { id: CatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'work', label: 'Work' },
  { id: 'personal', label: 'Personal' },
]

/** Last `n` calendar days in `timezone`, oldest first, as YYYY-MM-DD. */
function lastNDays(n: number, timezone: string): string[] {
  const out: string[] = []
  const todayKey = today(timezone)
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(dateKeyDaysAgo(todayKey, i))
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

/** "Sep 2" in `tz`; the year is added when it isn't the current one there. */
function fmtLastCompletion(iso: string, tz: string): string {
  const at = new Date(iso)
  const yearIn = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(d)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    ...(yearIn(at) !== yearIn(new Date()) ? { year: 'numeric' as const } : {}),
  }).format(at)
}

const PILL_GROUP =
  'inline-flex rounded-full border border-line bg-bg-alt p-0.5'
function pill(active: boolean): string {
  return `rounded-full px-3.5 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active
      ? 'bg-surface font-semibold text-ink shadow-[0_1px_0_var(--line)]'
      : 'font-medium text-ink-3 hover:text-ink'
  }`
}

/*
 * Per-series legend markers (chunk 20 — UX-07). The brand series colors are
 * green shades (Work) and warm-neutral shades (Personal) that can be hard to
 * tell apart for colorblind users, so each series also carries a distinct
 * *shape*, keyed to its stacking index. The chart shows at most 8 series — up
 * to 8 raw, or top-7 + "Other" once there are more than 8 (applyOtherGrouping)
 * — matching the 8 shapes here; the `% MARKER_SHAPES.length` guard keeps any
 * overflow non-fatal.
 */
const MARKER_SHAPES = [
  (c: string) => <rect x="2" y="2" width="8" height="8" rx="1.5" fill={c} />,
  (c: string) => <circle cx="6" cy="6" r="4.5" fill={c} />,
  (c: string) => <polygon points="6,1.5 10.5,10 1.5,10" fill={c} />,
  (c: string) => <polygon points="6,1 11,6 6,11 1,6" fill={c} />,
  (c: string) => (
    <rect
      x="2.4"
      y="2.4"
      width="7.2"
      height="7.2"
      rx="0.8"
      fill="none"
      stroke={c}
      strokeWidth="1.6"
    />
  ),
  (c: string) => (
    <circle cx="6" cy="6" r="4" fill="none" stroke={c} strokeWidth="1.8" />
  ),
  (c: string) => <polygon points="1.5,2 10.5,2 6,10.5" fill={c} />,
  (c: string) => (
    <g stroke={c} strokeWidth="2.2" strokeLinecap="round">
      <line x1="6" y1="2" x2="6" y2="10" />
      <line x1="2" y1="6" x2="10" y2="6" />
    </g>
  ),
]

function SeriesMarker({ index, color }: { index: number; color: string }) {
  const draw = MARKER_SHAPES[index % MARKER_SHAPES.length]
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      aria-hidden
      className="shrink-0"
    >
      {draw(color)}
    </svg>
  )
}

export default function Insights() {
  const [range, setRange] = useState<Range>(30)
  const [catFilter, setCatFilter] = useState<CatFilter>('all')
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [subcategories, setSubcategories] = useState<Subcategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  // Set in the same .then as the data below, so the x-axis and the buckets can
  // never come from different zones (chunk 61).
  const [tz, setTz] = useState<string>(() => browserTimezone())
  // Latest all-time completion (chunk 70) — only looked up when the range came
  // back empty, so the empty state can say when the last one was.
  const [lastCompletedAt, setLastCompletedAt] = useState<string | null>(null)

  useEffect(() => {
    // `loading` is toggled true in the range handler (event-driven) and reset
    // in .finally below — never set synchronously in the effect body (avoids
    // react-hooks/set-state-in-effect; the project's established pattern).
    let cancelled = false
    // The zone resolves first so the fetch window and the x-axis share it.
    async function load() {
      const zone = await loadUserTimezone()
      const days = lastNDays(range, zone)
      const from = startOfDayIso(days[0], zone)
      const to = new Date().toISOString()
      const [t, s, c] = await Promise.all([
        repo.tasks.listCompletedInRange(from, to),
        repo.subcategories.list(),
        repo.categories.list(),
      ])
      let last: string | null = null
      if (t.length === 0) {
        const all = await repo.tasks.listCompletedInRange(
          '1970-01-01T00:00:00.000Z',
          to,
        )
        for (const task of all) {
          if (task.completedAt && (last === null || task.completedAt > last)) {
            last = task.completedAt
          }
        }
      }
      return [zone, t, s, c, last] as const
    }
    load()
      .then(([zone, t, s, c, last]) => {
        if (cancelled) return
        setTz(zone)
        setLastCompletedAt(last)
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

  // `loading` flips here, in the event handler — see the effect's note.
  const selectRange = (r: Range) => {
    if (r !== range) setLoading(true)
    setRange(r)
  }

  const dayKeys = useMemo(() => lastNDays(range, tz), [range, tz])

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
    () => aggregateForChart(tasks, filteredSubs, categories, dayKeys, tz),
    [tasks, filteredSubs, categories, dayKeys, tz],
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
  const completedCount = summary.reduce((s, r) => s + r.tasks, 0)
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

  // ---- Headline figures (chunk 29) — derived from existing screen state; no
  // change to lib/insights.ts. `summary` is sorted descending by minutes, so
  // [0] is the most-touched. Chunk 70: the cards lead with the task count and
  // every time figure is labelled as an estimate — nothing here is tracked. ----
  const statCards: { label: string; value: string; hint: string; accent: string }[] =
    [
      {
        label: `Last ${range} days`,
        value: String(completedCount),
        hint: 'tasks completed',
        accent: 'var(--jewel-jade)',
      },
      {
        label: 'Estimated time',
        value: fmtMinutes(totalMinutes),
        hint: 'sum of task estimates',
        accent: 'var(--jewel-coral)',
      },
      {
        label: 'Daily average',
        value: fmtMinutes(Math.round(totalMinutes / range)),
        hint: 'estimated, across all categories',
        accent: 'var(--jewel-jade)',
      },
      {
        label: 'Most-touched',
        value: summary[0]?.name ?? '—',
        hint: 'by estimated time',
        accent: 'var(--jewel-coral)',
      },
    ]

  // Trend = second-half vs first-half daily average, over per-day chart totals
  // (folding "Other" doesn't change per-day totals).
  const dayTotal = (d: { minutes: Record<string, number> }) =>
    Object.values(d.minutes).reduce((a, v) => a + v, 0)
  const half = Math.floor(bars.days.length / 2)
  const sumRange = (arr: typeof bars.days) =>
    arr.reduce((s, d) => s + dayTotal(d), 0)
  const firstAvg = half ? sumRange(bars.days.slice(0, half)) / half : 0
  const lastAvg =
    bars.days.length - half
      ? sumRange(bars.days.slice(half)) / (bars.days.length - half)
      : 0
  const trend = firstAvg ? Math.round(((lastAvg - firstAvg) / firstAvg) * 100) : 0
  const TrendIcon = trend >= 0 ? TrendingUp : TrendingDown

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-baseline gap-4">
        <h1
          className="m-0 font-display text-[40px] font-medium text-ink"
          style={{ letterSpacing: '-0.02em' }}
        >
          Insights
        </h1>
        <span className="label pb-1.5">What got done</span>
        {!loading && totalMinutes > 0 && (
          <span
            className="ml-auto inline-flex items-center gap-1.5 self-center rounded-full px-[11px] py-[5px] text-[12px] font-semibold"
            style={
              trend >= 0
                ? {
                    background: 'var(--work-soft)',
                    color: 'var(--work)',
                    border:
                      '1px solid color-mix(in srgb, var(--work) 30%, transparent)',
                  }
                : {
                    background: 'var(--bg-alt)',
                    color: 'var(--ink-2)',
                    border: '1px solid var(--line)',
                  }
            }
            aria-label={`Trend ${trend >= 0 ? '+' : ''}${trend}% vs first half`}
          >
            <TrendIcon className="size-3.5" aria-hidden />
            <span className="num">
              {trend >= 0 ? '+' : ''}
              {trend}%
            </span>
            <span className="font-medium text-ink-3">vs first half</span>
          </span>
        )}
      </header>

      {/* Headline stat cards — hairline-divided grid over a --line background. */}
      {!loading && (
        <div
          className="mb-7 grid gap-px overflow-hidden rounded-md border border-line shadow-md"
          style={{
            background: 'var(--line)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          {statCards.map((c) => (
            <div key={c.label} className="relative bg-surface px-[18px] py-4">
              <div
                className="absolute inset-x-0 top-0 h-0.5"
                aria-hidden
                style={{
                  background: `linear-gradient(90deg, ${c.accent}, transparent 70%)`,
                }}
              />
              <div
                className="label mb-1.5"
                style={{ color: c.accent, opacity: 0.85 }}
              >
                {c.label}
              </div>
              <div
                className="font-display text-[22px] font-semibold"
                style={{ letterSpacing: '-0.02em' }}
              >
                {c.value}
              </div>
              <div className="mt-1 text-[11px] text-ink-3">{c.hint}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <div className={PILL_GROUP} role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={pill(range === r)}
              aria-pressed={range === r}
              onClick={() => selectRange(r)}
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

      <div className="rounded-md border border-line bg-surface px-5 py-[18px] shadow-md">
        {loading ? (
          <div
            className="h-[280px] animate-pulse rounded-md bg-bg-alt motion-reduce:animate-none"
            aria-hidden
          />
        ) : totalMinutes === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-3.5 flex h-11 w-11 items-center justify-center rounded-full bg-bg-alt text-ink-3">
              <Filter className="size-[18px]" aria-hidden />
            </div>
            <div
              className="font-display text-[16px] font-semibold text-ink-2"
              style={{ letterSpacing: '-0.01em' }}
            >
              Nothing completed in the last {range} days.
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
              {tasks.length === 0 && lastCompletedAt
                ? `Last completion was ${fmtLastCompletion(lastCompletedAt, tz)}.`
                : 'Complete a task and it shows up here. Try a wider range or another category.'}
            </p>
            {range < 90 && (
              <button
                type="button"
                className="mt-4 min-h-11 rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-ink hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => selectRange(90)}
              >
                Show 90 days
              </button>
            )}
          </div>
        ) : (
          <>
            {/*
             * role="img" + a built-from-state label gives screen readers the
             * gist of the otherwise-opaque recharts SVG (chunk 20 — UX-07).
             * The legend below stays OUTSIDE this wrapper so its text + shape
             * cues remain in the a11y tree; the data table carries the numbers.
             * accessibilityLayer={false} disables recharts' own focusable
             * role="application" SVG layer (default on) so a tabbable surface
             * doesn't nest inside — and contradict — this role="img" subtree.
             */}
            <div
              role="img"
              aria-label={chartLabel({ range, categoryFilter: catFilter })}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  accessibilityLayer={false}
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
                    tick={{ fill: 'var(--ink-3)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--line)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={20}
                  />
                  <YAxis
                    tick={{ fill: 'var(--ink-3)', fontSize: 10 }}
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
                        <div className="rounded-md px-3 py-2 text-[12px] shadow-lg" style={{ background: 'var(--ink)' }}>
                          <div className="mb-1 font-medium" style={{ color: 'var(--bg)' }}>{label}</div>
                          {rows.map(([key, v]) => (
                            <div
                              key={key}
                              className="flex items-center gap-2"
                              style={{ color: 'var(--bg-alt)' }}
                            >
                              <span
                                className="inline-block h-2 w-2 rounded-[2px]"
                                style={{ background: subMeta.get(key)?.color }}
                              />
                              <span className="mr-3">
                                {subMeta.get(key)?.name ?? key}
                              </span>
                              <span className="num ml-auto" style={{ color: 'var(--bg)' }}>{v}m</span>
                            </div>
                          ))}
                        </div>
                      )
                    }}
                  />
                  {bars.series.map((s, i) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      stackId="minutes"
                      fill={s.color}
                      name={s.name}
                      isAnimationActive={false}
                      radius={i === bars.series.length - 1 ? [2, 2, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Legend — shape + text per series so color isn't the only cue. */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4">
              {bars.series.map((s, i) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1.5 text-[12px] text-ink-2"
                >
                  <SeriesMarker index={i} color={s.color} />
                  {s.name}
                </span>
              ))}
            </div>
            {groupedNames.length > 0 && (
              <p className="mt-2 text-[11px] text-ink-3">
                “Other” groups {groupedNames.length} smaller subcategories — hover
                a bar for the full breakdown.
              </p>
            )}
          </>
        )}
      </div>

      {/* Summary table (exhaustive — never grouped) */}
      {!loading && summary.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border border-line bg-surface px-5 pt-[14px] pb-4 shadow-md">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-left">
              <th className="label py-2.5">Subcategory</th>
              <th className="label py-2.5">Category</th>
              <th className="label py-2.5 text-right">Tasks</th>
              <th className="label py-2.5 text-right">Est. time</th>
              <th className="label py-2.5 text-right">% total</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.subcategoryId} className="border-b border-line">
                <td className="py-3">
                  <span className="inline-flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-[2px]"
                      style={{
                        background:
                          subMeta.get(row.subcategoryId)?.color ?? OTHER_COLOR,
                      }}
                    />
                    <span className="text-ink">{row.name}</span>
                  </span>
                </td>
                <td className="py-3 text-ink-3">{catName(row.categoryId)}</td>
                <td className="num py-3 text-right text-ink-2">{row.tasks}</td>
                <td className="num py-3 text-right text-ink-2">
                  {fmtMinutes(row.minutes)}
                </td>
                <td className="num py-3 text-right text-ink-2">
                  {row.pct.toFixed(1)}%
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-3 font-semibold">Total</td>
              <td />
              <td />
              <td className="num py-3 text-right font-semibold">
                {fmtMinutes(grandTotal)}
              </td>
              <td className="num py-3 text-right font-semibold">100.0%</td>
            </tr>
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
