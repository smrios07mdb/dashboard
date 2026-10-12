/*
 * AI triage client (ARCHITECTURE.md §10, chunk 55).
 *
 * Triage goes through the calendar proxy (`POST /api/ai/triage`), which
 * holds the user's Anthropic key AES-GCM-encrypted at rest and owns the
 * model, token cap and system prompt. The browser never reads the key:
 * it leaves this device once, as the HTTPS body of `POST /api/ai/key`,
 * and the app only ever sees `settings.ai_status`. See docs/security.md.
 *
 * Design split for testability: the join (`buildTriageTasks`), the
 * response-block extraction (`extractTextBlock`), and the JSON parse
 * (`parseTriageResult`) are pure and unit-tested without mocks. Only
 * `triage()` / `saveAiKey()` / `removeAiKey()` touch the network / session
 * boundary.
 */
import { supabase } from '@/lib/supabase'
import type { Category, Subcategory, Task } from '@/db/types'

const PROXY_URL = import.meta.env.VITE_CALDAV_PROXY_URL as string | undefined

const SESSION_EXPIRED = 'Your session expired — sign in again.'

export type AiErrorKind = 'missing-key' | 'network' | 'auth' | 'malformed'

const MESSAGES: Record<AiErrorKind, string> = {
  'missing-key': 'Add your Anthropic key in Settings.',
  network: "Couldn't reach the AI. Try again.",
  auth: 'Anthropic rejected the key. Replace it in Settings.',
  malformed: 'AI response was malformed. Try again.',
}

/** The per-task shape the model receives (snake_case per the §10 contract). */
export type TriageTask = {
  task_id: string
  title: string
  subcategory_name: string
  category_name: string
  estimate_minutes: number
  due_at: string | null
  priority: number | null
}

/** Parsed, app-facing result. `taskId` is camelCase; the model emits `task_id`. */
export type TriageResult = {
  recommendations: { taskId: string; reason: string }[]
  note?: string
}

/**
 * Typed error so the UI can branch on `kind` to pick the right copy and
 * CTA. `raw` carries the model's text on a malformed-JSON failure so the
 * "Show raw response" expander has something to show.
 */
export class AiError extends Error {
  readonly kind: AiErrorKind
  readonly raw?: string
  constructor(kind: AiErrorKind, message?: string, raw?: string) {
    super(message ?? MESSAGES[kind])
    this.name = 'AiError'
    this.kind = kind
    this.raw = raw
  }
}

/**
 * Client-side join: task → its subcategory (name + category) → category
 * name, mapping camelCase TS fields to the snake_case the system prompt
 * expects. Tasks whose subcategory or category can't be resolved (e.g.
 * an archived/removed sub) are skipped — we don't recommend tasks we
 * can't contextualize or navigate to.
 */
export function buildTriageTasks(
  tasks: Task[],
  subcategories: Subcategory[],
  categories: Category[],
): TriageTask[] {
  const subById = new Map(subcategories.map((s) => [s.id, s]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  const out: TriageTask[] = []
  for (const t of tasks) {
    const sub = subById.get(t.subcategoryId)
    if (!sub) continue
    const cat = catById.get(sub.categoryId)
    if (!cat) continue
    out.push({
      task_id: t.id,
      title: t.title,
      subcategory_name: sub.name,
      category_name: cat.name,
      estimate_minutes: t.estimateMinutes,
      due_at: t.dueAt,
      priority: t.priority,
    })
  }
  return out
}

/**
 * `data.content` is an array of blocks, not a string. Pull the first
 * block with `type === 'text'` (a thinking/tool_use block can precede
 * it). Throws a malformed AiError if there's no usable text block.
 */
export function extractTextBlock(data: unknown): string {
  const content = (data as { content?: unknown } | null)?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
    }
  }
  throw new AiError('malformed', MESSAGES.malformed, safeStringify(data))
}

