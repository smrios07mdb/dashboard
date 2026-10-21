import { describe, expect, it } from 'vitest'

import type { Category, Subcategory } from '@/db/types'

import {
  addNewGroup,
  approveToast,
  buildGroups,
  buildPayload,
  initialState,
  moveItem,
  newListNameError,
  renameNewGroup,
  type RoutingProposal,
} from './sorting'

const WORK = 'cat-work'
const PERSONAL = 'cat-personal'
const categories: Category[] = [
  { id: WORK, userId: 'u', name: 'Work' },
  { id: PERSONAL, userId: 'u', name: 'Personal' },
]
const sub = (id: string, categoryId: string, name: string, sortOrder: number, archivedAt: string | null = null): Subcategory => ({
  id,
  userId: 'u',
  categoryId,
  name,
  sortOrder,
  archivedAt,
})
const subcategories: Subcategory[] = [
  sub('w-gen', WORK, 'General', 0),
  sub('w-tax', WORK, 'Taxes', 2),
  sub('w-hire', WORK, 'Hiring', 1),
  sub('p-trip', PERSONAL, 'Trips', 0),
  sub('w-old', WORK, 'Old', 3, '2026-01-01T00:00:00Z'),
]

let n = 0
function prop(over: Partial<RoutingProposal>): RoutingProposal {
  n += 1
  return {
    id: `p${n}`,
    taskId: `t${n}`,
    title: `Task ${n}`,
    fromSubcategoryId: 'w-gen',
    toSubcategoryId: null,
    newListName: null,
    newListCategoryId: null,
    reason: `reason ${n}`,
    createdAt: '2026-10-21T10:00:00Z',
    ...over,
  }
}

function fixture() {
  n = 0
  return [
    prop({ toSubcategoryId: 'p-trip' }), // p1
    prop({ toSubcategoryId: 'w-tax' }), // p2
    prop({ newListName: 'Grants', newListCategoryId: WORK }), // p3
    prop({ newListName: ' grants ', newListCategoryId: WORK }), // p4
    prop({}), // p5 keep
    prop({ toSubcategoryId: 'w-hire' }), // p6
  ]
}

const ids = (groups: ReturnType<typeof buildGroups>) => groups.map((g) => g.id)

describe('grouping (D6)', () => {
  it('orders existing lists by category then list order, then New, then Keep', () => {
    const s = initialState(fixture(), subcategories)
    const groups = buildGroups(s, categories, subcategories)
    expect(ids(groups)).toEqual(['list:w-hire', 'list:w-tax', 'list:p-trip', 'new:n1', 'keep'])
    const fresh = groups[3]
    expect(fresh.kind === 'new' && fresh.group.name).toBe('Grants')
    expect(fresh.items.map((i) => i.proposalId)).toEqual(['p3', 'p4'])
    expect(groups[4].items.map((i) => i.proposalId)).toEqual(['p5'])
  })

  it('Keep is always present, even empty', () => {
    n = 0
    const s = initialState([prop({ toSubcategoryId: 'w-tax' })], subcategories)
    expect(ids(buildGroups(s, categories, subcategories))).toEqual(['list:w-tax', 'keep'])
  })

  it('a target archived since the proposal falls back to Keep', () => {
    n = 0
    const s = initialState([prop({ toSubcategoryId: 'w-old' })], subcategories)
    expect(s.items[0].dest).toEqual({ kind: 'keep' })
  })

  it('a new-list name that now exists as a list maps to that list', () => {
    n = 0
    const s = initialState(
      [prop({ newListName: 'taxes', newListCategoryId: WORK })],
      subcategories,
    )
    expect(s.items[0].dest).toEqual({ kind: 'existing', subId: 'w-tax' })
    expect(s.newGroups).toEqual([])
  })
})

