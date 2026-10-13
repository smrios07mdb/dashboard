import type { Category, Subcategory } from '@/db/types'

import { dateKeyIn } from './clock'

/*
 * Quick-capture grammar (chunk 73, UX audit #7). One line of text in, a title
 * plus whatever signal it carried out: `Call Bob tomorrow p1 15m #work`.
 *
 * Pure: no React, no I/O, no clock read — `now` and `timeZone` are passed in.
 * "Today" is the calendar day of `now` in `timeZone`, and every day step runs
 * on that `YYYY-MM-DD` key through `Date.UTC`, so the result is the same in
 * every runner time zone.
 *
 * A word is recognised only whole, case-insensitively, and only the first
 * word of each kind counts; anything else stays in the title.
 */

export type CaptureTokenKind = 'priority' | 'estimate' | 'due' | 'list'

export type CaptureToken = {
  /** Word index in the input (split on whitespace). */
  index: number
  /** The word as typed. */
  text: string
  kind: CaptureTokenKind
  /** Chip text: 'P1', '15m', '1h 30m', 'Today', 'Fri Oct 16', 'Work › Deals', 'Work'. */
  label: string
}

export type CaptureParse = {
  /** Unrecognised words, single-spaced, trimmed. */
  title: string
  priority: 1 | 2 | 3 | null
  estimateMinutes: number | null
  /** 'YYYY-MM-DD', a calendar day in `timeZone`. */
  dueDay: string | null
  /** From a `#list` token. */
  subcategoryId: string | null
  /** From `#work` / `#personal`, or the matched subcategory's category. */
  categoryId: string | null
  /** Recognised words, in input order. */
  tokens: CaptureToken[]
  /** '#foo' words that matched nothing (kept in the title). */
  unknownTags: string[]
}

export type CaptureContext = {
  now: Date
  timeZone: string
  categories: Category[]
  /** Live only; the caller filters `archivedAt`. */
  subcategories: Subcategory[]
  /** Word indices the user un-parsed (the chip ×). */
  ignore?: ReadonlySet<number>
}

