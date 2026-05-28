import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

// Hoisted mocks for the impure boundary `triage()` touches: the current
// session (to resolve the user id), the settings read (to get the key),
// and `fetch` (the Anthropic call). The pure helpers below need none of
// these. Mirrors the vi.hoisted + vi.mock shape in src/db/repo.test.ts.
const { getSessionMock, settingsGetMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  settingsGetMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}))

vi.mock('@/db/repo', () => ({
  repo: { settings: { get: settingsGetMock } },
}))

import {
  AiError,
  buildTriageTasks,
  extractTextBlock,
  parseTriageResult,
  triage,
  type TriageTask,
} from './ai'

// ---------- factories ----------

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    userId: 'u1',
    subcategoryId: 'sub-1',
    title: 'Write report',
    notes: null,
    estimateMinutes: 25,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    ...over,
  }
}

function sub(over: Partial<Subcategory> = {}): Subcategory {
  return {
    id: 'sub-1',
    userId: 'u1',
    categoryId: 'cat-1',
    name: 'Reports',
    sortOrder: 0,
    archivedAt: null,
    ...over,
  }
}

function cat(over: Partial<Category> = {}): Category {
  return { id: 'cat-1', userId: 'u1', name: 'Work', ...over }
}

// ---------- buildTriageTasks ----------

describe('buildTriageTasks', () => {
  it('joins subcategory + category names and maps camelCase → snake_case', () => {
    const result = buildTriageTasks(
      [task({ id: 't1', title: 'Write report', estimateMinutes: 25 })],
      [sub({ id: 'sub-1', name: 'Reports', categoryId: 'cat-1' })],
      [cat({ id: 'cat-1', name: 'Work' })],
    )
    expect(result).toEqual([
      {
        task_id: 't1',
        title: 'Write report',
        subcategory_name: 'Reports',
        category_name: 'Work',
        estimate_minutes: 25,
        due_at: null,
        priority: null,
      },
    ])
  })

  it('passes due_at and priority through, including non-null values', () => {
    const [payload] = buildTriageTasks(
      [task({ dueAt: '2026-06-01T17:00:00.000Z', priority: 1 })],
      [sub()],
      [cat()],
    )
    expect(payload.due_at).toBe('2026-06-01T17:00:00.000Z')
    expect(payload.priority).toBe(1)
  })

  it('skips a task whose subcategory cannot be resolved', () => {
    const result = buildTriageTasks(
      [task({ id: 'orphan', subcategoryId: 'missing' })],
      [sub({ id: 'sub-1' })],
      [cat()],
    )
    expect(result).toEqual([])
  })

  it('skips a task whose category cannot be resolved', () => {
    const result = buildTriageTasks(
      [task({ subcategoryId: 'sub-1' })],
      [sub({ id: 'sub-1', categoryId: 'gone' })],
      [cat({ id: 'cat-1' })],
    )
    expect(result).toEqual([])
  })
})

// ---------- extractTextBlock ----------

describe('extractTextBlock', () => {
  it('returns the text of the first text block', () => {
    const text = extractTextBlock({
      content: [{ type: 'text', text: '{"ok":true}' }],
    })
    expect(text).toBe('{"ok":true}')
  })

  it('finds the text block even when it is not first', () => {
    const text = extractTextBlock({
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'hello' },
      ],
    })
    expect(text).toBe('hello')
  })

  it('throws a malformed AiError when there is no text block', () => {
    expect(() => extractTextBlock({ content: [{ type: 'tool_use' }] })).toThrow(
      AiError,
    )
    try {
      extractTextBlock({ content: [] })
    } catch (e) {
      expect((e as AiError).kind).toBe('malformed')
    }
  })

  it('throws a malformed AiError when content is missing entirely', () => {
    try {
      extractTextBlock({ id: 'msg_1' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AiError)
      expect((e as AiError).kind).toBe('malformed')
    }
  })
})

// ---------- parseTriageResult ----------

