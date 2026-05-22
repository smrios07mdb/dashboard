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
