import type { Category, Subcategory } from '@/db/types'

/*
 * General sorting (chunk 89, ARCHITECTURE.md §10): the review sheet's model.
 *
 * A Claude scheduled task writes routing proposals for tasks sitting in a
 * General list; the sheet groups them by destination, lets the user rearrange
 * them, and Approve sends the arrangement to `apply_routing` in one call.
 * Everything here is pure; `SortingSheet` holds a `SortState` in React state.
 */

/** A pending proposal joined to its task (repo.routing.pending). */
export type RoutingProposal = {
  id: string
  taskId: string
  title: string
  fromSubcategoryId: string
  toSubcategoryId: string | null
  newListName: string | null
  newListCategoryId: string | null
  reason: string
  createdAt: string
}

export type Dest =
  | { kind: 'existing'; subId: string }
  | { kind: 'new'; key: string }
  | { kind: 'keep' }

export type SortItem = {
  proposalId: string
  taskId: string
  title: string
  reason: string
  fromSubcategoryId: string
  dest: Dest
}

export type NewGroup = {
  key: string
  name: string
  categoryId: string
  /** True until an item first lands in it: a `+ New list` group may sit empty. */
  emptyOk: boolean
}

export type SortState = {
  items: SortItem[]
  newGroups: NewGroup[]
  /** Existing lists shown as groups, in the order they were added. */
  shownExisting: string[]
  nextKey: number
}

export type Group =
  | { kind: 'existing'; id: string; sub: Subcategory; categoryName: string; items: SortItem[] }
  | { kind: 'new'; id: string; group: NewGroup; categoryName: string; items: SortItem[] }
  | { kind: 'keep'; id: string; items: SortItem[] }

export function isGeneralName(name: string): boolean {
  return name.trim().toLowerCase() === 'general'
}

/** Live, non-General lists: the existing destinations a task may go to. */
export function routingTargets(subcategories: Subcategory[]): Subcategory[] {
  return subcategories.filter((s) => !s.archivedAt && !isGeneralName(s.name))
}

function findExisting(
  subcategories: Subcategory[],
  categoryId: string,
  name: string,
): Subcategory | undefined {
  const n = name.trim().toLowerCase()
  return routingTargets(subcategories).find(
    (s) => s.categoryId === categoryId && s.name.trim().toLowerCase() === n,
  )
}

/** Build the sheet's starting state from the pending proposals. */
export function initialState(
  proposals: RoutingProposal[],
  subcategories: Subcategory[],
): SortState {
  const live = new Set(routingTargets(subcategories).map((s) => s.id))
  const newGroups: NewGroup[] = []
  const shownExisting: string[] = []
  let nextKey = 1
  const items = proposals.map((p): SortItem => {
    let dest: Dest = { kind: 'keep' }
    if (p.toSubcategoryId && live.has(p.toSubcategoryId)) {
      dest = { kind: 'existing', subId: p.toSubcategoryId }
    } else if (p.newListName && p.newListCategoryId) {
      const name = p.newListName.trim()
      // A list with this name may have been created since the proposal.
      const existing = findExisting(subcategories, p.newListCategoryId, name)
      if (existing) {
        dest = { kind: 'existing', subId: existing.id }
      } else if (!isGeneralName(name)) {
        let g = newGroups.find(
          (x) =>
            x.categoryId === p.newListCategoryId &&
            x.name.toLowerCase() === name.toLowerCase(),
        )
        if (!g) {
          g = { key: `n${nextKey++}`, name, categoryId: p.newListCategoryId, emptyOk: false }
          newGroups.push(g)
        }
        dest = { kind: 'new', key: g.key }
      }
    }
    if (dest.kind === 'existing' && !shownExisting.includes(dest.subId)) {
      shownExisting.push(dest.subId)
    }
    return {
      proposalId: p.id,
      taskId: p.taskId,
      title: p.title,
      reason: p.reason,
      fromSubcategoryId: p.fromSubcategoryId,
      dest,
    }
  })
  return { items, newGroups, shownExisting, nextKey }
}

export function groupId(dest: Dest): string {
  if (dest.kind === 'existing') return `list:${dest.subId}`
  if (dest.kind === 'new') return `new:${dest.key}`
  return 'keep'
}

export function destFromGroupId(id: string): Dest | null {
  if (id === 'keep') return { kind: 'keep' }
  if (id.startsWith('list:')) return { kind: 'existing', subId: id.slice(5) }
  if (id.startsWith('new:')) return { kind: 'new', key: id.slice(4) }
  return null
}

function sameDest(a: Dest, b: Dest): boolean {
  return groupId(a) === groupId(b)
}

