import { describe, expect, it } from 'vitest'

import {
  clockLabel,
  daysLabel,
  isValidDomain,
  normalizeDomain,
  ruleSummary,
} from './blockRules'
import html from '../../public/blocked.html?raw'

describe('normalizeDomain (chunk 99, D2)', () => {
  it('keeps a bare domain', () => {
    expect(normalizeDomain('x.com')).toBe('x.com')
    expect(normalizeDomain('  news.ycombinator.com ')).toBe('news.ycombinator.com')
  })

  it('reduces a pasted URL to its domain', () => {
    expect(normalizeDomain('https://www.x.com/path?q#h')).toBe('x.com')
    expect(normalizeDomain('http://user:pw@mobile.x.com/a')).toBe('mobile.x.com')
    expect(normalizeDomain('reddit.com/r/x')).toBe('reddit.com')
  })

  it('drops a port and lowercases', () => {
    expect(normalizeDomain('x.com:8080')).toBe('x.com')
    expect(normalizeDomain('HTTPS://WWW.X.COM')).toBe('x.com')
  })

  it('rejects junk and an empty string', () => {
    expect(normalizeDomain('not a site')).toBeNull()
    expect(normalizeDomain('localhost')).toBeNull()
    expect(normalizeDomain('x..com')).toBeNull()
    expect(normalizeDomain('-x.com')).toBeNull()
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
  })

  it('isValidDomain matches the shell rule', () => {
    expect(isValidDomain('x.com')).toBe(true)
    expect(isValidDomain('x.com.')).toBe(false)
    expect(isValidDomain(`${'a'.repeat(250)}.com`)).toBe(false)
  })
})

describe('ruleSummary', () => {
  const base = {
    blockInFocus: false,
    blockOnSchedule: false,
    scheduleDays: [1, 2, 3, 4, 5],
    scheduleFrom: '09:00',
    scheduleTo: '17:00',
  }

  it('reads each combination', () => {
    expect(ruleSummary(base)).toBe('No trigger')
    expect(ruleSummary({ ...base, blockInFocus: true })).toBe('Focus')
    expect(ruleSummary({ ...base, blockOnSchedule: true })).toBe(
      'Mon–Fri 9:00 AM – 5:00 PM',
    )
    expect(
      ruleSummary({ ...base, blockInFocus: true, blockOnSchedule: true }),
    ).toBe('Focus · Mon–Fri 9:00 AM – 5:00 PM')
  })

  it('labels days and times', () => {
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
    expect(daysLabel([0, 6])).toBe('Sat, Sun')
    expect(daysLabel([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(clockLabel('00:05')).toBe('12:05 AM')
    expect(clockLabel('12:00')).toBe('12:00 PM')
    expect(clockLabel('23:30')).toBe('11:30 PM')
  })
})

describe('public/blocked.html (chunk 99, D12)', () => {
  it('holds no script and no absolute URL', () => {
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/src="\/|href="\//)
  })

  it('has both :target ids, the title and the noindex', () => {
    expect(html).toContain('id="focus"')
    expect(html).toContain('id="schedule"')
    expect(html).toContain(':target')
    expect(html).toContain('<title>Blocked · Hupomnemata</title>')
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).toContain('This site is blocked right now')
    expect(html).toContain('href="./">Open Hupomnemata')
  })
})
