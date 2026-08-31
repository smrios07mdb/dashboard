import { useEffect, useRef, useState } from 'react'

import { Sun, X } from '@/components/icons'
import { Checkbox } from '@/components/ui/checkbox'
import { IconBtn } from '@/components/ui/icon-button'
import type { Category, Subcategory, Task } from '@/db/types'
import { catColor, fmtMin } from '@/lib/cat'
import { resolveToday, type TodayRow as TodayRowData } from '@/lib/today'

/*
 * "Today" — the day's plan, surfaced on the dashboard alongside the lists.
 *
 * Ported from `today_list_handoff/prototype/today.jsx` to the repo's idioms:
 * the shadcn `Checkbox`, the `IconBtn` primitive, the centralized `Sun` / `X`
 * icons, and the real `catColor` / `fmtMin` helpers. Three layouts behind one
 * setting — `stacked` (the prototype's `section`) | `rail` | `banner` — plus
 * `off`, which renders nothing.
 *
 * Reconciliations honored:
 *   - ONE color per row = the category color (`--work` / `--personal`), on the
 *     left edge, the subgroup pill, and the status chip. Never colored by
 *     status — the chip conveys status by its text label only.
 *   - `--accent` in this codebase is an HSL triplet (consumed as
 *     `hsl(var(--accent))`), so every accent use below wraps it accordingly —
 *     the prototype's bare `var(--accent)` would not resolve here.
 */

const TODAY_HEIGHT_KEY = 'hup:todayHeight'
const MIN_H = 120
const MAX_H = 760
const DEFAULT_H = 360

export type TodayVariant = 'stacked' | 'rail' | 'banner' | 'off'

export type TodayPanelProps = {
  data: {
    categories: Category[]
    subcategories: Subcategory[]
    tasks: Task[]
  }
  todaySet: Set<string>
  /** Drives Today membership only (remove = force off). */
  onToggleToday: (id: string, force?: boolean) => void
  /** The app's real task-completion action, wired from the dashboard. */
  onCompleteTask: (id: string, completed: boolean) => void | Promise<void>
  variant: TodayVariant
  /** Touch/mobile: list flows full-height, no resize handle, no sticky rail. */
  mobile?: boolean
}

function todayDateLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

// ── one task line inside the Today plan ─────────────────────────────────────
function TodayRow({
  row,
  onToggle,
  onRemove,
  compact,
}: {
  row: TodayRowData
  onToggle: () => void
  onRemove: () => void
  compact?: boolean
}) {
  const { task, reason, subName, catName } = row
  const completed = !!task.completedAt
  const cat = catColor(catName)
  return (
    <div
      className="relative grid items-center transition-[background-color,opacity] hover:bg-bg-alt/60"
      style={{
        gridTemplateColumns: '22px 1fr auto auto',
        gap: 11,
        padding: compact ? '7px 10px' : '9px 12px',
        borderRadius: 'var(--radius)',
        borderLeft: `3px solid ${completed ? 'transparent' : cat}`,
        paddingLeft: completed ? (compact ? 10 : 12) : compact ? 7 : 9,
        opacity: completed ? 0.5 : 1,
        transition: 'background-color .12s, opacity .35s ease',
      }}
    >
      <Checkbox
        checked={completed}
        aria-label={completed ? 'Mark task incomplete' : 'Mark task complete'}
        onCheckedChange={() => onToggle()}
      />
      <div className="min-w-0">
        <div
          className="overflow-hidden text-ellipsis whitespace-nowrap"
          style={{
            fontSize: 13.5,
            color: 'var(--ink)',
            lineHeight: 1.35,
            textDecoration: completed ? 'line-through' : 'none',
            textDecorationColor: 'var(--ink-3)',
          }}
          title={task.title}
        >
          {task.title}
        </div>
        <div
          className="flex min-w-0 items-center"
          style={{ gap: 6, marginTop: 4 }}
        >
          <span
            className="inline-flex flex-shrink-0 items-center overflow-hidden"
            style={{
              gap: 5,
              fontSize: 11,
              fontWeight: 500,
              color: cat,
              padding: '2px 8px 2px 6px',
              borderRadius: 999,
              background: `color-mix(in srgb, ${cat} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${cat} 22%, transparent)`,
              maxWidth: 170,
            }}
            title={catName ? `${catName} · ${subName}` : subName}
          >
            <span
              className="flex-shrink-0"
              style={{ width: 6, height: 6, borderRadius: 2, background: cat }}
            />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {subName}
            </span>
          </span>
          {!completed && (
            <span
              className="num flex-shrink-0"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: cat,
                padding: '1px 6px',
                borderRadius: 999,
                background: `color-mix(in srgb, ${cat} 12%, transparent)`,
              }}
            >
              {reason.label}
            </span>
          )}
        </div>
      </div>
      <span
        className="num whitespace-nowrap"
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        {fmtMin(task.estimateMinutes)}
      </span>
      <IconBtn
        size={24}
        label={`Remove "${task.title}" from Today`}
        tone="ghost"
        onClick={onRemove}
      >
        <X size={13} />
      </IconBtn>
    </div>
  )
}

