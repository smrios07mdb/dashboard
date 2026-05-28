/*
 * AI triage client (ARCHITECTURE.md §10).
 *
 * Calls the Anthropic Messages API directly from the browser with the
 * user-supplied key (`anthropic-dangerous-direct-browser-access`). The
 * key lives in `settings.ai_api_key`, readable only by its owner via
 * RLS. The exposure tradeoff is documented in docs/security.md — this
 * module deliberately does NOT try to hide the key.
 *
 * Design split for testability: the join (`buildTriageTasks`), the
 * response-block extraction (`extractTextBlock`), and the JSON parse
 * (`parseTriageResult`) are pure and unit-tested without mocks. Only
 * `triage()` touches the network / session / settings boundary.
 *
 * Model: `claude-haiku-4-5`. Triage just ranks a small JSON payload by
 * deadline / priority / time-fit — no reasoning-heavy generation — so
 * Haiku is sufficient and meaningfully cheaper per call than Sonnet.
 * `claude-haiku-4-5` is the convenience alias for the current Haiku 4.5
 * snapshot.
 */
import { repo } from '@/db/repo'
import { supabase } from '@/lib/supabase'
import type { Category, Subcategory, Task } from '@/db/types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 800

const SYSTEM_PROMPT =
  "You are a triage assistant for a personal productivity dashboard. " +
  "Given a list of the user's incomplete tasks and their available time, " +
  'recommend 1–3 tasks to do next. Consider deadlines, time fit, priority, ' +
  'and category balance. Respond with valid JSON only: ' +
  '{ "recommendations": [{ "task_id": "...", "reason": "<one sentence>" }], ' +
  '"note": "<optional brief note>" }. Do not include any text outside the JSON.'

export type AiErrorKind = 'missing-key' | 'network' | 'auth' | 'malformed'

const MESSAGES: Record<AiErrorKind, string> = {
  'missing-key': 'Add your API key in Settings.',
  network: "Couldn't reach the AI. Try again.",
  auth: 'API key rejected. Update it in Settings.',
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

/**
 * The §10 call. Reads the key from settings (throws `missing-key` if
 * absent), POSTs the assembled task payload, and maps transport failures
 * to typed errors: 401 → `auth`, fetch-reject / non-OK → `network`,
 * non-JSON body or non-conforming JSON → `malformed`.
 */
export async function triage(args: {
  tasks: TriageTask[]
  availableMinutes: number
  timezone: string
}): Promise<TriageResult> {
  const apiKey = await resolveApiKey()

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          tasks: args.tasks,
          available_minutes: args.availableMinutes,
          timezone: args.timezone,
        }),
      },
    ],
  }

  let res: { ok: boolean; status: number; json: () => Promise<unknown> }
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AiError('network')
  }

  if (res.status === 401) throw new AiError('auth')
  if (!res.ok) throw new AiError('network')

  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new AiError('malformed')
  }

  return parseTriageResult(extractTextBlock(data))
}

async function resolveApiKey(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data?.session?.user?.id
  if (!userId) throw new AiError('missing-key')
  const settings = await repo.settings.get(userId)
  const key = settings?.aiApiKey?.trim()
  if (!key) throw new AiError('missing-key')
  return key
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
