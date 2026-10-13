import { describe, expect, it } from 'vitest'

import { dueLabel, reminderLabel } from './whenLabel'

/*
 * Chunk 71: the task row's when-chip text. `now` is always passed and every
 * zone is named, so nothing here depends on the machine running the suite.
 */

const NY = 'America/New_York'
// Tuesday Oct 13 2026, 12:00 in New York (EDT, UTC−4).
const NOW = new Date('2026-10-13T16:00:00.000Z')
/** 00:00 on `day` of October 2026 in New York. */
const oct = (day: number) => `2026-10-${String(day).padStart(2, '0')}T04:00:00.000Z`

describe('dueLabel', () => {
  it('(1) covers late, today, tomorrow, weekday, date, and next year', () => {
    expect(dueLabel(oct(11), NY, NOW)).toMatchObject({ text: '2d late', tone: 'late' })
    expect(dueLabel(oct(13), NY, NOW)).toMatchObject({ text: 'Today', tone: 'today' })
    expect(dueLabel(oct(14), NY, NOW)).toMatchObject({ text: 'Tomorrow', tone: 'soon' })
    expect(dueLabel(oct(16), NY, NOW)).toMatchObject({ text: 'Fri', tone: 'soon' })
    expect(dueLabel(oct(19), NY, NOW)).toMatchObject({ text: 'Mon', tone: 'soon' })
    expect(dueLabel(oct(20), NY, NOW)).toMatchObject({ text: 'Oct 20', tone: 'later' })
    expect(dueLabel(oct(23), NY, NOW)).toMatchObject({ text: 'Oct 23', tone: 'later' })
    // 00:00 Jan 5 2027 in New York (EST, UTC−5).
    expect(dueLabel('2027-01-05T05:00:00.000Z', NY, NOW)).toMatchObject({
      text: 'Jan 5, 2027',
      tone: 'later',
    })
  })

  it('the time of day on a due date never matters', () => {
    // 23:30 Oct 13 in New York — still today, not late.
    expect(dueLabel('2026-10-14T03:30:00.000Z', NY, NOW).text).toBe('Today')
    // 00:30 Oct 12 in New York, before `now` by a day and a half.
    expect(dueLabel('2026-10-12T04:30:00.000Z', NY, NOW).text).toBe('1d late')
  })

  it('(2) the day boundary follows the zone, not UTC', () => {
    // 23:30 Oct 12 in New York; 03:30 Oct 13 in UTC.
    const now = new Date('2026-10-13T03:30:00.000Z')
    const dueAt = oct(13)
    expect(dueLabel(dueAt, NY, now).text).toBe('Tomorrow')
    expect(dueLabel(dueAt, 'UTC', now).text).toBe('Today')
  })

  it('(4) long is the full date, with the year only when it differs', () => {
    expect(dueLabel(oct(16), NY, NOW).long).toBe('Friday, October 16')
    expect(dueLabel('2027-01-05T05:00:00.000Z', NY, NOW).long).toBe(
      'Tuesday, January 5, 2027',
    )
  })
})

describe('reminderLabel', () => {
  it('(3) past is Overdue; later today and in two days carry the time', () => {
    expect(reminderLabel('2026-10-13T15:00:00.000Z', NY, NOW)).toMatchObject({
      text: 'Overdue',
      tone: 'late',
    })
    // The instant itself counts as passed.
    expect(reminderLabel(NOW.toISOString(), NY, NOW).text).toBe('Overdue')
    expect(reminderLabel('2026-10-13T19:00:00.000Z', NY, NOW)).toMatchObject({
      text: 'Today 3:00 PM',
      tone: 'today',
    })
    expect(reminderLabel('2026-10-14T13:00:00.000Z', NY, NOW)).toMatchObject({
      text: 'Tomorrow 9:00 AM',
      tone: 'soon',
    })
    expect(reminderLabel('2026-10-15T13:00:00.000Z', NY, NOW)).toMatchObject({
      text: 'Thu 9:00 AM',
      tone: 'soon',
    })
    expect(reminderLabel('2026-10-23T13:30:00.000Z', NY, NOW)).toMatchObject({
      text: 'Oct 23 9:30 AM',
      tone: 'later',
    })
  })

  it('(4) long adds the time', () => {
    expect(reminderLabel('2026-10-13T19:00:00.000Z', NY, NOW).long).toBe(
      'Tuesday, October 13, 3:00 PM',
    )
  })

  it('uses a plain space before AM/PM', () => {
    expect(reminderLabel('2026-10-13T19:00:00.000Z', NY, NOW).text).not.toMatch(
      /\u202f/,
    )
  })
})