// compact chip used by the banner layout
function TodayChip({
  row,
  onToggle,
}: {
  row: TodayRowData
  onToggle: () => void
}) {
  const { task, catName } = row
  const completed = !!task.completedAt
  const cat = catColor(catName)
  return (
    <button
      type="button"
      onClick={onToggle}
      title={task.title}
      aria-label={completed ? 'Mark task incomplete' : 'Mark task complete'}
      className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        gap: 8,
        padding: '7px 12px 7px 9px',
        borderRadius: 999,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-sm)',
        maxWidth: 280,
        opacity: completed ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden
        className="inline-flex flex-shrink-0 items-center justify-center"
        style={{
          width: 15,
          height: 15,
          borderRadius: 5,
          border: `1.4px solid ${completed ? 'hsl(var(--accent))' : cat}`,
          background: completed ? 'hsl(var(--accent))' : 'transparent',
        }}
      >
        {completed && (
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12l5 5L20 6" />
          </svg>
        )}
      </span>
      <span
        className="overflow-hidden text-ellipsis whitespace-nowrap"
        style={{
          fontSize: 12.5,
          color: 'var(--ink)',
          fontWeight: 500,
          textDecoration: completed ? 'line-through' : 'none',
          textDecorationColor: 'var(--ink-3)',
        }}
      >
        {task.title}
      </span>
      <span
        className="num flex-shrink-0"
        style={{ fontSize: 11, color: 'var(--ink-3)' }}
      >
        {fmtMin(task.estimateMinutes)}
      </span>
    </button>
  )
}