/**
 * Defensively strip a ```json (or bare ```) fence the model may wrap the
 * JSON in despite the "JSON only" instruction, then parse and validate.
 * On any failure the raw text rides along in the AiError for the UI's
 * "Show raw response" expander.
 */
export function parseTriageResult(rawText: string): TriageResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(rawText))
  } catch {
    throw new AiError('malformed', MESSAGES.malformed, rawText)
  }
  const recs = (parsed as { recommendations?: unknown } | null)?.recommendations
  if (!Array.isArray(recs)) {
    throw new AiError('malformed', MESSAGES.malformed, rawText)
  }
  const recommendations = recs.map((r) => {
    const taskId = (r as { task_id?: unknown }).task_id
    const reason = (r as { reason?: unknown }).reason
    if (typeof taskId !== 'string' || typeof reason !== 'string') {
      throw new AiError('malformed', MESSAGES.malformed, rawText)
    }
    return { taskId, reason }
  })
  const noteVal = (parsed as { note?: unknown }).note
  const note =
    typeof noteVal === 'string' && noteVal.trim() ? noteVal : undefined
  return note ? { recommendations, note } : { recommendations }
}

type ProxyReply = { status: number; body: unknown }

/**
 * One authenticated call to the proxy's `/api/ai/*`. The session is read per
 * request (tokens refresh in the background — same reasoning as
 * `calendarApi.ts`'s `authHeader`). Transport failures, a missing session
 * and an unset proxy URL all surface as `network`; `body` is `undefined`
 * when the response was not JSON.
 */
async function callAiProxy(path: string, init: RequestInit): Promise<ProxyReply> {
  if (!PROXY_URL) throw new AiError('network')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session) throw new AiError('network', SESSION_EXPIRED)

  let res: { status: number; json: () => Promise<unknown> }
  try {
    res = await fetch(`${PROXY_URL.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${data.session.access_token}`,
      },
    })
  } catch {
    throw new AiError('network')
  }

  // Status first: these carry their meaning without a body (chunk 55 D8).
  // 401 is our Supabase JWT being rejected — not the Anthropic key.
  if (res.status === 401) throw new AiError('network', SESSION_EXPIRED)
  if (res.status === 412) throw new AiError('missing-key')
  if (res.status === 422) throw new AiError('auth')
  if (res.status >= 500) throw new AiError('network')

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new AiError('malformed')
  }
  if ((body as { ok?: unknown } | null)?.ok !== true) {
    throw new AiError('malformed')
  }
  return { status: res.status, body }
}

/**
 * The §10 call, via the proxy. Maps the proxy's statuses to typed errors:
 * 412 → `missing-key`, 422 → `auth`, 401 / fetch-reject / 5xx → `network`,
 * non-JSON or an unmapped `ok:false` → `malformed`. The proxy returns
 * Anthropic's Messages JSON unmodified in `data`; parsing stays here.
 */
export async function triage(args: {
  tasks: TriageTask[]
  availableMinutes: number
  timezone: string
}): Promise<TriageResult> {
  const { body } = await callAiProxy('/api/ai/triage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tasks: args.tasks,
      available_minutes: args.availableMinutes,
      timezone: args.timezone,
    }),
  })
  return parseTriageResult(extractTextBlock((body as { data?: unknown }).data))
}

/**
 * Hand the key to the proxy, which validates it with Anthropic, encrypts it
 * and writes `ai_status` server-side. Callers refetch settings afterwards —
 * never set the status optimistically. Rejected key → `auth`.
 */
export async function saveAiKey(apiKey: string): Promise<void> {
  await callAiProxy('/api/ai/key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  })
}

/** Delete the stored key server-side (`ai_status` → `unconfigured`). */
export async function removeAiKey(): Promise<void> {
  await callAiProxy('/api/ai/key', { method: 'DELETE' })
}

function stripFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  return m ? m[1].trim() : t
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
