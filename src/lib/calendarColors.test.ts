import { describe, expect, it } from 'vitest'

import type { BusySource } from '@/lib/calendarApi'
import {
  CALENDAR_PALETTE,
  calendarColorMap,
  outlookColorKey,
  outlookColorName,
  withCalendarColors,
} from './calendarColors'

/*
 * Chunk 51b — per-calendar colors. Every calendar in the read set gets a
 * DISTINCT color: iCloud's own when it has one and no earlier calendar took
 * it, the next unused palette entry otherwise.
 */

const H = 'https://caldav.icloud.com/1/calendars/'

describe('calendarColorMap', () => {
  it('uses the iCloud color when present and fills the rest from the palette, all distinct', () => {
    const map = calendarColorMap([
      { url: `${H}a/`, name: 'Calendar', enabled: true, color: '#ff2968' },
      { url: `${H}b/`, name: 'Shared', enabled: true },
      { url: `${H}c/`, name: 'US Holidays', enabled: true, color: '#63da38' },
      { url: `${H}d/`, name: 'MDB/PatentVest', enabled: false },
    ])
    expect(map.get('Calendar')).toBe('#ff2968')
    expect(map.get('US Holidays')).toBe('#63da38')
    expect(map.get('Shared')).toBe(CALENDAR_PALETTE[0])
    expect(map.get('MDB/PatentVest')).toBe(CALENDAR_PALETTE[1])
    expect(new Set(map.values()).size).toBe(4)
  })

  it('a repeated iCloud color is re-assigned from the palette so no two calendars share one', () => {
    const map = calendarColorMap([
      { url: `${H}a/`, name: 'A', enabled: true, color: '#1BADF8' },
      { url: `${H}b/`, name: 'B', enabled: true, color: '#1badf8' },
    ])
    expect(map.get('A')).toBe('#1badf8')
    // Palette[0] is the very color A took → B skips to palette[1].
    expect(map.get('B')).toBe(CALENDAR_PALETTE[1])
    expect(map.get('A')).not.toBe(map.get('B'))
  })

  it('stays distinct for as many calendars as the palette holds, then cycles', () => {
    const n = CALENDAR_PALETTE.length
    const cals = Array.from({ length: n + 1 }, (_, i) => ({
      url: `${H}${i}/`,
      name: `C${i}`,
      enabled: true,
    }))
    const map = calendarColorMap(cals)
    const first = cals.slice(0, n).map((c) => map.get(c.name))
    expect(new Set(first).size).toBe(n)
    expect(map.get(`C${n}`)).toBe(CALENDAR_PALETTE[0])
  })

  it('null / empty sets and unnamed entries yield nothing', () => {
    expect(calendarColorMap(null).size).toBe(0)
    expect(calendarColorMap([]).size).toBe(0)
    expect(calendarColorMap([{ url: `${H}x/`, name: '', enabled: true }]).size).toBe(0)
  })

  it('extras are colored after the read set and stay distinct from it (chunk 51c)', () => {
    const map = calendarColorMap(
      [
        { url: `${H}a/`, name: 'Calendar', enabled: true, color: '#1badf8' },
        { url: `${H}b/`, name: 'Shared', enabled: true },
      ],
      [outlookColorKey('Calendar')],
    )
    // The iCloud "Calendar" and an Outlook feed also named "Calendar" are
    // separate entries — the key is namespaced, the display name is not.
    expect(map.get('Calendar')).toBe('#1badf8')
    expect(map.get('Shared')).toBe(CALENDAR_PALETTE[1])
    expect(map.get(outlookColorKey('Calendar'))).toBe(CALENDAR_PALETTE[2])
    expect(new Set(map.values()).size).toBe(3)
  })

  it('extras color with an empty or null read set', () => {
    expect(calendarColorMap(null, [outlookColorKey('Work')]).get(outlookColorKey('Work'))).toBe(
      CALENDAR_PALETTE[0],
    )
    expect(calendarColorMap([], [outlookColorKey('Work')]).size).toBe(1)
  })
})

describe('outlookColorName / outlookColorKey', () => {
  it('names the feed from sources, falling back to "Outlook"', () => {
    const sources = (feedName: string | null) => ({
      icloud: { configured: true, ok: true },
      outlook: { configured: true, status: 'ok' as const, fetchedAt: null, feedName },
    })
    expect(outlookColorName(sources('Work feed'))).toBe('Work feed')
    expect(outlookColorName(sources(null))).toBe('Outlook')
    expect(outlookColorName(undefined)).toBe('Outlook')
    expect(outlookColorKey('Work feed')).not.toBe('Work feed')
  })
})

describe('withCalendarColors', () => {
  const colors = new Map([['Home', '#ff2968']])

  it('colors iCloud intervals by calendar name, prefers the map over the proxy tag', () => {
    const out = withCalendarColors(
      [
        { source: 'icloud' as const, calendar: 'Home' },
        { source: 'icloud' as const, calendar: 'Home', color: '#000000' },
        { source: 'icloud' as const, calendar: 'Other', color: '#123456' },
        { source: 'icloud' as const },
        { source: 'outlook' as const, calendar: 'Home' },
      ],
      colors,
    )
    expect(out.map((b) => b.color)).toEqual([
      '#ff2968',
      '#ff2968',
      '#123456', // unknown to the set: the proxy's tag stands
      undefined, // legacy untagged interval: left alone
      undefined, // no Outlook key given: Outlook is left alone
    ])
  })

  it('colors Outlook intervals with the feed entry when a key is given; iCloud untouched (chunk 51c)', () => {
    const key = outlookColorKey('Calendar')
    const map = new Map([
      ['Calendar', '#1badf8'],
      [key, '#ff9500'],
    ])
    const input: Pick<BusySource, 'source' | 'calendar' | 'color'>[] = [
      { source: 'outlook' },
      { source: 'outlook', calendar: 'Calendar' },
      { source: 'icloud', calendar: 'Calendar' },
      { source: 'icloud', calendar: 'Other' },
    ]
    const out = withCalendarColors(input, map, key)
    expect(out.map((b) => b.color)).toEqual([
      '#ff9500',
      '#ff9500', // the feed key wins over any calendar tag on an Outlook interval
      '#1badf8',
      undefined,
    ])
  })

  it('an Outlook key with no map entry leaves Outlook intervals alone', () => {
    const iv = { source: 'outlook' as const }
    expect(withCalendarColors([iv], new Map(), outlookColorKey('X'))[0]).toBe(iv)
  })

  it('returns the same object when nothing changes', () => {
    const iv = { source: 'icloud' as const, calendar: 'Home', color: '#ff2968' }
    expect(withCalendarColors([iv], colors)[0]).toBe(iv)
  })
})
