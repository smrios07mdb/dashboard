import type { Category, Subcategory, Task } from '@/db/types'

/*
 * Gamify scoring — the pure data layer behind the Daily Progress Hero
 * (redesign chunk 26). Ported from `hupomnemata_handoff/app/src/gamify.jsx`
 * and typed against the real data model. Everything here is pure (no
 * `new Date()` / `Date.now()` reliance), so the unit tests need no clock mock.
 *
 * Scope note — the hero's figures are computed over tasks under LIVE
 * (non-archived) subcategories only. The prototype had no archiving; our app
 * does. Callers pass the already-filtered task / subcategory lists (the same
 * `liveSubIds` filter Dashboard.tsx builds) so the ring, bars, and counts
 * stay consistent with the visible columns. See chunk-26 note E.
 *
 * The hero's streak is NOT computed here — it uses the canonical routines
 * streak in `src/lib/streak.ts` (ARCH §11), computed by the Dashboard. This
 * module owns only the task-derived figures (XP, level, completion ratio).
 */

/** Aggregate progress + XP/level snapshot for the hero ring and chips. */
export type Stats = {
  total: number
  done: number
  open: number
  xp: number
  level: number
  /** Fraction (0–1) of the way into the current level — drives the sliver. */
  intoLevel: number
  /** done / total over the passed tasks (0 when there are none). */
  ratio: number
}

/** Per-category completion, for the Work / Personal progress bars. */
export type CatProgress = {
  done: number
  total: number
  ratio: number
}

/** XP a single task is worth: a flat 10 plus its estimate in minutes. */
export function taskXP(t: Task): number {
  return 10 + t.estimateMinutes
}

/** XP needed to advance one level. */
const XP_PER_LEVEL = 300

/**
 * Roll a set of tasks into the hero's headline stats. Pass the live-
 * subcategory-filtered task list so archived work doesn't skew the figures.
 */
export function calcStats(tasks: Task[]): Stats {
  const done = tasks.filter((t) => t.completedAt)
  const xp = done.reduce((sum, t) => sum + taskXP(t), 0)
  const level = 1 + Math.floor(xp / XP_PER_LEVEL)
  const intoLevel = (xp % XP_PER_LEVEL) / XP_PER_LEVEL
  return {
    total: tasks.length,
    done: done.length,
    open: tasks.length - done.length,
    xp,
    level,
    intoLevel,
    ratio: tasks.length ? done.length / tasks.length : 0,
  }
}

/**
 * Done / total / ratio for the tasks under a category's subcategories.
 * Pass the live subcategory list so archived subs are excluded; tasks under
 * subs not present in that list simply don't match and are ignored.
 */
export function catProgress(
  tasks: Task[],
  subcategories: Subcategory[],
  categories: Category[],
  catName: string,
): CatProgress {
  const cat = categories.find((c) => c.name === catName)
  if (!cat) return { done: 0, total: 0, ratio: 0 }
  const subIds = new Set(
    subcategories.filter((s) => s.categoryId === cat.id).map((s) => s.id),
  )
  const ts = tasks.filter((t) => subIds.has(t.subcategoryId))
  const done = ts.filter((t) => t.completedAt).length
  return { done, total: ts.length, ratio: ts.length ? done / ts.length : 0 }
}
