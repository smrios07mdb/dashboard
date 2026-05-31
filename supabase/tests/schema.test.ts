import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error(
    'Missing env vars. Copy supabase/.env.test.example to supabase/.env.test and fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY.',
  )
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type TestUser = { id: string; email: string; password: string }

const stamp = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

async function createTestUser(): Promise<TestUser> {
  const email = `schema-test-${stamp()}@example.test`
  const password = `Pw-${stamp()}-Aa1!`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) {
    throw error ?? new Error('createUser returned no user')
  }
  return { id: data.user.id, email, password }
}

async function deleteTestUser(id: string): Promise<void> {
  await admin.auth.admin.deleteUser(id).catch(() => {
    // best-effort cleanup
  })
}

/** A fresh anon client signed in as `user` — i.e. a real user JWT, NOT the
 * RLS-bypassing service role. This is what a browser client holds, so it is
 * the only correct way to prove RLS write isolation. */
async function signInAs(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) throw error
  return client
}

describe('schema + signup trigger', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser()
    userB = await createTestUser()
  })

  afterAll(async () => {
    if (userA) await deleteTestUser(userA.id)
    if (userB) await deleteTestUser(userB.id)
  })

  it('seeds two categories (Work + Personal) for each new user', async () => {
    const { data, error } = await admin
      .from('categories')
      .select('name')
      .eq('user_id', userA.id)
      .order('name')

    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(data?.map((row) => row.name)).toEqual(['Personal', 'Work'])
  })

  it('seeds exactly one settings row with sane defaults', async () => {
    const { data, error } = await admin
      .from('settings')
      .select('user_id, caldav_status, timezone')
      .eq('user_id', userA.id)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0].caldav_status).toBe('unconfigured')
    expect(data?.[0].timezone).toBe('America/New_York')
  })

  it("RLS hides user A's categories from user B", async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: signInErr } = await anon.auth.signInWithPassword({
      email: userB.email,
      password: userB.password,
    })
    expect(signInErr).toBeNull()

    const { data, error } = await anon
      .from('categories')
      .select('id')
      .eq('user_id', userA.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("RLS hides user A's settings from user B", async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    await anon.auth.signInWithPassword({
      email: userB.email,
      password: userB.password,
    })

    const { data, error } = await anon
      .from('settings')
      .select('user_id')
      .eq('user_id', userA.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('unauthenticated queries return zero rows (RLS catches missing JWT)', async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // No sign-in; client has the anon key but no user JWT.

    const { data, error } = await anon
      .from('categories')
      .select('id')
      .eq('user_id', userA.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

/*
 * RLS WRITE isolation (AUTH-03). The existing suite proves a client cannot
 * READ another user's rows; these prove a client cannot WRITE one — i.e. the
 * `WITH CHECK (auth.uid() = user_id)` clause on every insert/update policy
 * (migration 03_rls.sql) actually holds. That clause is the single control
 * standing between this app and a multi-user breach, and the import/outbox
 * paths deliberately forward a client-controllable `user_id` into it.
 *
 * These run as user A (a real user JWT). The assertion is intentionally
 * tolerant — a `WITH CHECK` violation surfaces as a PostgREST error (42501,
 * "new row violates row-level security policy"), while a cross-user UPDATE may
 * instead become a no-op when the `USING` clause stops matching — so we accept
 * "errored OR zero rows affected" and additionally confirm via the service
 * role that nothing actually leaked under user B.
 */
describe('RLS write isolation (AUTH-03)', () => {
  let userA: TestUser
  let userB: TestUser
  let clientA: SupabaseClient
  let workCatA: string
  let subA: string

  beforeAll(async () => {
    userA = await createTestUser()
    userB = await createTestUser()
    clientA = await signInAs(userA)

    // The signup trigger seeds categories (Work/Personal) + settings only — no
    // subcategories — and tasks.subcategory_id is NOT NULL. So to even attempt
    // a tasks insert, A must first own a subcategory. Fetch A's Work category
    // (RLS lets A see its own) and create a subcategory under it.
    const { data: cats, error: catErr } = await clientA
      .from('categories')
      .select('id, name')
      .eq('user_id', userA.id)
    if (catErr) throw catErr
    const work = cats?.find((c) => c.name === 'Work')
    if (!work) throw new Error('seeded Work category not found for user A')
    workCatA = work.id

    const { data: sub, error: subErr } = await clientA
      .from('subcategories')
      .insert({ user_id: userA.id, category_id: workCatA, name: 'rls-write-test' })
      .select('id')
      .single()
    if (subErr || !sub) throw subErr ?? new Error('subcategory insert returned no row')
    subA = sub.id
  })

  afterAll(async () => {
    if (userA) await deleteTestUser(userA.id)
    if (userB) await deleteTestUser(userB.id)
  })

  it('rejects INSERT into tasks with a forged (other-user) user_id', async () => {
    // FK is satisfied (subA is a real subcategory); the ONLY thing that can
    // reject this is the tasks_insert_own WITH CHECK, since auth.uid() = A ≠ B.
    const { data, error } = await clientA
      .from('tasks')
      .insert({ user_id: userB.id, subcategory_id: subA, title: 'forged' })
      .select()

    expect(error !== null || (data ?? []).length === 0).toBe(true)

    // Nothing was actually written under B.
    const { data: leaked } = await admin
      .from('tasks')
      .select('id')
      .eq('user_id', userB.id)
    expect(leaked ?? []).toEqual([])
  })

  it('rejects UPDATE that reassigns an owned task to another user_id', async () => {
    const { data: own, error: insErr } = await clientA
      .from('tasks')
      .insert({ user_id: userA.id, subcategory_id: subA, title: 'mine' })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    if (!own) throw new Error('task insert returned no row')
    const taskId = own.id

    // USING lets A target its own row; WITH CHECK must reject the new B user_id.
    const { data, error } = await clientA
      .from('tasks')
      .update({ user_id: userB.id })
      .eq('id', taskId)
      .select()

    expect(error !== null || (data ?? []).length === 0).toBe(true)

    // The row must still belong to A.
    const { data: row } = await admin
      .from('tasks')
      .select('user_id')
      .eq('id', taskId)
      .single()
    expect(row?.user_id).toBe(userA.id)
  })

  it('rejects INSERT into subcategories with a forged user_id (policy generalizes)', async () => {
    const { data, error } = await clientA
      .from('subcategories')
      .insert({ user_id: userB.id, category_id: workCatA, name: 'forged-sub' })
      .select()

    expect(error !== null || (data ?? []).length === 0).toBe(true)

    const { data: leaked } = await admin
      .from('subcategories')
      .select('id')
      .eq('user_id', userB.id)
    expect(leaked ?? []).toEqual([])
  })
})
