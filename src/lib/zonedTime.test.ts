import { describe, expect, it } from 'vitest'

import { zonedWallToDate } from './zonedTime'

/*
 * Chunk 82: wall time → instant, Temporal "compatible" disambiguation —
 * a repeated wall time is its earlier instant, a skipped one shifts forward
 * by the gap. The oracle is an Intl-only scan, identical on every host, so
 * these hold under any TZ the suite runs in.
 */

const TABLE: [wall: string, zone: string, kind: string, iso: string][] = [
  ['2026-03-08T00:00', 'America/Havana', 'gap', '2026-03-08T05:00:00.000Z'],
  ['2026-11-01T00:00', 'America/Havana', 'repeated', '2026-11-01T04:00:00.000Z'],
  ['2026-11-01T00:30', 'America/Havana', 'repeated', '2026-11-01T04:30:00.000Z'],
  ['2026-03-29T00:00', 'Asia/Beirut', 'gap', '2026-03-28T22:00:00.000Z'],
  ['2026-10-24T23:30', 'Asia/Beirut', 'repeated', '2026-10-24T20:30:00.000Z'],
  ['2026-10-25T00:00', 'Asia/Beirut', 'normal', '2026-10-24T22:00:00.000Z'],
  ['2026-04-24T00:00', 'Africa/Cairo', 'gap', '2026-04-23T22:00:00.000Z'],
  ['2026-09-06T00:00', 'America/Santiago', 'gap', '2026-09-06T04:00:00.000Z'],
  ['2026-04-04T23:30', 'America/Santiago', 'repeated', '2026-04-05T02:30:00.000Z'],
  ['2026-04-05T00:00', 'America/Santiago', 'normal', '2026-04-05T04:00:00.000Z'],
  ['2026-03-08T00:00', 'America/New_York', 'normal', '2026-03-08T05:00:00.000Z'],
  ['2026-03-08T02:30', 'America/New_York', 'gap', '2026-03-08T07:30:00.000Z'],
  ['2026-11-01T01:30', 'America/New_York', 'repeated', '2026-11-01T05:30:00.000Z'],
  ['2026-11-01T02:30', 'America/New_York', 'normal', '2026-11-01T07:30:00.000Z'],
  ['2026-04-05T01:45', 'Australia/Lord_Howe', 'repeated (30 min)', '2026-04-04T14:45:00.000Z'],
  ['2026-10-04T02:15', 'Australia/Lord_Howe', 'gap (30 min)', '2026-10-03T15:45:00.000Z'],
  ['2026-10-25T01:30', 'Europe/London', 'repeated', '2026-10-25T00:30:00.000Z'],
  ['2026-10-14T09:00', 'America/New_York', 'normal', '2026-10-14T13:00:00.000Z'],
  ['2026-10-14T13:00', 'America/New_York', 'normal', '2026-10-14T17:00:00.000Z'],
  ['2026-10-14T18:00', 'America/New_York', 'normal', '2026-10-14T22:00:00.000Z'],
]

describe('zonedWallToDate (chunk 82)', () => {
  it.each(TABLE)('%s %s (%s) → %s', (wall, zone, _kind, iso) => {
    expect(zonedWallToDate(wall, zone)?.toISOString()).toBe(iso)
  })

  it.each(['', 'nope', '2026-02-30T00:00', '2026-10-14T24:00', '2026-10-14'])(
    'rejects %j',
    (wall) => {
      expect(zonedWallToDate(wall, 'America/New_York')).toBeNull()
    },
  )

  it('rejects an unknown zone', () => {
    expect(zonedWallToDate('2026-10-14T13:00', 'Mars/Base')).toBeNull()
  })

  it('accepts seconds and milliseconds', () => {
    const NY = 'America/New_York'
    expect(zonedWallToDate('2026-10-14T13:00:00', NY)?.toISOString()).toBe(
      '2026-10-14T17:00:00.000Z',
    )
    expect(zonedWallToDate('2026-10-14T13:00:00.000', NY)?.toISOString()).toBe(
      '2026-10-14T17:00:00.000Z',
    )
  })
})
