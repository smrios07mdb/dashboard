/**
 * Category + formatting helpers (prototype `primitives.jsx`).
 *
 * `catColor` / `catSoft` return the LIVE CSS vars — never hex — so they track
 * the active `data-catpalette` (emerald by default → Work emerald / Personal rose).
 */

export type CategoryName = 'Work' | 'Personal'

/** Category accent color as a CSS var: `--work` for Work, `--personal` otherwise. */
export function catColor(name: string): string {
  return name === 'Work' ? 'var(--work)' : 'var(--personal)'
}

/** Category soft wash as a CSS var: `--work-soft` / `--personal-soft`. */
export function catSoft(name: string): string {
  return name === 'Work' ? 'var(--work-soft)' : 'var(--personal-soft)'
}

/**
 * Minutes → "1h 30m" / "45m" / "1h" / "0m". Matches the prototype's `fmtMin`
 * and the (currently per-screen) `formatMinutes` implementations exactly.
 */
export function fmtMin(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
