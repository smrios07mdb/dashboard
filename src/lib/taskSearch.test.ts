import { describe, expect, it } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

import { searchTasks } from './taskSearch'

/* Chunk 73 (UX audit #7): open-task search on title + list name. */

const categories: Category[] = [
  { id: 'cat-p', userId: 'u', name: 'Personal' },
  { id: 'cat-w', userId: 'u', name: 'Work' },
]
const subcategories: Subcategory[] = [
  { id: 'p-errands', userId: 'u', categoryId: 'cat-p', name: 'Errands', sortOrder: 0, archivedAt: null },
  { id: 'w-deals', userId: 'u', categoryId: 'cat-w', name: 'Deals', sortOrder: 0, archivedAt: null },
  { id: 'w-old', userId: 'u', categoryId: 'cat-w', name: 'Old', sortOrder: 1, archivedAt: '2026-01-01T00:00:00.000Z' },
]

let seq = 0
function task(title: string, subcategoryId: string, over: Partial<Task> = {}): Task {
  seq += 1
  const at = `2026-10-01T00:00:${String(seq).padStart(2, '0')}.000Z`
  return {
    id: `t${seq}`,
    userId: 'u',
    subcategoryId,
    title,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  }
}

const search = (query: string, tasks: Task[], limit?: number) =>
  searchTasks(query, { categories, subcategories, tasks }, limit).map((h) => h.task.title)

describe('searchTasks (chunk 73)', () => {
  it('matches every term, case-insensitively, in any order', () => {
    const tasks = [
      task('Call Bob about the term sheet', 'w-deals'),
      task('Call Alice', 'w-deals'),
      task('Send term sheet', 'w-deals'),
    ]
    expect(search('SHEET call', tasks)).toEqual(['Call Bob about the term sheet'])
    expect(search('call', tasks)).toEqual(['Call Bob about the term sheet', 'Call Alice'])
  })

  it('matches on the list name and reports the list and category', () => {
    const tasks = [task('Buy stamps', 'p-errands'), task('Call Bob', 'w-deals')]
    const hits = searchTasks('errands', { categories, subcategories, tasks })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ subName: 'Errands', catName: 'Personal' })
    expect(hits[0].task.title).toBe('Buy stamps')
    // A term may come from the title and another from the list.
    expect(search('bob deals', tasks)).toEqual(['Call Bob'])
    // The category name is not searched.
    expect(search('personal', tasks)).toEqual([])
  })

  it('skips completed tasks and tasks in an archived or missing list', () => {
    const tasks = [
      task('Review open', 'w-deals'),
      task('Review done', 'w-deals', { completedAt: '2026-10-02T00:00:00.000Z' }),
      task('Review archived', 'w-old'),
      task('Review orphan', 'nope'),
    ]
    expect(search('review', tasks)).toEqual(['Review open'])
  })

  it('puts titles starting with the first term first, oldest first in each group', () => {
    const tasks = [
      task('Prepare the plan', 'w-deals', { createdAt: '2026-10-01T00:00:00.000Z' }),
      task('Plan B', 'w-deals', { createdAt: '2026-10-03T00:00:00.000Z' }),
      task('Review plan', 'w-deals', { createdAt: '2026-09-01T00:00:00.000Z' }),
      task('plan A', 'w-deals', { createdAt: '2026-10-02T00:00:00.000Z' }),
    ]
    expect(search('plan', tasks)).toEqual([
      'plan A',
      'Plan B',
      'Review plan',
      'Prepare the plan',
    ])
  })

  it('cuts to the limit (20 by default)', () => {
    const tasks = Array.from({ length: 25 }, (_, i) => task(`Item ${i}`, 'w-deals'))
    expect(search('item', tasks)).toHaveLength(20)
    expect(search('item', tasks, 3)).toEqual(['Item 0', 'Item 1', 'Item 2'])
  })

  it('a blank query matches nothing', () => {
    const tasks = [task('Anything', 'w-deals')]
    expect(search('', tasks)).toEqual([])
    expect(search('   ', tasks)).toEqual([])
  })
})
