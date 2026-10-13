import { describe, expect, it } from 'vitest'

import type { Category, Subcategory } from '@/db/types'

import { parseCapture, resolveCaptureDest } from './captureParse'

/*
 * Chunk 73 (UX audit #7): the quick-capture grammar. `now` is a Tuesday in
 * New York; every expectation is a calendar day in the passed zone, so the
 * suite reads the same under any runner TZ.
 */

const NOW = new Date('2026-10-13T16:00:00Z')
const TZ = 'America/New_York'

// Repo order: `categoriesRepo.list` sorts by name — Personal, then Work.
const categories: Category[] = [
  { id: 'cat-p', userId: 'u', name: 'Personal' },
  { id: 'cat-w', userId: 'u', name: 'Work' },
]
const sub = (id: string, categoryId: string, name: string, sortOrder: number): Subcategory => ({
  id,
  userId: 'u',
  categoryId,
  name,
  sortOrder,
  archivedAt: null,
})
const subcategories: Subcategory[] = [
  sub('p-general', 'cat-p', 'General', 0),
  sub('p-errands', 'cat-p', 'Errands', 1),
  sub('w-general', 'cat-w', 'General', 0),
  sub('w-deals', 'cat-w', 'Deals', 1),
  sub('w-hiring', 'cat-w', 'Hiring Plan', 2),
]

const parse = (
  input: string,
  over: { now?: Date; timeZone?: string; ignore?: ReadonlySet<number> } = {},
) =>
  parseCapture(input, {
    now: over.now ?? NOW,
    timeZone: over.timeZone ?? TZ,
    categories,
    subcategories,
    ignore: over.ignore,
  })

describe('parseCapture (chunk 73)', () => {
  it('(1) reads priority, estimate, due day and category out of one line', () => {
    const p = parse('Call Bob tomorrow p1 15m #work')
    expect(p.title).toBe('Call Bob')
    expect(p.priority).toBe(1)
    expect(p.estimateMinutes).toBe(15)
    expect(p.dueDay).toBe('2026-10-14')
    expect(p.categoryId).toBe('cat-w')
    expect(p.subcategoryId).toBeNull()
    expect(p.tokens).toEqual([
      { index: 2, text: 'tomorrow', kind: 'due', label: 'Tomorrow' },
      { index: 3, text: 'p1', kind: 'priority', label: 'P1' },
      { index: 4, text: '15m', kind: 'estimate', label: '15m' },
      { index: 5, text: '#work', kind: 'list', label: 'Work' },
    ])
    expect(p.unknownTags).toEqual([])
  })

  it('(2) a weekday is the next one after today; `today` is the word for today', () => {
    expect(parse('fri').dueDay).toBe('2026-10-16')
    expect(parse('fri').tokens[0].label).toBe('Fri Oct 16')
    expect(parse('tue').dueDay).toBe('2026-10-20')
    expect(parse('Thursday').dueDay).toBe('2026-10-15')
    expect(parse('today').dueDay).toBe('2026-10-13')
    expect(parse('today').tokens[0].label).toBe('Today')
    expect(parse('tmrw').dueDay).toBe('2026-10-14')
  })

  it('(3) M/D is this year if today or later, else next year; impossible dates stay words', () => {
    expect(parse('10/24').dueDay).toBe('2026-10-24')
    expect(parse('1/5').dueDay).toBe('2027-01-05')
    expect(parse('1/5').tokens[0].label).toBe('Tue Jan 5')
    expect(parse('10/13').dueDay).toBe('2026-10-13')
    const bad = parse('pay rent 2/30')
    expect(bad.dueDay).toBeNull()
    expect(bad.title).toBe('pay rent 2/30')
    expect(bad.tokens).toEqual([])
  })

  it('(4) estimates: minutes, hours, decimals, h+m; out of range is not recognised', () => {
    expect(parse('2h').estimateMinutes).toBe(120)
    expect(parse('2h').tokens[0].label).toBe('2h')
    expect(parse('1.5h').estimateMinutes).toBe(90)
    expect(parse('1h30m').estimateMinutes).toBe(90)
    expect(parse('1h30m').tokens[0].label).toBe('1h 30m')
    expect(parse('45min').estimateMinutes).toBe(45)
    for (const word of ['0m', '25h']) {
      const p = parse(word)
      expect(p.estimateMinutes).toBeNull()
      expect(p.title).toBe(word)
    }
  })

  it('(5) #list matches a subcategory name ignoring case, spaces and punctuation', () => {
    const deals = parse('#deals')
    expect(deals.subcategoryId).toBe('w-deals')
    expect(deals.categoryId).toBe('cat-w')
    expect(deals.tokens[0].label).toBe('Work › Deals')
    expect(parse('#hiring-plan').subcategoryId).toBe('w-hiring')
    expect(parse('#HiringPlan').subcategoryId).toBe('w-hiring')
  })

  it('(6) an ambiguous name goes to the first category; a category token narrows it', () => {
    const alone = parse('#general')
    expect(alone.subcategoryId).toBe('p-general')
    expect(alone.categoryId).toBe('cat-p')

    const narrowed = parse('#work #general')
    expect(narrowed.subcategoryId).toBe('w-general')
    expect(narrowed.categoryId).toBe('cat-w')
    expect(narrowed.tokens.map((t) => t.label)).toEqual(['Work', 'Work › General'])
    expect(narrowed.title).toBe('')

    // The category token narrows wherever it sits in the line.
    expect(parse('#general #work').subcategoryId).toBe('w-general')
    // …and a list outside that category is no match at all.
    expect(parse('#work #errands').unknownTags).toEqual(['#errands'])
  })

  it('(7) an unknown tag is reported and kept in the title', () => {
    const p = parse('Buy milk #foo')
    expect(p.unknownTags).toEqual(['#foo'])
    expect(p.title).toBe('Buy milk #foo')
    expect(p.subcategoryId).toBeNull()
    expect(p.categoryId).toBeNull()
  })

  it('(8) only the first word of a kind counts', () => {
    const p = parse('p1 p2')
    expect(p.priority).toBe(1)
    expect(p.title).toBe('p2')

    const lists = parse('#deals #errands')
    expect(lists.subcategoryId).toBe('w-deals')
    expect(lists.title).toBe('#errands')
    expect(lists.unknownTags).toEqual([])
  })

  it('(9) an ignored word is never recognised', () => {
    const p = parse('Call Bob tomorrow p1', { ignore: new Set([2]) })
    expect(p.dueDay).toBeNull()
    expect(p.title).toBe('Call Bob tomorrow')
    expect(p.priority).toBe(1)

    const tag = parse('Ship it #deals', { ignore: new Set([2]) })
    expect(tag.subcategoryId).toBeNull()
    expect(tag.title).toBe('Ship it #deals')
    expect(tag.unknownTags).toEqual([])
  })

  it('(10) today is the calendar day in the passed zone', () => {
    const late = new Date('2026-10-14T03:30:00Z')
    expect(parse('today', { now: late }).dueDay).toBe('2026-10-13')
    expect(parse('today', { now: late, timeZone: 'UTC' }).dueDay).toBe('2026-10-14')
    expect(parse('tomorrow', { now: late, timeZone: 'UTC' }).dueDay).toBe('2026-10-15')
  })

  it('(11) only list tokens and spaces leave an empty title', () => {
    expect(parse('  #work   #deals  ').title).toBe('')
    expect(parse('   ').title).toBe('')
  })

  it('words are matched whole and case-insensitively', () => {
    const p = parse('Email P2 report TOMORROW 30M up1 p1x')
    expect(p.priority).toBe(2)
    expect(p.dueDay).toBe('2026-10-14')
    expect(p.estimateMinutes).toBe(30)
    expect(p.title).toBe('Email report up1 p1x')
  })
})

