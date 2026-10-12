import { describe, expect, it } from 'vitest'

import { CTX, mkNote } from '@/components/notebook/fixtures'

import {
  isNoteEditorPath,
  noteExcerpt,
  noteFirstLine,
  noteMatchLine,
  noteRel,
  noteRelLong,
  noteSaveState,
  resolveAttachment,
} from './notes'

describe('isNoteEditorPath', () => {
  it('matches /notebook/:noteId only', () => {
    expect(isNoteEditorPath('/notebook/abc')).toBe(true)
    expect(isNoteEditorPath('/notebook/abc/')).toBe(true)
    expect(isNoteEditorPath('/notebook')).toBe(false)
    expect(isNoteEditorPath('/notebook/')).toBe(false)
    expect(isNoteEditorPath('/')).toBe(false)
    expect(isNoteEditorPath('/planner')).toBe(false)
    expect(isNoteEditorPath('/subcategory/abc')).toBe(false)
  })
})

describe('list text', () => {
  it('headline: title, else first body line, else Untitled', () => {
    expect(noteFirstLine({ title: 'T', body: 'b' })).toBe('T')
    expect(noteFirstLine({ title: '', body: '\n## Heading\nrest' })).toBe('Heading')
    expect(noteFirstLine({ title: '', body: '' })).toBe('Untitled')
  })

  it('excerpt strips Markdown and drops the line used as the headline', () => {
    const body = '# One\n- two\n[three](https://x.y)'
    expect(noteExcerpt({ title: 'T', body })).toBe('One · two · three')
    expect(noteExcerpt({ title: '', body })).toBe('two · three')
  })

  it('match line trims to ~40 characters before the match', () => {
    const long = `${'a'.repeat(60)} needle tail`
    expect(noteMatchLine({ body: `first\n${long}` }, 'NEEDLE')).toBe(
      `…${'a'.repeat(39)} needle tail`,
    )
    expect(noteMatchLine({ body: 'short needle' }, 'needle')).toBe('short needle')
    expect(noteMatchLine({ body: 'nothing' }, 'needle')).toBeNull()
  })
})

describe('relative time', () => {
  const now = new Date('2026-10-12T12:00:00.000Z')
  const ago = (minutes: number) =>
    new Date(now.getTime() - minutes * 60000).toISOString()

  it('now / minutes / hours / Yesterday / date', () => {
    expect(noteRel(ago(0.5), now)).toBe('now')
    expect(noteRel(ago(42), now)).toBe('42m')
    expect(noteRel(ago(60 * 3), now)).toBe('3h')
    expect(noteRel(ago(60 * 30), now)).toBe('Yesterday')
    expect(noteRel('2026-10-03T12:00:00.000Z', now)).toBe('Oct 3')
  })

  it('the footer phrase', () => {
    expect(noteRelLong(ago(0), now)).toBe('just now')
    expect(noteRelLong(ago(42), now)).toBe('42m ago')
    expect(noteRelLong(ago(60 * 30), now)).toBe('Yesterday')
  })
})

describe('resolveAttachment', () => {
  it('a live link wins over a stale memo; a memo alone is detached', () => {
    expect(
      resolveAttachment(
        mkNote({ id: 'a', taskId: 't-open', detachedLabel: 'Old' }),
        CTX,
      ),
    ).toMatchObject({ kind: 'task', name: 'Ship the pricing page', categoryName: 'Work' })
    expect(
      resolveAttachment(mkNote({ id: 'b', detachedLabel: 'Old' }), CTX),
    ).toEqual({ kind: 'detached', name: 'Old' })
    expect(resolveAttachment(mkNote({ id: 'c' }), CTX)).toBeNull()
  })

  it('a link whose target is not loaded resolves to nothing', () => {
    expect(resolveAttachment(mkNote({ id: 'd', taskId: 'gone' }), CTX)).toBeNull()
  })
})

describe('noteSaveState', () => {
  it('covers the four states', () => {
    expect(noteSaveState({ sync: 'synced', queued: 0, pending: false })).toEqual({
      dot: 'synced',
      label: 'Saved',
    })
    expect(noteSaveState({ sync: 'synced', queued: 0, pending: true }).label).toBe('Syncing')
    expect(noteSaveState({ sync: 'syncing', queued: 2, pending: false }).label).toBe('Syncing')
    expect(noteSaveState({ sync: 'offline', queued: 0, pending: false }).label).toBe(
      'Offline · saved on this device',
    )
    expect(noteSaveState({ sync: 'offline', queued: 1, pending: false }).label).toBe(
      'Offline · 1 change queued',
    )
    expect(noteSaveState({ sync: 'offline', queued: 1, pending: true }).label).toBe(
      'Offline · 2 changes queued',
    )
  })
})
