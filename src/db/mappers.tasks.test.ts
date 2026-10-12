import { describe, expect, it } from 'vitest'

import { taskFromRow, taskToRow, type TaskRow } from './mappers'
import type { Task } from './types'

/*
 * Chunk 59, D1: the client no longer reads or writes `tasks.notes`. The
 * column survives until chunk 60, so a row may still carry it — it is ignored.
 */

const ROW: TaskRow = {
  id: 't1',
  user_id: 'u1',
  subcategory_id: 's1',
  title: 'Write report',
  estimate_minutes: 25,
  due_at: null,
  remind_at: null,
  notified: false,
  priority: 2,
  completed_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
}

describe('task mappers without notes (chunk 59)', () => {
  it('taskFromRow ignores a `notes` column the server still returns', () => {
    const legacy = { ...ROW, notes: 'left over from before chunk 59' }
    const task = taskFromRow(legacy as TaskRow)
    expect(task).not.toHaveProperty('notes')
    expect(task.title).toBe('Write report')
  })

  it('taskToRow never produces a `notes` key', () => {
    const task: Task = taskFromRow(ROW)
    expect(taskToRow(task)).not.toHaveProperty('notes')
    // Not even when an old cached Dexie row leaks the property through.
    const cached = { ...task, notes: 'cached' } as Task
    expect(taskToRow(cached)).not.toHaveProperty('notes')
  })
})