describe('parseTriageResult', () => {
  it('parses clean JSON and maps task_id → taskId', () => {
    const result = parseTriageResult(
      '{"recommendations":[{"task_id":"t1","reason":"Due soon"}],"note":"Tight window"}',
    )
    expect(result).toEqual({
      recommendations: [{ taskId: 't1', reason: 'Due soon' }],
      note: 'Tight window',
    })
  })

  it('omits note when the model does not provide one', () => {
    const result = parseTriageResult(
      '{"recommendations":[{"task_id":"t2","reason":"Quick win"}]}',
    )
    expect(result.note).toBeUndefined()
    expect(result.recommendations).toHaveLength(1)
  })

  it('strips a ```json code fence before parsing', () => {
    const fenced =
      '```json\n{"recommendations":[{"task_id":"t1","reason":"r"}]}\n```'
    expect(parseTriageResult(fenced).recommendations[0].taskId).toBe('t1')
  })

  it('strips a bare ``` code fence before parsing', () => {
    const fenced = '```\n{"recommendations":[{"task_id":"t9","reason":"r"}]}\n```'
    expect(parseTriageResult(fenced).recommendations[0].taskId).toBe('t9')
  })

  it('throws a malformed AiError carrying the raw text on invalid JSON', () => {
    const raw = 'Sorry, I cannot help with that.'
    try {
      parseTriageResult(raw)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AiError)
      expect((e as AiError).kind).toBe('malformed')
      expect((e as AiError).raw).toBe(raw)
    }
  })

  it('throws a malformed AiError when recommendations is not an array', () => {
    try {
      parseTriageResult('{"note":"no recs here"}')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as AiError).kind).toBe('malformed')
    }
  })
})

// ---------- AiError ----------

describe('AiError', () => {
  it('is an Error with a kind discriminant and optional raw payload', () => {
    const err = new AiError('malformed', 'bad', 'the raw text')
    expect(err).toBeInstanceOf(Error)
    expect(err.kind).toBe('malformed')
    expect(err.message).toBe('bad')
    expect(err.raw).toBe('the raw text')
  })
})

// ---------- triage (integration over the boundary) ----------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

function payloadTask(over: Partial<TriageTask> = {}): TriageTask {
  return {
    task_id: 't1',
    title: 'Write report',
    subcategory_name: 'Reports',
    category_name: 'Work',
    estimate_minutes: 25,
    due_at: null,
    priority: null,
    ...over,
  }
}

function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
  }
}

describe('triage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
    })
    settingsGetMock.mockResolvedValue({ aiApiKey: 'sk-ant-secret' })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns parsed recommendations on a successful call', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        '{"recommendations":[{"task_id":"t1","reason":"Fits your 30 minutes"}],"note":"Go"}',
      ),
    )
    const result = await triage({
      tasks: [payloadTask()],
      availableMinutes: 30,
      timezone: 'America/New_York',
    })
    expect(result.recommendations).toEqual([
      { taskId: 't1', reason: 'Fits your 30 minutes' },
    ])
    expect(result.note).toBe('Go')
  })

  it('calls the Anthropic endpoint directly with the required headers and model', async () => {
    fetchMock.mockResolvedValue(
      okResponse('{"recommendations":[{"task_id":"t1","reason":"r"}]}'),
    )
    await triage({
      tasks: [payloadTask()],
      availableMinutes: 30,
      timezone: 'America/New_York',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ANTHROPIC_URL)
    expect(init.method).toBe('POST')
    expect(init.headers['x-api-key']).toBe('sk-ant-secret')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe(
      'true',
    )
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.max_tokens).toBe(800)
    const userContent = JSON.parse(body.messages[0].content)
    expect(userContent.available_minutes).toBe(30)
    expect(userContent.tasks[0].task_id).toBe('t1')
  })

  it('throws a missing-key AiError when no key is stored', async () => {
    settingsGetMock.mockResolvedValue({ aiApiKey: null })
    await expect(
      triage({ tasks: [payloadTask()], availableMinutes: 30, timezone: 'UTC' }),
    ).rejects.toMatchObject({ kind: 'missing-key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws a missing-key AiError when there is no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    await expect(
      triage({ tasks: [payloadTask()], availableMinutes: 30, timezone: 'UTC' }),
    ).rejects.toMatchObject({ kind: 'missing-key' })
  })

  it('throws an auth AiError on HTTP 401', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await expect(
      triage({ tasks: [payloadTask()], availableMinutes: 30, timezone: 'UTC' }),
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  it('throws a network AiError when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      triage({ tasks: [payloadTask()], availableMinutes: 30, timezone: 'UTC' }),
    ).rejects.toMatchObject({ kind: 'network' })
  })

  it('throws a network AiError on a 500 response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    await expect(
      triage({ tasks: [payloadTask()], availableMinutes: 30, timezone: 'UTC' }),
    ).rejects.toMatchObject({ kind: 'network' })
  })

  it('throws a malformed AiError (with raw) when the model returns non-JSON', async () => {
    fetchMock.mockResolvedValue(okResponse('I think you should relax.'))
    await expect(
      triage({ tasks: [payloadTask()], availableMinutes: 30, timezone: 'UTC' }),
    ).rejects.toMatchObject({
      kind: 'malformed',
      raw: 'I think you should relax.',
    })
  })
})