/** Move one card. A New group left empty by the move disappears. */
export function moveItem(state: SortState, proposalId: string, dest: Dest): SortState {
  const item = state.items.find((i) => i.proposalId === proposalId)
  if (!item || sameDest(item.dest, dest)) return state
  if (dest.kind === 'new' && !state.newGroups.some((g) => g.key === dest.key)) return state
  const items = state.items.map((i) => (i.proposalId === proposalId ? { ...i, dest } : i))
  const shownExisting =
    dest.kind === 'existing' && !state.shownExisting.includes(dest.subId)
      ? [...state.shownExisting, dest.subId]
      : state.shownExisting
  const used = new Set(
    items.filter((i) => i.dest.kind === 'new').map((i) => (i.dest as { key: string }).key),
  )
  const newGroups = state.newGroups
    .map((g) => (dest.kind === 'new' && g.key === dest.key ? { ...g, emptyOk: false } : g))
    .filter((g) => used.has(g.key) || g.emptyOk)
  return { ...state, items, newGroups, shownExisting }
}

/** Why a New-list name is unusable, or null when it is fine. */
export function newListNameError(
  state: SortState,
  subcategories: Subcategory[],
  categoryId: string,
  name: string,
  ownKey?: string,
): string | null {
  const n = name.trim()
  if (n.length < 1 || n.length > 40) return 'Name must be 1–40 characters'
  if (isGeneralName(n)) return 'Pick a name other than General'
  if (findExisting(subcategories, categoryId, n)) return 'A list with that name exists'
  const clash = state.newGroups.some(
    (g) =>
      g.key !== ownKey &&
      g.categoryId === categoryId &&
      g.name.toLowerCase() === n.toLowerCase(),
  )
  return clash ? 'A new list with that name exists' : null
}

/** `+ New list`: an empty group the user can drag cards into. */
export function addNewGroup(state: SortState, name: string, categoryId: string): SortState {
  const key = `n${state.nextKey}`
  return {
    ...state,
    nextKey: state.nextKey + 1,
    newGroups: [...state.newGroups, { key, name: name.trim(), categoryId, emptyOk: true }],
  }
}

export function renameNewGroup(state: SortState, key: string, name: string): SortState {
  return {
    ...state,
    newGroups: state.newGroups.map((g) => (g.key === key ? { ...g, name: name.trim() } : g)),
  }
}

/**
 * The groups in sheet order: existing lists (category order, then list order),
 * New lists, then Keep in General — always present, possibly empty.
 */
export function buildGroups(
  state: SortState,
  categories: Category[],
  subcategories: Subcategory[],
): Group[] {
  const catIndex = new Map(categories.map((c, i) => [c.id, i]))
  const catName = new Map(categories.map((c) => [c.id, c.name as string]))
  const byGroup = new Map<string, SortItem[]>()
  for (const i of state.items) {
    const id = groupId(i.dest)
    byGroup.set(id, [...(byGroup.get(id) ?? []), i])
  }
  const subs = new Map(subcategories.map((s) => [s.id, s]))
  const existing = state.shownExisting
    .map((id) => subs.get(id))
    .filter((s): s is Subcategory => Boolean(s))
    .sort(
      (a, b) =>
        (catIndex.get(a.categoryId) ?? 99) - (catIndex.get(b.categoryId) ?? 99) ||
        a.sortOrder - b.sortOrder,
    )
    .map(
      (sub): Group => ({
        kind: 'existing',
        id: `list:${sub.id}`,
        sub,
        categoryName: catName.get(sub.categoryId) ?? '',
        items: byGroup.get(`list:${sub.id}`) ?? [],
      }),
    )
  const fresh = state.newGroups.map(
    (group): Group => ({
      kind: 'new',
      id: `new:${group.key}`,
      group,
      categoryName: catName.get(group.categoryId) ?? '',
      items: byGroup.get(`new:${group.key}`) ?? [],
    }),
  )
  return [...existing, ...fresh, { kind: 'keep', id: 'keep', items: byGroup.get('keep') ?? [] }]
}

export type ApplyPayload = {
  new_lists: { key: string; name: string; category_id: string }[]
  items: {
    proposal_id: string
    to: { subcategory_id: string } | { new_list_key: string } | null
  }[]
}

/** The exact `apply_routing` payload for the sheet as arranged. */
export function buildPayload(state: SortState): ApplyPayload {
  const used = new Set(
    state.items.filter((i) => i.dest.kind === 'new').map((i) => (i.dest as { key: string }).key),
  )
  return {
    new_lists: state.newGroups
      .filter((g) => used.has(g.key))
      .map((g) => ({ key: g.key, name: g.name, category_id: g.categoryId })),
    items: state.items.map((i) => ({
      proposal_id: i.proposalId,
      to:
        i.dest.kind === 'existing'
          ? { subcategory_id: i.dest.subId }
          : i.dest.kind === 'new'
            ? { new_list_key: i.dest.key }
            : null,
    })),
  }
}

export type ApplyResult = { moved: number; kept: number; stale: number; created_lists: number }

export function approveToast(r: ApplyResult): string {
  const base = `Moved ${r.moved} · kept ${r.kept}`
  return r.stale > 0 ? `${base} · ${r.stale} changed since` : base
}