describe('resolveCaptureDest (chunk 73, D1)', () => {
  const ctx = { categories, subcategories }
  const none = { subcategoryId: null, categoryId: null }

  it('a subcategory token decides outright', () => {
    const dest = resolveCaptureDest(
      { subcategoryId: 'w-deals', categoryId: 'cat-w' },
      { ...ctx, remembered: 'p-errands', picked: 'p-general' },
    )
    expect(dest?.id).toBe('w-deals')
  })

  it('the remembered list wins when still live; otherwise Personal › General', () => {
    expect(resolveCaptureDest(none, { ...ctx, remembered: 'w-deals' })?.id).toBe('w-deals')
    expect(resolveCaptureDest(none, { ...ctx, remembered: 'gone' })?.id).toBe('p-general')
    expect(resolveCaptureDest(none, ctx)?.id).toBe('p-general')
  })

  it('a category token narrows the remembered list, General and the first list', () => {
    const work = { subcategoryId: null, categoryId: 'cat-w' }
    expect(resolveCaptureDest(work, { ...ctx, remembered: 'w-deals' })?.id).toBe('w-deals')
    expect(resolveCaptureDest(work, { ...ctx, remembered: 'p-errands' })?.id).toBe('w-general')
    const noGeneral = subcategories.filter((s) => s.id !== 'w-general')
    expect(
      resolveCaptureDest(work, { categories, subcategories: noGeneral })?.id,
    ).toBe('w-deals')
  })

  it('without a General: Work › General, then the first list of Personal', () => {
    const noPersonalGeneral = subcategories.filter((s) => s.id !== 'p-general')
    expect(
      resolveCaptureDest(none, { categories, subcategories: noPersonalGeneral })?.id,
    ).toBe('w-general')
    const noGenerals = subcategories.filter((s) => s.name !== 'General')
    expect(
      resolveCaptureDest(none, { categories, subcategories: noGenerals })?.id,
    ).toBe('p-errands')
  })

  it('no live list → null', () => {
    expect(resolveCaptureDest(none, { categories, subcategories: [] })).toBeNull()
  })
})
