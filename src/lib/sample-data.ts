/*
 * Dev-only sample data loader + wipe utility.
 *
 * Goes through `repo` exclusively (no direct Supabase client) per the
 * chunk-06 implementation rules. Sample generation is seeded so that
 * a "wipe → reload" cycle produces an identical dataset; that makes
 * design / UI iteration far more pleasant.
 *
 * Idempotency: `loadSampleData()` first calls `repo.subcategories.list()`
 * and bails if any non-archived rows exist for the current user.
 *
 * Wipe scope deviation (surfaced for review): the chunk-06 prompt asks
 * the wipe to "delete from" subcategories, routine_items, and
 * routine_logs, but the data layer (chunk 5) only exposes `archive()`
 * for those tables — there are no hard-delete repo methods. Per the
 * "do not touch the data layer" rule, we use what's available:
 *
 *   - tasks                → repo.tasks.delete() (real delete; exists)
 *   - subcategories        → repo.subcategories.archive()
 *   - routine_items        → repo.routineItems.archive()
 *   - routine_logs         → left in place (they reference archived
 *                            routine_items and never surface in the UI)
 *   - push_subscriptions   → repo.pushSubscriptions.removeByEndpoint()
 *   - settings             → repo.settings.update() reset to defaults
 *
 * To make this user-visibly equivalent to a real wipe, both
 * `loadSampleData()` (its idempotency check) and the Dashboard reader
 * already filter subcategories by `!archivedAt`. Reloading after a
 * wipe yields a clean dashboard.
 */
import { toast } from 'sonner'

import { repo } from '@/db/repo'

const MORNING_LABELS = [
  'Make bed',
  'Vitamins',
  'Plan day',
  '10-min stretch',
  'Inbox sweep',
] as const

const NIGHT_LABELS = [
  'Dishes',
  'Set out clothes',
  'Plan tomorrow',
  'Lights out',
] as const

const SUBCATS_BY_CATEGORY: Record<'Work' | 'Personal', string[]> = {
  Work: ['Inbox', 'Projects', 'Admin'],
  Personal: ['Errands', 'Home', 'Health'],
}

const TASK_TITLES_BY_SUBCAT: Record<string, string[]> = {
  Inbox: [
    'Reply to Q2 planning thread',
    'Triage support escalations',
    'Review Linear backlog grooming notes',
  ],
  Projects: [
    'Draft auth migration spec',
    'Wire chunk 6 dashboard read path',
    'Pair on Edge Function alarm',
  ],
  Admin: ['Submit expense report', 'Update working hours in HRIS'],
  Errands: ['Grocery run', 'Drop off dry cleaning'],
  Home: ['Schedule HVAC service', 'Replace bathroom bulb', 'Water plants'],
  Health: ['Book dentist appointment', 'Refill prescription'],
}

const ESTIMATE_BUCKETS = [15, 20, 30, 45, 60, 90] as const