// ── the panel ───────────────────────────────────────────────────────────────
export default function TodayPanel({
  data,
  todaySet,
  onToggleToday,
  onCompleteTask,
  variant,
  mobile = false,
}: TodayPanelProps) {
  // Let a just-completed task linger ~1s so the strike-through reads before the
  // row drops. (Hooks run before the `off` early-return so hook order is stable.)
  const [linger, setLinger] = useState<Set<string>>(() => new Set())
  const prev = useRef(data.tasks)
  useEffect(() => {
    const pm = new Map(prev.current.map((t) => [t.id, t]))
    const newlyDone = data.tasks.filter(
      (t) => t.completedAt && pm.has(t.id) && !pm.get(t.id)!.completedAt,
    )
    prev.current = data.tasks
    if (newlyDone.length === 0) return
    setLinger((s) => {
      const n = new Set(s)
      newlyDone.forEach((t) => n.add(t.id))
      return n
    })
    newlyDone.forEach((t) =>
      setTimeout(
        () =>
          setLinger((s) => {
            const n = new Set(s)
            n.delete(t.id)
            return n
          }),
        1000,
      ),
    )
  }, [data.tasks])

  // ── resizable list height (stacked/rail only, persisted) ──
  const [listH, setListH] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_H
    try {
      const v = Number.parseInt(
        localStorage.getItem(TODAY_HEIGHT_KEY) ?? '',
        10,
      )
      return Number.isFinite(v) ? Math.min(MAX_H, Math.max(MIN_H, v)) : DEFAULT_H
    } catch {
      return DEFAULT_H
    }
  })

  const banner = variant === 'banner'
  const rail = variant === 'rail'

  const onResizeStart = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => {
    e.preventDefault()
    const startY =
      'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
    const startH = listH
    let latest = startH
    const move = (ev: MouseEvent | TouchEvent) => {
      const y =
        'touches' in ev ? ev.touches[0].clientY : (ev as MouseEvent).clientY
      if (ev.cancelable) ev.preventDefault()
      latest = Math.min(MAX_H, Math.max(MIN_H, startH + (y - startY)))
      setListH(latest)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
      document.body.style.userSelect = ''
      try {
        localStorage.setItem(TODAY_HEIGHT_KEY, String(Math.round(latest)))
      } catch {
        // best-effort persistence
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', up)
    document.body.style.userSelect = 'none'
  }

  const resetH = () => {
    setListH(DEFAULT_H)
    try {
      localStorage.setItem(TODAY_HEIGHT_KEY, String(DEFAULT_H))
    } catch {
      // best-effort persistence
    }
  }

  // Keyboard resize (nice-to-have; handle is role="separator").
  const onResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setListH((h) => {
        const next = Math.min(
          MAX_H,
          Math.max(MIN_H, h + (e.key === 'ArrowUp' ? -step : step)),
        )
        try {
          localStorage.setItem(TODAY_HEIGHT_KEY, String(next))
        } catch {
          // best-effort
        }
        return next
      })
    } else if (e.key === 'Home') {
      e.preventDefault()
      resetH()
    }
  }

  if (variant === 'off') return null

  const all = resolveToday(data, todaySet)
  const open = all.filter((r) => !r.task.completedAt)
  const visible = all.filter((r) => !r.task.completedAt || linger.has(r.task.id))
  const doneCount = all.length - open.length
  const minutes = open.reduce((s, r) => s + r.task.estimateMinutes, 0)
  const pct = all.length ? doneCount / all.length : 0

  const toggle = (r: TodayRowData) =>
    onCompleteTask(r.task.id, !r.task.completedAt)
  const remove = (r: TodayRowData) => onToggleToday(r.task.id, false)

  // ── header ──
  const header = (
    <div
      className="flex justify-between"
      style={{
        alignItems: banner ? 'center' : 'flex-end',
        gap: 14,
        flexWrap: banner ? 'wrap' : 'nowrap',
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center" style={{ gap: 9 }}>
          <span
            className="inline-flex flex-shrink-0 items-center justify-center"
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: 'color-mix(in srgb, hsl(var(--accent)) 14%, transparent)',
              color: 'hsl(var(--accent))',
            }}
          >
            <Sun size={14} />
          </span>
          <h2
            className="display"
            style={{
              margin: 0,
              fontSize: rail ? 19 : 22,
              fontWeight: 500,
              letterSpacing: '-.015em',
              color: 'var(--ink)',
            }}
          >
            Today
          </h2>
          <span className="label" style={{ fontSize: 9.5 }}>
            {todayDateLabel()}
          </span>
        </div>
        {!banner && (
          <p
            style={{
              margin: '7px 0 0 31px',
              fontSize: 12.5,
              color: 'var(--ink-3)',
            }}
          >
            {open.length === 0 ? (
              doneCount > 0 ? (
                'Plan cleared — every today task done.'
              ) : (
                'Nothing planned yet.'
              )
            ) : (
              <>
                <span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                  {open.length}
                </span>{' '}
                to do · <span className="num">{fmtMin(minutes)}</span>
                {doneCount > 0 && (
                  <span>
                    {' '}
                    · <span className="num">{doneCount}</span> done
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </div>
      {all.length > 0 && (
        <div
          className="flex-shrink-0 text-right"
          style={{ minWidth: banner ? 'auto' : 92 }}
        >
          <div
            className="flex items-baseline justify-end"
            style={{ gap: 5 }}
          >
            <span
              className="num display"
              style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}
            >
              {doneCount}
            </span>
            <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              / {all.length}
            </span>
          </div>
          <div
            style={{
              height: 5,
              width: banner ? 96 : '100%',
              minWidth: 72,
              borderRadius: 999,
              background: 'var(--bg-alt)',
              overflow: 'hidden',
              marginTop: 5,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct * 100}%`,
                borderRadius: 999,
                background: 'linear-gradient(90deg, var(--work), hsl(var(--accent)))',
                transition: 'width .9s cubic-bezier(.2,.7,.2,1)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )

  // ── body ──
  let bodyEl: React.ReactNode
  if (banner) {
    bodyEl =
      visible.length === 0 ? null : (
        <div
          className="flex flex-wrap items-center"
          style={{ gap: 9, marginTop: 12 }}
        >
          {visible.map((r) => (
            <TodayChip key={r.task.id} row={r} onToggle={() => toggle(r)} />
          ))}
        </div>
      )
  } else if (visible.length === 0) {
    bodyEl = (
      <div
        className="text-center"
        style={{
          marginTop: 14,
          padding: '20px 16px',
          border: '1px dashed var(--line-strong)',
          borderRadius: 'var(--radius)',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: 'var(--ink-3)',
            lineHeight: 1.5,
          }}
        >
          {doneCount > 0 ? 'All done for today. ' : ''}Tap the{' '}
          <Sun
            size={12}
            style={{ display: 'inline', verticalAlign: '-2px', margin: '0 1px' }}
          />{' '}
          on any task to plan your day.
        </p>
      </div>
    )
  } else {
    bodyEl = (
      <>
        <div
          className="lst flex flex-col"
          style={{
            marginTop: 12,
            gap: 2,
            maxHeight: mobile ? 'none' : listH,
            overflowY: mobile ? 'visible' : 'auto',
          }}
        >
          {visible.map((r) => (
            <TodayRow
              key={r.task.id}
              row={r}
              compact={rail}
              onToggle={() => toggle(r)}
              onRemove={() => remove(r)}
            />
          ))}
        </div>
        {!mobile && (
          <div
            onMouseDown={onResizeStart}
            onTouchStart={onResizeStart}
            onDoubleClick={resetH}
            onKeyDown={onResizeKey}
            title="Drag to resize · double-click to reset"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize Today list"
            tabIndex={0}
            className="group flex items-center justify-center focus-visible:outline-none"
            style={{
              marginTop: 4,
              height: 16,
              cursor: 'ns-resize',
              touchAction: 'none',
            }}
          >
            <span
              className="group-hover:!bg-ink-3 group-focus-visible:!bg-ink-3"
              style={{
                width: 34,
                height: 4,
                borderRadius: 999,
                background: 'var(--line-strong)',
                transition: 'background .12s',
              }}
            />
          </div>
        )}
      </>
    )
  }

  return (
    <div
      style={{
        background: rail
          ? 'linear-gradient(180deg, color-mix(in srgb, hsl(var(--accent)) 7%, var(--surface)), var(--surface))'
          : 'linear-gradient(135deg, var(--surface), var(--surface-2))',
        border: '1px solid var(--line)',
        borderTop: rail ? '3px solid hsl(var(--accent))' : '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        padding: banner ? '14px 18px' : '18px 18px 16px',
        position: rail && !mobile ? 'sticky' : 'static',
        top: rail && !mobile ? 84 : 'auto',
      }}
    >
      {header}
      {bodyEl}
    </div>
  )
}