const MAX_MINUTES = 24 * 60
const DAY_MS = 86_400_000

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Lowercased, with everything but letters and digits removed. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` for y/m/d, or null when that is not a real date (2/30). */
function realDayKey(y: number, m: number, d: number): string | null {
  const at = new Date(Date.UTC(y, m - 1, d))
  if (at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null
  return utcToKey(at.getTime())
}

function parseEstimate(word: string): number | null {
  const mins = /^(\d+)(?:m|min)$/.exec(word)
  const hours = /^(\d+(?:\.\d+)?)h(?:(\d+)m)?$/.exec(word)
  let n: number
  if (mins) n = Number(mins[1])
  else if (hours) n = Math.round(Number(hours[1]) * 60) + Number(hours[2] ?? 0)
  else return null
  return n >= 1 && n <= MAX_MINUTES ? n : null
}

function estimateLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function parseDue(word: string, todayKey: string): string | null {
  const today = keyToUtc(todayKey)
  if (word === 'today' || word === 'tod') return todayKey
  if (word === 'tomorrow' || word === 'tmr' || word === 'tmrw') {
    return utcToKey(today + DAY_MS)
  }
  const weekday = WEEKDAYS[word]
  if (weekday !== undefined) {
    // Always the next one after today: `fri` typed on a Friday is next Friday.
    const ahead = (weekday - new Date(today).getUTCDay() + 7) % 7 || 7
    return utcToKey(today + ahead * DAY_MS)
  }
  const md = /^(\d{1,2})\/(\d{1,2})$/.exec(word)
  if (md) {
    const year = Number(todayKey.slice(0, 4))
    const thisYear = realDayKey(year, Number(md[1]), Number(md[2]))
    if (thisYear && thisYear >= todayKey) return thisYear
    return realDayKey(year + 1, Number(md[1]), Number(md[2]))
  }
  return null
}

function dueLabel(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return 'Today'
  const at = new Date(keyToUtc(dayKey))
  if (at.getTime() - keyToUtc(todayKey) === DAY_MS) return 'Tomorrow'
  return `${DAY_NAMES[at.getUTCDay()]} ${MONTH_NAMES[at.getUTCMonth()]} ${at.getUTCDate()}`
}

const bySortOrder = (a: Subcategory, b: Subcategory) => a.sortOrder - b.sortOrder

export function parseCapture(input: string, ctx: CaptureContext): CaptureParse {
  const words = input.split(/\s+/).filter((w) => w.length > 0)
  const ignored = (i: number) => ctx.ignore?.has(i) ?? false
  const todayKey = dateKeyIn(ctx.now, ctx.timeZone)

  const out: CaptureParse = {
    title: '',
    priority: null,
    estimateMinutes: null,
    dueDay: null,
    subcategoryId: null,
    categoryId: null,
    tokens: [],
    unknownTags: [],
  }
  const tokenAt = new Map<number, CaptureToken>()
  const take = (index: number, kind: CaptureTokenKind, label: string) =>
    tokenAt.set(index, { index, text: words[index], kind, label })

  // List words first: a category token anywhere in the input narrows which
  // subcategories a `#list` word can match, whichever comes first.
  const slugs = words.map((w, i) => {
    if (ignored(i)) return null
    const m = /^#([\p{L}\p{N}_-]+)$/u.exec(w)
    return m ? norm(m[1]) : null
  })
  const categoryOf = (slug: string) =>
    slug === 'work' || slug === 'personal'
      ? ctx.categories.find((c) => c.name.toLowerCase() === slug)
      : undefined
  const categoryIndex = slugs.findIndex((s) => s !== null && categoryOf(s) !== undefined)
  const category = categoryIndex >= 0 ? categoryOf(slugs[categoryIndex]!) : undefined
  if (category) {
    out.categoryId = category.id
    take(categoryIndex, 'list', category.name)
  }

  const searched = category ? [category] : ctx.categories
  slugs.forEach((slug, i) => {
    if (slug === null || i === categoryIndex) return
    // A second category word is not a second list token; it stays in the title.
    if (categoryOf(slug)) return
    let match: { sub: Subcategory; cat: Category } | undefined
    for (const cat of searched) {
      const sub = ctx.subcategories
        .filter((s) => s.categoryId === cat.id)
        .sort(bySortOrder)
        .find((s) => slug !== '' && norm(s.name) === slug)
      if (sub) {
        match = { sub, cat }
        break
      }
    }
    if (!match) {
      out.unknownTags.push(words[i])
      return
    }
    if (out.subcategoryId !== null) return
    out.subcategoryId = match.sub.id
    out.categoryId = match.cat.id
    take(i, 'list', `${match.cat.name} › ${match.sub.name}`)
  })

  words.forEach((word, i) => {
    if (ignored(i) || tokenAt.has(i)) return
    const w = word.toLowerCase()

    if (out.priority === null && /^p[123]$/.test(w)) {
      out.priority = Number(w[1]) as 1 | 2 | 3
      take(i, 'priority', `P${w[1]}`)
      return
    }
    if (out.estimateMinutes === null) {
      const minutes = parseEstimate(w)
      if (minutes !== null) {
        out.estimateMinutes = minutes
        take(i, 'estimate', estimateLabel(minutes))
        return
      }
    }
    if (out.dueDay === null) {
      const day = parseDue(w, todayKey)
      if (day !== null) {
        out.dueDay = day
        take(i, 'due', dueLabel(day, todayKey))
      }
    }
  })

  out.tokens = [...tokenAt.values()].sort((a, b) => a.index - b.index)
  out.title = words.filter((_, i) => !tokenAt.has(i)).join(' ')
  return out
}

/**
 * Where a capture goes (chunk 73, D1). First match wins:
 *   1. the parse's subcategory token;
 *   2. the list picked in the dialog, then the remembered one — each only if
 *      still live and, under a category token, in that category;
 *   3. the first live `General` in Personal, then Work;
 *   4. the first live subcategory of Personal, then Work.
 * A category token narrows 2–4 to that category. Null: there is no live list.
 */
export function resolveCaptureDest(
  parse: Pick<CaptureParse, 'subcategoryId' | 'categoryId'>,
  ctx: {
    categories: Category[]
    /** Live only. */
    subcategories: Subcategory[]
    picked?: string | null
    remembered?: string | null
  },
): Subcategory | null {
  const live = [...ctx.subcategories].sort(bySortOrder)
  const tagged = live.find((s) => s.id === parse.subcategoryId)
  if (tagged) return tagged

  const pool = parse.categoryId
    ? live.filter((s) => s.categoryId === parse.categoryId)
    : live
  for (const id of [ctx.picked, ctx.remembered]) {
    const sub = id ? pool.find((s) => s.id === id) : undefined
    if (sub) return sub
  }

  const groups = (['Personal', 'Work'] as const).map((name) => {
    const cat = ctx.categories.find((c) => c.name === name)
    return cat ? pool.filter((s) => s.categoryId === cat.id) : []
  })
  for (const subs of groups) {
    const general = subs.find((s) => s.name.trim().toLowerCase() === 'general')
    if (general) return general
  }
  for (const subs of groups) {
    if (subs[0]) return subs[0]
  }
  return null
}
