import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MINUTES } from '@/components/AddTaskInline'
import { fromDueInputValue } from '@/components/SetDuePopover'
import type { Category, Subcategory } from '@/db/types'

import {
  footerCount,
  planScratch,
  sendScratch,
  workGeneral,
  type ScratchCtx,
} from './scratchpad'

const WORK: Category = { id: 'cw', userId: 'u1', name: 'Work' }
const PERSONAL: Category = { id: 'cp', userId: 'u1', name: 'Personal' }
const sub = (
  id: string,
  categoryId: string,
  name: string,
  sortOrder: number,
): Subcategory => ({
  id,
  userId: 'u1',
  categoryId,
  name,
  sortOrder,
  archivedAt: null,
})
const P_GENERAL = sub('pg', 'cp', 'General', 0)
const W_DEALS = sub('wd', 'cw', 'Deals', 0)
const W_GENERAL = sub('wg', 'cw', 'general', 1)

// Tue 2026-11-10, 15:00 UTC: 10:00 in New York.
const NOW = new Date('2026-11-10T15:00:00.000Z')

function ctx(over: Partial<ScratchCtx> = {}): ScratchCtx {
  return {
    userId: 'u1',
    now: NOW,
    timeZone: 'America/New_York',
    categories: [WORK, PERSONAL],
    subcategories: [P_GENERAL, W_DEALS, W_GENERAL],
    ...over,
  }
}

describe('workGeneral', () => {
  it('is the first live General in Work, case-insensitive', () => {
    expect(workGeneral(ctx())?.id).toBe('wg')
  })
  it('is null with no Work › General', () => {
    expect(workGeneral(ctx({ subcategories: [P_GENERAL, W_DEALS] }))).toBe(null)
  })
})

describe('planScratch', () => {
  it('sends a plain line to Work › General with QuickCapture’s fields', () => {
    const plan = planScratch('Call the bank', ctx())
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].input).toEqual({
      userId: 'u1',
      subcategoryId: 'wg',
      title: 'Call the bank',
      estimateMinutes: DEFAULT_MINUTES,
      dueAt: null,
      remindAt: null,
      priority: null,
      completedAt: null,
    })
    expect(plan.destLabel).toBe('Work › general')
  })

  it('#personal goes to Personal › General', () => {
    const plan = planScratch('Renew passport #personal', ctx())
    expect(plan.items[0].input.subcategoryId).toBe('pg')
    expect(plan.items[0].input.title).toBe('Renew passport')
  })

  it('#<list> goes to that list', () => {
    const plan = planScratch('Send NDA #deals', ctx())
    expect(plan.items[0].input.subcategoryId).toBe('wd')
  })

  it('maps p1 25m tomorrow like QuickCapture', () => {
    const plan = planScratch('Draft memo p1 25m tomorrow', ctx())
    const input = plan.items[0].input
    expect(input.title).toBe('Draft memo')
    expect(input.priority).toBe(1)
    expect(input.estimateMinutes).toBe(25)
    expect(input.dueAt).toBe(fromDueInputValue('2026-11-11', 'America/New_York'))
    expect(input.dueAt).toBe('2026-11-11T05:00:00.000Z')
  })

  it('reads "tomorrow" in the Settings zone, not the runner’s', () => {
    // 15:00 UTC is already the 11th in Tokyo, so tomorrow is the 12th.
    const plan = planScratch('x tomorrow', ctx({ timeZone: 'Asia/Tokyo' }))
    expect(plan.items[0].input.dueAt).toBe(
      fromDueInputValue('2026-11-12', 'Asia/Tokyo'),
    )
  })

  it('keeps a token-only line and ignores blank lines', () => {
    const plan = planScratch('\nA\n   \np1\n\nB\n', ctx())
    expect(plan.lines).toBe(3)
    expect(plan.items.map((i) => i.input.title)).toEqual(['A', 'B'])
    expect(plan.kept).toEqual(['p1'])
  })

  it('names no single list when lines go to different lists', () => {
    expect(planScratch('A\nB #personal', ctx()).destLabel).toBe(null)
  })

  it('falls back to resolveCaptureDest without Work › General', () => {
    const plan = planScratch('A', ctx({ subcategories: [W_DEALS, P_GENERAL] }))
    expect(plan.items[0].input.subcategoryId).toBe('pg')
  })

  it('has no destination without any live list', () => {
    const plan = planScratch('A', ctx({ subcategories: [] }))
    expect(plan.noList).toBe(true)
    expect(plan.items).toEqual([])
  })
})

describe('footerCount', () => {
  it('reads Nothing to send when empty', () => {
    expect(footerCount(planScratch(' \n', ctx()))).toBe('Nothing to send')
  })
  it('handles singular and plural', () => {
    expect(footerCount(planScratch('A', ctx()))).toBe(
      '1 line → 1 task in Work › general',
    )
    expect(footerCount(planScratch('A\nB\nC\nD', ctx()))).toBe(
      '4 lines → 4 tasks in Work › general',
    )
  })
  it('drops the list when lines differ, counts token-only lines out', () => {
    expect(footerCount(planScratch('A #personal\nB\np1', ctx()))).toBe(
      '3 lines → 2 tasks',
    )
  })
  it('says when there is no list', () => {
    expect(footerCount(planScratch('A', ctx({ subcategories: [] })))).toBe(
      'No list to send to',
    )
  })
})

describe('sendScratch', () => {
  it('creates one at a time in order, clears the pad, names the list', async () => {
    const order: string[] = []
    const create = vi.fn(async (input: { title: string }) => {
      order.push(input.title)
    })
    const r = await sendScratch('A\n\nB\nC\nD', ctx(), create)
    expect(order).toEqual(['A', 'B', 'C', 'D'])
    expect(r.leftover).toBe('')
    expect(r.sent).toBe(4)
    expect(r.result).toBe('Sent 4 tasks to Work › general')
  })

  it('singular', async () => {
    const r = await sendScratch('A', ctx(), vi.fn().mockResolvedValue(undefined))
    expect(r.result).toBe('Sent 1 task to Work › general')
  })

  it('says only the count when lines went to different lists', async () => {
    const r = await sendScratch(
      'A\nB #personal',
      ctx(),
      vi.fn().mockResolvedValue(undefined),
    )
    expect(r.result).toBe('Sent 2 tasks')
  })

  it('one failing create leaves only that line', async () => {
    const create = vi.fn(async (input: { title: string }) => {
      if (input.title === 'B') throw new Error('nope')
    })
    const r = await sendScratch('A\nB p1\nC\nD', ctx(), create)
    expect(create).toHaveBeenCalledTimes(4)
    expect(r.leftover).toBe('B p1')
    expect(r.result).toBe('Sent 3 · 1 not sent, still here')
  })

  it('keeps a token-only line in the pad', async () => {
    const r = await sendScratch(
      'A\np1\nB',
      ctx(),
      vi.fn().mockResolvedValue(undefined),
    )
    expect(r.leftover).toBe('p1')
    expect(r.result).toBe('Sent 2 · 1 not sent, still here')
  })

  it('sends nothing without a live list', async () => {
    const create = vi.fn()
    const r = await sendScratch('A\nB', ctx({ subcategories: [] }), create)
    expect(create).not.toHaveBeenCalled()
    expect(r.leftover).toBe('A\nB')
    expect(r.result).toBe('No list to send to')
  })
})
