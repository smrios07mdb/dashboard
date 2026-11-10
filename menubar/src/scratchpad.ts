/*
 * The menu bar scratchpad (chunk 93, D3–D4). Pure: lines and lists in,
 * create inputs, the footer count, the leftover text and the result line
 * out. One non-empty line is one task.
 *
 * Each line goes through the quick-capture grammar (`parseCapture`) and
 * `resolveCaptureDest` with Work › General as the picked list, so a `#list`,
 * `#work` or `#personal` token still wins. The field mapping is
 * QuickCapture's. `hup:captureDest` is neither read nor written here.
 */
import { DEFAULT_MINUTES } from '@/components/AddTaskInline'
import { fromDueInputValue } from '@/components/SetDuePopover'
import type { Category, Subcategory, Task } from '@/db/types'
import { parseCapture, resolveCaptureDest } from '@/lib/captureParse'

export type ScratchLists = {
  categories: Category[]
  /** Live only (`archivedAt === null`). */
  subcategories: Subcategory[]
  /** The Settings zone. */
  timeZone: string
}

export type ScratchCtx = ScratchLists & { userId: string; now: Date }

export type CreateInput = Pick<
  Task,
  | 'userId'
  | 'subcategoryId'
  | 'title'
  | 'estimateMinutes'
  | 'dueAt'
  | 'remindAt'
  | 'priority'
  | 'completedAt'
>

export type ScratchItem = { line: string; input: CreateInput; label: string }

export type ScratchPlan = {
  /** Non-empty lines. */
  lines: number
  /** Lines that become tasks, in order. */
  items: ScratchItem[]
  /** Non-empty lines that do not (a title empty after parsing, e.g. `p1`). */
  kept: string[]
  /** The one list every item goes to; null when they differ or none do. */
  destLabel: string | null
  /** No live list at all: nothing can be sent. */
  noList: boolean
}

export type ScratchResult = {
  /** What stays in the pad: the lines not sent, in order. */
  leftover: string
  sent: number
  /** The footer's result line. */
  result: string
}

export const NO_LIST = 'No list to send to'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The first live subcategory named `General` in the Work category. */
export function workGeneral(
  lists: Pick<ScratchLists, 'categories' | 'subcategories'>,
): Subcategory | null {
  const work = lists.categories.find((c) => c.name === 'Work')
  if (!work) return null
  return (
    [...lists.subcategories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .find(
        (s) =>
          s.categoryId === work.id &&
          s.archivedAt === null &&
          s.name.trim().toLowerCase() === 'general',
      ) ?? null
  )
}

function listLabel(lists: ScratchLists, sub: Subcategory): string {
  const cat = lists.categories.find((c) => c.id === sub.categoryId)
  return `${cat?.name ?? ''} › ${sub.name}`
}

export function planScratch(text: string, ctx: ScratchCtx): ScratchPlan {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const live = ctx.subcategories.filter((s) => s.archivedAt === null)
  const lists = { ...ctx, subcategories: live }
  if (live.length === 0) {
    return { lines: lines.length, items: [], kept: lines, destLabel: null, noList: true }
  }
  const picked = workGeneral(lists)?.id ?? null
  const items: ScratchItem[] = []
  const kept: string[] = []
  for (const line of lines) {
    const parse = parseCapture(line, {
      now: ctx.now,
      timeZone: ctx.timeZone,
      categories: ctx.categories,
      subcategories: live,
    })
    const dest = resolveCaptureDest(parse, {
      categories: ctx.categories,
      subcategories: live,
      picked,
    })
    if (!dest || parse.title.length === 0) {
      kept.push(line)
      continue
    }
    items.push({
      line,
      label: listLabel(lists, dest),
      input: {
        userId: ctx.userId,
        subcategoryId: dest.id,
        title: parse.title,
        estimateMinutes: parse.estimateMinutes ?? DEFAULT_MINUTES,
        dueAt: parse.dueDay
          ? fromDueInputValue(parse.dueDay, ctx.timeZone)
          : null,
        remindAt: null,
        priority: parse.priority,
        completedAt: null,
      },
    })
  }
  const labels = new Set(items.map((i) => i.label))
  return {
    lines: lines.length,
    items,
    kept,
    destLabel: labels.size === 1 ? [...labels][0] : null,
    noList: false,
  }
}

/** The footer's live count (D4). */
export function footerCount(plan: ScratchPlan): string {
  if (plan.lines === 0) return 'Nothing to send'
  if (plan.noList) return NO_LIST
  const count = `${plural(plan.lines, 'line')} → ${plural(plan.items.length, 'task')}`
  return plan.destLabel ? `${count} in ${plan.destLabel}` : count
}

/**
 * Send every line that parses to a task, one create at a time. A created
 * line leaves the pad; a failed or token-only one stays. Offline, `create`
 * queues through the outbox and resolves — that counts as sent.
 */
export async function sendScratch(
  text: string,
  ctx: ScratchCtx,
  create: (input: CreateInput) => Promise<unknown>,
): Promise<ScratchResult> {
  const plan = planScratch(text, ctx)
  if (plan.noList) return { leftover: text, sent: 0, result: NO_LIST }

  const sentLines = new Set<ScratchItem>()
  for (const item of plan.items) {
    try {
      await create(item.input)
      sentLines.add(item)
    } catch (e) {
      console.error('menubar: scratchpad create failed', e)
    }
  }

  // Rebuild in the pad's order: every non-empty line that was not sent.
  const pending = new Map<string, number>()
  for (const item of plan.items) {
    if (!sentLines.has(item)) continue
    pending.set(item.line, (pending.get(item.line) ?? 0) + 1)
  }
  const leftover: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    const n = pending.get(line) ?? 0
    if (n > 0) pending.set(line, n - 1)
    else leftover.push(line)
  }

  const sent = sentLines.size
  const notSent = leftover.length
  let result: string
  if (notSent > 0) result = `Sent ${sent} · ${notSent} not sent, still here`
  else if (plan.destLabel) result = `Sent ${plural(sent, 'task')} to ${plan.destLabel}`
  else result = `Sent ${plural(sent, 'task')}`
  return { leftover: leftover.join('\n'), sent, result }
}
