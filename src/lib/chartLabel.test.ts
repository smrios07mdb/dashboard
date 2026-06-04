import { describe, expect, it } from 'vitest'

import {
  chartLabel,
  type ChartCategoryFilter,
  type ChartRange,
} from './chartLabel'

describe('chartLabel', () => {
  it('describes what is plotted, the range, and the category filter', () => {
    expect(chartLabel({ range: 30, categoryFilter: 'all' })).toBe(
      'Completed minutes per day for the last 30 days, all categories, by subcategory.',
    )
    expect(chartLabel({ range: 7, categoryFilter: 'work' })).toBe(
      'Completed minutes per day for the last 7 days, the Work category, by subcategory.',
    )
    expect(chartLabel({ range: 90, categoryFilter: 'personal' })).toBe(
      'Completed minutes per day for the last 90 days, the Personal category, by subcategory.',
    )
  })

  it('reflects each of the 7 / 30 / 90 ranges', () => {
    const ranges: ChartRange[] = [7, 30, 90]
    for (const range of ranges) {
      expect(chartLabel({ range, categoryFilter: 'all' })).toContain(
        `last ${range} days`,
      )
    }
  })

  it('names the active category filter (All / Work / Personal)', () => {
    expect(chartLabel({ range: 30, categoryFilter: 'all' })).toContain(
      'all categories',
    )
    expect(chartLabel({ range: 30, categoryFilter: 'work' })).toContain('Work')
    expect(chartLabel({ range: 30, categoryFilter: 'personal' })).toContain(
      'Personal',
    )
  })

  it('does not leak a raw filter id into the label', () => {
    const filters: ChartCategoryFilter[] = ['all', 'work', 'personal']
    for (const categoryFilter of filters) {
      const label = chartLabel({ range: 30, categoryFilter })
      // The internal ids are lowercase tokens; the human label must not
      // surface them verbatim (e.g. "work" / "personal" lowercased).
      expect(label).not.toContain('categoryFilter')
      expect(label).not.toMatch(/\bwork\b/)
      expect(label).not.toMatch(/\bpersonal\b/)
    }
  })
})