describe('moving cards', () => {
  it('a drag between groups changes the destination', () => {
    const s = moveItem(initialState(fixture(), subcategories), 'p1', { kind: 'existing', subId: 'w-tax' })
    expect(s.items.find((i) => i.proposalId === 'p1')?.dest).toEqual({ kind: 'existing', subId: 'w-tax' })
    // The emptied existing group stays.
    expect(ids(buildGroups(s, categories, subcategories))).toContain('list:p-trip')
  })

  it('Move to… an existing list not shown adds its group', () => {
    n = 0
    const s0 = initialState([prop({})], subcategories)
    expect(ids(buildGroups(s0, categories, subcategories))).toEqual(['keep'])
    const s = moveItem(s0, 'p1', { kind: 'existing', subId: 'p-trip' })
    expect(ids(buildGroups(s, categories, subcategories))).toEqual(['list:p-trip', 'keep'])
  })

  it('an emptied New group disappears', () => {
    let s = initialState(fixture(), subcategories)
    s = moveItem(s, 'p3', { kind: 'keep' })
    expect(ids(buildGroups(s, categories, subcategories))).toContain('new:n1')
    s = moveItem(s, 'p4', { kind: 'existing', subId: 'w-tax' })
    expect(ids(buildGroups(s, categories, subcategories))).not.toContain('new:n1')
  })

  it('× (keep) sends a card to Keep in General', () => {
    const s = moveItem(initialState(fixture(), subcategories), 'p2', { kind: 'keep' })
    const keep = buildGroups(s, categories, subcategories).at(-1)!
    expect(keep.items.map((i) => i.proposalId)).toEqual(['p2', 'p5'])
  })

  it('+ New list adds an empty group that survives until it is filled and emptied', () => {
    let s = addNewGroup(initialState(fixture(), subcategories), ' Admin ', PERSONAL)
    expect(ids(buildGroups(s, categories, subcategories))).toContain('new:n2')
    s = moveItem(s, 'p5', { kind: 'new', key: 'n2' })
    s = moveItem(s, 'p5', { kind: 'keep' })
    expect(ids(buildGroups(s, categories, subcategories))).not.toContain('new:n2')
  })
})

describe('New-list names', () => {
  it('renames a New group', () => {
    const s = renameNewGroup(initialState(fixture(), subcategories), 'n1', ' Funding ')
    expect(s.newGroups[0].name).toBe('Funding')
    expect(buildPayload(s).new_lists[0].name).toBe('Funding')
  })

  it('rejects empty, too long, General, an existing list and another New group', () => {
    const s = addNewGroup(initialState(fixture(), subcategories), 'Admin', WORK)
    const err = (name: string, key?: string) => newListNameError(s, subcategories, WORK, name, key)
    expect(err('  ')).not.toBeNull()
    expect(err('x'.repeat(41))).not.toBeNull()
    expect(err('general')).not.toBeNull()
    expect(err('TAXES')).not.toBeNull()
    expect(err('admin')).not.toBeNull()
    expect(err('Grants', 'n1')).toBeNull() // its own name
    expect(err('Old')).toBeNull() // archived lists don't block
    expect(newListNameError(s, subcategories, PERSONAL, 'Admin')).toBeNull()
  })
})

describe('Approve payload (D7)', () => {
  it('is exactly the arrangement, with only the New lists in use', () => {
    let s = initialState(fixture(), subcategories)
    s = addNewGroup(s, 'Unused', PERSONAL)
    s = moveItem(s, 'p6', { kind: 'keep' })
    expect(buildPayload(s)).toEqual({
      new_lists: [{ key: 'n1', name: 'Grants', category_id: WORK }],
      items: [
        { proposal_id: 'p1', to: { subcategory_id: 'p-trip' } },
        { proposal_id: 'p2', to: { subcategory_id: 'w-tax' } },
        { proposal_id: 'p3', to: { new_list_key: 'n1' } },
        { proposal_id: 'p4', to: { new_list_key: 'n1' } },
        { proposal_id: 'p5', to: null },
        { proposal_id: 'p6', to: null },
      ],
    })
  })

  it('toast carries the stale count only when there is one', () => {
    expect(approveToast({ moved: 2, kept: 2, stale: 0, created_lists: 1 })).toBe('Moved 2 · kept 2')
    expect(approveToast({ moved: 1, kept: 2, stale: 1, created_lists: 0 })).toBe(
      'Moved 1 · kept 2 · 1 changed since',
    )
  })
})
