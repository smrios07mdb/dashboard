import { describe, expect, it } from 'vitest'

import { taskStreak } from './taskStreak'

/*
 * The hero's task streak (chunk 78, ARCH §11): a day counts when any task was
 * completed on it, in the Settings time zone. Today is passed in, so every
 * case is clock-free.
 */

const NY = 'America/New_York'

/** A task completed at `iso`. */
const done = (iso: string | null) => ({ completedAt: iso })

describe('taskStreak', () => {
  it('is 0 with no completions', () => {
    expect(taskStreak([], '2026-10-14', NY)).toBe(0)
    expect(taskStreak([done(null)], '2026-10-14', NY)).toBe(0)
  })

  it('is 1 with a completion today only', () => {
    expect(taskStreak([done('2026-10-14T15:00:00Z')], '2026-10-14', NY)).toBe(1)
  })

  it('counts back from yesterday while today has no completion', () => {
    const tasks = [done('2026-10-13T15:00:00Z'), done('2026-10-12T15:00:00Z')]
    expect(taskStreak(tasks, '2026-10-14', NY)).toBe(2)
  })

  it('counts today and yesterday', () => {
    const tasks = [done('2026-10-14T15:00:00Z'), done('2026-10-13T15:00:00Z')]
    expect(taskStreak(tasks, '2026-10-14', NY)).toBe(2)
  })

  it('stops at a one-day gap', () => {
    const tasks = [
      done('2026-10-14T15:00:00Z'),
      done('2026-10-13T15:00:00Z'),
      // Oct 12 has nothing.
      done('2026-10-11T15:00:00Z'),
      done('2026-10-10T15:00:00Z'),
    ]
    expect(taskStreak(tasks, '2026-10-14', NY)).toBe(2)
  })

  it('counts several completions on one day once', () => {
    const tasks = [
      done('2026-10-14T13:00:00Z'),
      done('2026-10-14T15:00:00Z'),
      done('2026-10-14T20:00:00Z'),
    ]
    expect(taskStreak(tasks, '2026-10-14', NY)).toBe(1)
  })

  it('ignores tasks with no completedAt', () => {
    const tasks = [done('2026-10-14T15:00:00Z'), done(null), done(null)]
    expect(taskStreak(tasks, '2026-10-14', NY)).toBe(1)
  })

  it('reads each completion in the given zone', () => {
    // 03:30Z on Oct 14 is 23:30 on Oct 13 in New York.
    const tasks = [done('2026-10-14T03:30:00Z'), done('2026-10-12T15:00:00Z')]
    // New York: Oct 13 + Oct 12, nothing yet today → 2.
    expect(taskStreak(tasks, '2026-10-14', NY)).toBe(2)
    // UTC: Oct 14, then Oct 13 is empty → 1.
    expect(taskStreak(tasks, '2026-10-14', 'UTC')).toBe(1)
  })

  it('runs unbroken across the 2026-11-01 DST change in New York', () => {
    // Late evening each day, so a 24 h step from a UTC instant would skew.
    const tasks = [
      done('2026-10-31T03:30:00Z'), // Oct 30, 23:30 EDT
      done('2026-11-01T03:30:00Z'), // Oct 31, 23:30 EDT
      done('2026-11-02T04:30:00Z'), // Nov 1, 23:30 EST
      done('2026-11-03T04:30:00Z'), // Nov 2, 23:30 EST
    ]
    expect(taskStreak(tasks, '2026-11-02', NY)).toBe(4)
  })
})
