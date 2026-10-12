import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

// Hoisted mocks for the impure boundary `triage()` touches: the current
// session (for the Supabase JWT) and `fetch` (the proxy call). The pure
// helpers below need neither. The module reads VITE_CALDAV_PROXY_URL at load
// time, so the stub has to be hoisted above the import (calendarApi.test.ts).
const { getSessionMock } = vi.hoisted(() => {
  vi.stubEnv('VITE_CALDAV_PROXY_URL', 'https://proxy.test/')
  return { getSessionMock: vi.fn() }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}))

import {
  AiError,
  buildTriageTasks,
  extractTextBlock,
  parseTriageResult,
  removeAiKey,
  saveAiKey,
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

const TRIAGE_URL = 'https://proxy.test/api/ai/triage'
const KEY_URL = 'https://proxy.test/api/ai/key'

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

/** A proxy reply: `{ ok:true, data: <Anthropic Messages JSON> }`. */
function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      data: { content: [{ type: 'text', text }] },
    }),
  }
}

function errResponse(status: number, body?: unknown) {
  return {
    ok: false,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected token <')
      return body
    },
  }
}

const ARGS = { tasks: [payloadTask()], availableMinutes: 30, timezone: 'UTC' }

describe('triage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'jwt-1', user: { id: 'u1' } } },
      error: null,
    })
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

  it('POSTs the task payload to the proxy with the Supabase JWT — no key, model or prompt', async () => {
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
    expect(url).toBe(TRIAGE_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      Authorization: 'Bearer jwt-1',
    })
    // The proxy owns model / max_tokens / system prompt (chunk 55 D3).
    expect(JSON.parse(init.body)).toEqual({
      tasks: [payloadTask()],
      available_minutes: 30,
      timezone: 'America/New_York',
    })
  })

  it('reads the session per request (tokens refresh in the background)', async () => {
    fetchMock.mockResolvedValue(okResponse('{"recommendations":[]}'))
    await triage(ARGS)
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'jwt-2' } },
      error: null,
    })
    await triage(ARGS)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer jwt-2',
    )
  })

  // ── D8 mapping table: one test per row ──────────────────────────────

  it('412 → missing-key', async () => {
    fetchMock.mockResolvedValue(errResponse(412, { error: 'missing_key' }))
    await expect(triage(ARGS)).rejects.toMatchObject({
      kind: 'missing-key',
      message: 'Add your Anthropic key in Settings.',
    })
  })

  it('422 → auth', async () => {
    fetchMock.mockResolvedValue(errResponse(422, { error: 'bad_key' }))
    await expect(triage(ARGS)).rejects.toMatchObject({
      kind: 'auth',
      message: 'Anthropic rejected the key. Replace it in Settings.',
    })
  })

  it('401 → network with the session-expired message (the JWT, not the AI key)', async () => {
    fetchMock.mockResolvedValue(
      errResponse(401, { ok: false, error: 'unauthorized' }),
    )
    await expect(triage(ARGS)).rejects.toMatchObject({
      kind: 'network',
      message: 'Your session expired — sign in again.',
    })
  })

  it('fetch reject → network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(triage(ARGS)).rejects.toMatchObject({
      kind: 'network',
      message: "Couldn't reach the AI. Try again.",
    })
  })

  it('500 → network', async () => {
    fetchMock.mockResolvedValue(
      errResponse(500, { ok: false, error: 'internal' }),
    )
    await expect(triage(ARGS)).rejects.toMatchObject({ kind: 'network' })
  })

  it('502 → network, even with a non-JSON body', async () => {
    fetchMock.mockResolvedValue(errResponse(502))
    await expect(triage(ARGS)).rejects.toMatchObject({ kind: 'network' })
  })

  it('non-JSON body → malformed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })
    await expect(triage(ARGS)).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('ok:false without a mapped code → malformed', async () => {
    fetchMock.mockResolvedValue(
      errResponse(400, { ok: false, error: 'invalid_request' }),
    )
    await expect(triage(ARGS)).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('no session → network (session-expired), proxy not called', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    await expect(triage(ARGS)).rejects.toMatchObject({
      kind: 'network',
      message: 'Your session expired — sign in again.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws a malformed AiError (with raw) when the model returns non-JSON', async () => {
    fetchMock.mockResolvedValue(okResponse('I think you should relax.'))
    await expect(triage(ARGS)).rejects.toMatchObject({
      kind: 'malformed',
      raw: 'I think you should relax.',
    })
  })

  it('ok:true without data → malformed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    await expect(triage(ARGS)).rejects.toMatchObject({ kind: 'malformed' })
  })
})

// ---------- key management (chunk 55 D2/D9) ----------

describe('saveAiKey / removeAiKey', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'jwt-1' } },
      error: null,
    })
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('saveAiKey POSTs { api_key } to the proxy with the JWT', async () => {
    await saveAiKey('sk-ant-new')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(KEY_URL)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jwt-1')
    expect(JSON.parse(init.body)).toEqual({ api_key: 'sk-ant-new' })
  })

  it('saveAiKey: 422 → auth (rejected key), 502 → network', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(422, { error: 'bad_key' }))
    await expect(saveAiKey('sk-ant-bad')).rejects.toMatchObject({
      kind: 'auth',
    })
    fetchMock.mockResolvedValueOnce(errResponse(502, { error: 'upstream' }))
    await expect(saveAiKey('sk-ant-x')).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('removeAiKey sends DELETE with the JWT and no body', async () => {
    await removeAiKey()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(KEY_URL)
    expect(init.method).toBe('DELETE')
    expect(init.headers).toEqual({ Authorization: 'Bearer jwt-1' })
    expect(init.body).toBeUndefined()
  })
})
