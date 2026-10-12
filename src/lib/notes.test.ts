import { describe, expect, it } from 'vitest'

import { CTX, mkNote } from '@/components/notebook/fixtures'

import {
  isNoteEditorPath,
  NOTE_LINK_SOURCE,
  noteExcerpt,
  noteFirstLine,
  noteMatchLine,
  noteRel,
  noteRelLong,
  noteSaveState,
  notesDescription,
  notesForList,
  notesForTask,
  resolveAttachment,
  stripNoteMarkdown,
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

describe('link pattern shared with the renderer (chunk 59, D9)', () => {
  it('keeps one level of balanced parentheses inside the URL', () => {
    expect(
      stripNoteMarkdown('see [x](https://en.wikipedia.org/wiki/Foo_(bar)) now'),
    ).toBe('see x now')
    expect(
      noteExcerpt({
        title: 'T',
        body: '[x](https://en.wikipedia.org/wiki/Foo_(bar))',
      }),
    ).toBe('x')
  })

  it('strips a disallowed-scheme link down to its text', () => {
    expect(noteExcerpt({ title: 'T', body: '[bad](javascript:alert(1))' })).toBe(
      'bad',
    )
  })

  it('NOTE_LINK_SOURCE captures text and the whole URL', () => {
    const m = new RegExp(NOTE_LINK_SOURCE).exec(
      '[x](https://en.wikipedia.org/wiki/Foo_(bar))',
    )
    expect(m?.[1]).toBe('x')
    expect(m?.[2]).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
  })
})

describe('task and list selections (chunk 59)', () => {
  const notes = [
    mkNote({ id: 'a', taskId: 't-open', updatedAt: '2026-10-01T00:00:00.000Z' }),
    mkNote({ id: 'b', taskId: 't-open', updatedAt: '2026-10-03T00:00:00.000Z' }),
    mkNote({ id: 'c', subcategoryId: 's-atlas', updatedAt: '2026-10-02T00:00:00.000Z' }),
    mkNote({ id: 'd', taskId: 't-elsewhere' }),
    mkNote({ id: 'e' }),
  ]

  it('notesForTask returns that task’s notes, newest first', () => {
    expect(notesForTask(notes, 't-open').map((n) => n.id)).toEqual(['b', 'a'])
    expect(notesForTask(notes, null)).toEqual([])
  })

  it('notesForList includes notes on the list and on its tasks', () => {
    expect(
      notesForList(notes, 's-atlas', ['t-open']).map((n) => n.id),
    ).toEqual(['b', 'c', 'a'])
  })

  it('notesDescription: newest first, title then body, blanks dropped', () => {
    expect(
      notesDescription([
        mkNote({ id: 'old', title: 'Old', body: 'first', updatedAt: '2026-10-01T00:00:00.000Z' }),
        mkNote({ id: 'new', title: '', body: '- raw *markdown*', updatedAt: '2026-10-05T00:00:00.000Z' }),
        mkNote({ id: 'blank', title: ' ', body: '\n', updatedAt: '2026-10-09T00:00:00.000Z' }),
        mkNote({ id: 'title-only', title: 'Just a title', body: '', updatedAt: '2026-10-03T00:00:00.000Z' }),
      ]),
    ).toBe('- raw *markdown*\n\nJust a title\n\nOld\n\nfirst')
    expect(notesDescription([])).toBe('')
  })
})
