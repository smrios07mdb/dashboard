/*
 * Site-blocking rules (chunk 99, ARCHITECTURE.md §4 "Block groups"). Pure.
 *
 * A domain is stored lowercase, without scheme, path, port or a leading
 * `www.`. A rule for `x.com` matches `x.com` and every subdomain, never
 * `notx.com` — the match itself is the menu bar shell's (`blocker.rs`); this
 * file only normalizes what the user types and summarizes a group.
 */
import type { BlockGroup } from '@/db/types'

export const MAX_GROUPS = 20
export const MAX_DOMAINS = 50
export const MAX_NAME = 40

const DOMAIN_RE = /^[a-z0-9.-]{1,253}$/

/** D2's rule: the same test as the shell's `valid_domain`. */
export function isValidDomain(d: string): boolean {
  return (
    DOMAIN_RE.test(d) &&
    d.includes('.') &&
    !d.includes('..') &&
    !/^[.-]/.test(d) &&
    !/[.-]$/.test(d)
  )
}

/**
 * A bare domain or a pasted URL → the stored domain, or `null` when it is
 * not a site address. A path is dropped (path rules are not supported).
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  s = s.split(/[/?#]/, 1)[0] ?? ''
  const at = s.lastIndexOf('@')
  if (at >= 0) s = s.slice(at + 1)
  s = s.replace(/:\d*$/, '')
  if (s.startsWith('www.')) s = s.slice(4)
  return isValidDomain(s) ? s : null
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Monday first, the order the summary reads days in. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** `HH:MM` → `9:00 AM`. Fixed format, not the locale's. */
export function clockLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** `[1,2,3,4,5]` → `Mon–Fri`; every day → `Every day`; else a list. */
export function daysLabel(days: number[]): string {
  const set = new Set(days)
  const ordered = WEEK_ORDER.filter((d) => set.has(d))
  if (ordered.length === 7) return 'Every day'
  if (ordered.length === 0) return 'No days'
  const first = WEEK_ORDER.indexOf(ordered[0]!)
  const contiguous = ordered.every((d, i) => WEEK_ORDER[first + i] === d)
  if (contiguous && ordered.length >= 3) {
    return `${SHORT_DAYS[ordered[0]!]}–${SHORT_DAYS[ordered[ordered.length - 1]!]}`
  }
  return ordered.map((d) => SHORT_DAYS[d]).join(', ')
}

/** `Focus`, `Mon–Fri 9:00 AM – 5:00 PM`, both joined by ` · `, or `No trigger`. */
export function ruleSummary(
  group: Pick<
    BlockGroup,
    | 'blockInFocus'
    | 'blockOnSchedule'
    | 'scheduleDays'
    | 'scheduleFrom'
    | 'scheduleTo'
  >,
): string {
  const parts: string[] = []
  if (group.blockInFocus) parts.push('Focus')
  if (group.blockOnSchedule) {
    parts.push(
      `${daysLabel(group.scheduleDays)} ${clockLabel(group.scheduleFrom)} – ${clockLabel(group.scheduleTo)}`,
    )
  }
  return parts.length ? parts.join(' · ') : 'No trigger'
}