// Tiny seeded PRNG (mulberry32) — reproducible across reloads.
function mulberry32(seed: number) {
  let t = seed >>> 0
  return function rand() {
    t = (t + 0x6d2b79f5) >>> 0
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

function dateKeyForDaysAgo(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return d.toISOString().slice(0, 10)
}

/**
 * Caller passes userId — we deliberately do not import the Supabase
 * client here (chunk-06 rule #2). The Settings screen reads the
 * session via `useSession()` and hands the id down.
 */
export async function loadSampleData(userId: string): Promise<void> {

  // Idempotency: bail if any live (non-archived) subcategory exists.
  const liveSubs = (await repo.subcategories.list()).filter(
    (s) => !s.archivedAt,
  )
  if (liveSubs.length > 0) {
    toast.info('Sample data already loaded — wipe first to reload.')
    return
  }

  const categories = await repo.categories.list()
  const workCat = categories.find((c) => c.name === 'Work')
  const personalCat = categories.find((c) => c.name === 'Personal')
  if (!workCat || !personalCat) {
    toast.error(
      'Missing Work / Personal categories — sign out and back in so the signup trigger seeds them.',
    )
    return
  }

  const rand = mulberry32(0xc0ffee)

  // ----- subcategories -----
  const createdSubs: { id: string; name: string; categoryName: string }[] = []
  for (const cat of [workCat, personalCat]) {
    const names = SUBCATS_BY_CATEGORY[cat.name]
    for (let i = 0; i < names.length; i += 1) {
      const sub = await repo.subcategories.create({
        userId,
        categoryId: cat.id,
        name: names[i],
        sortOrder: i,
      })
      createdSubs.push({
        id: sub.id,
        name: sub.name,
        categoryName: cat.name,
      })
    }
  }

  // ----- tasks -----
  // 12 tasks distributed across the 6 subcategories (~2 each, with
  // natural variation). 1/3 with due_at in next 7d. Exactly 2 with
  // completed_at in the last 2 days.
  const taskPlan: {
    subcatName: string
    title: string
    estimate: number
    withDue: boolean
    completedDaysAgo: number | null
  }[] = []
  for (const sub of createdSubs) {
    const titles = TASK_TITLES_BY_SUBCAT[sub.name] ?? [`Task for ${sub.name}`]
    for (const title of titles) {
      taskPlan.push({
        subcatName: sub.name,
        title,
        estimate: pick(rand, ESTIMATE_BUCKETS),
        withDue: false,
        completedDaysAgo: null,
      })
    }
  }
  // Cap at 12 (the title bank totals 14 — drop the tail deterministically).
  const tasks = taskPlan.slice(0, 12)

  // Assign due_at to ~1/3 of them (every 3rd row).
  for (let i = 0; i < tasks.length; i += 1) {
    if (i % 3 === 0) tasks[i].withDue = true
  }
  // Mark exactly 2 completed within last 2 days.
  tasks[2].completedDaysAgo = 1
  tasks[7].completedDaysAgo = 2

  let taskCount = 0
  for (const t of tasks) {
    const sub = createdSubs.find((s) => s.name === t.subcatName)
    if (!sub) continue
    const dueAt = t.withDue
      ? new Date(
          Date.now() + Math.floor(rand() * 7 + 1) * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null
    const completedAt =
      t.completedDaysAgo === null
        ? null
        : new Date(
            Date.now() - t.completedDaysAgo * 24 * 60 * 60 * 1000,
          ).toISOString()
    await repo.tasks.create({
      userId,
      subcategoryId: sub.id,
      title: t.title,
      notes: null,
      estimateMinutes: t.estimate,
      dueAt,
      remindAt: null,
      priority: null,
      completedAt,
    })
    taskCount += 1
  }

  // ----- routine items -----
  const createdItems: {
    id: string
    createdAt: string
    daysExisting: number
  }[] = []
  for (let i = 0; i < MORNING_LABELS.length; i += 1) {
    const item = await repo.routineItems.create({
      userId,
      routine: 'morning',
      label: MORNING_LABELS[i],
      sortOrder: i,
    })
    createdItems.push({
      id: item.id,
      createdAt: item.createdAt,
      daysExisting: 21,
    })
  }
  for (let i = 0; i < NIGHT_LABELS.length; i += 1) {
    const item = await repo.routineItems.create({
      userId,
      routine: 'night',
      label: NIGHT_LABELS[i],
      sortOrder: i,
    })
    createdItems.push({
      id: item.id,
      createdAt: item.createdAt,
      daysExisting: 21,
    })
  }

  // ----- routine logs (past 21 days inclusive of today) -----
  // ~85% complete. Sprinkle in skipped days (no log for any item) and
  // skipped items (no log for that specific item on that day).
  let logsCount = 0
  for (let offset = 20; offset >= 0; offset -= 1) {
    const dateKey = dateKeyForDaysAgo(offset)
    const skipWholeDay = rand() < 0.05 // ~1 in 20 days
    if (skipWholeDay) continue
    for (const item of createdItems) {
      const skipThisItem = rand() < 0.1 // ~1 in 10 items
      if (skipThisItem) continue
      const completed = rand() < 0.92
      await repo.routineLogs.toggle({
        userId,
        routineItemId: item.id,
        dateKey,
        completed,
      })
      logsCount += 1
    }
  }

  toast.success(
    `Sample data loaded (${taskCount} tasks, ${createdItems.length} routine items, ${logsCount} logs)`,
  )
}

export async function wipeMyData(userId: string): Promise<void> {
  // tasks (real delete — repo supports it; ON DELETE RESTRICT from
  // subcategories means we MUST take these out before archiving subs).
  const tasks = await repo.tasks.list()
  for (const t of tasks) {
    await repo.tasks.delete(t.id)
  }

  // subcategories — archive (see file header for why this isn't hard
  // delete in chunk 6).
  const subs = await repo.subcategories.list()
  for (const s of subs) {
    if (!s.archivedAt) await repo.subcategories.archive(s.id)
  }

  // routine_items — archive.
  const items = await repo.routineItems.list()
  for (const i of items) {
    if (!i.archivedAt) await repo.routineItems.archive(i.id)
  }

  // push_subscriptions — remove via the only repo affordance we have.
  const subs2 = await repo.pushSubscriptions.listMine(userId)
  for (const s of subs2) {
    await repo.pushSubscriptions.removeByEndpoint(s.endpoint)
  }

  // settings — reset to defaults (timezone preserved; see decision 4).
  await repo.settings.update(userId, {
    aiApiKey: null,
    caldavAppleId: null,
    caldavCalendarUrl: null,
    caldavStatus: 'unconfigured',
    lastDailyReset: null,
  })

  toast.success('Wiped.')
}
