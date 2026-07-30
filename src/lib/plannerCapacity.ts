/*
 * Week Planner capacity math (chunk 36).
 *
 * `computeCapacity` / `computeDayFree` ported from the handoff prototype's
 * `planner-primitives.jsx` with their full signatures (busy + scheduled
 * inputs) so chunk 37 only has to supply real scheduled blocks — this
 * chunk always passes `scheduled = []` and renders "0m planned" honestly.
 *
 * The prototype read `today` / `now` from its mock-data globals; here they
 * are explicit parameters. `today` is the index of the local today within
 * the displayed week (see `todayIndex` in plannerGeometry) and may fall
 * outside 0–6 when a past/future week is shown.
 */

import { ceil15, PLANNER } from '@/lib/plannerGeometry'

/** A planner interval in local wall-clock minutes on a week-day index. */
export type CapacityInterval = {
  /** 0=Mon … 6=Sun. */
  day: number
  startMin: number
  endMin: number
}

/** Overlap of [s, e] with the window [wS, wE], clamped to ≥ 0. */
function clipWin(s: number, e: number, wS: number, wE: number): number {
  return Math.max(0, Math.min(e, wE) - Math.max(s, wS))
}

/**
 * Week capacity: `planned` = total scheduled minutes (anywhere);
 * `free` = Mon–Fri 09:00–18:00 minus busy minus scheduled, both clipped to
 * that window, floored at 0.
 */
export function computeCapacity(
  busy: CapacityInterval[],
  scheduled: CapacityInterval[],
): { planned: number; free: number } {
  const { workStart, workEnd } = PLANNER
  let busyM = 0
  let schedInWin = 0
  let planned = 0
  for (const b of busy) {
    if (b.day < 5) busyM += clipWin(b.startMin, b.endMin, workStart, workEnd)
  }
  for (const t of scheduled) {
    planned += t.endMin - t.startMin
    if (t.day < 5) schedInWin += clipWin(t.startMin, t.endMin, workStart, workEnd)
  }
  return {
    planned,
    free: Math.max(0, 5 * (workEnd - workStart) - busyM - schedInWin),
  }
}

/**
 * Remaining free minutes on one day inside the 09:00–18:00 window.
 *
 * - past days (day < today) → `null` (the header renders `—`)
 * - today → counted from `nowMin` rounded up to the next 15m boundary
 * - future days → the full window
 *
 * Weekends are the caller's concern: the prototype simply never asks for
 * them (headers pass `undefined` through), and this port keeps that split.
 */
export function computeDayFree(
  day: number,
  busy: CapacityInterval[],
  scheduled: CapacityInterval[],
  today: number,
  nowMin: number,
): number | null {
  const { workStart, workEnd } = PLANNER
  if (day < today) return null
  const wS = day === today ? Math.max(workStart, ceil15(nowMin)) : workStart
  let occ = 0
  for (const o of [...busy, ...scheduled]) {
    if (o.day === day) occ += clipWin(o.startMin, o.endMin, wS, workEnd)
  }
  return Math.max(0, workEnd - wS - occ)
}
