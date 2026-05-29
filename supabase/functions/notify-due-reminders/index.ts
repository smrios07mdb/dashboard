// Supabase Edge Function (Deno) — notify-due-reminders (ARCHITECTURE.md §9).
//
// Cron-invoked every minute. Sweeps reminders that are due, CLAIMS each via a
// per-row conditional UPDATE (notified false -> true, RETURNING), and Web-Push
// only the rows it actually claimed. That conditional UPDATE is the entire
// exactly-once guarantee: two concurrent invocations — or this function racing
// the in-app `claim_due_reminders()` RPC — can never both claim the same row,
// so a reminder is delivered at most once. Pushing is driven off the CLAIM
// result, never the candidate SELECT (which is only a cheap prefilter).
//
// Deploy: supabase functions deploy notify-due-reminders --no-verify-jwt
//   (--no-verify-jwt is intended: cron-invoked, no caller-controlled
//    targeting, so a public trigger just runs the idempotent sweep early —
//    chunk-14 brief, resolution 7.)
//
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   VAPID_SUBJECT. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the
//   platform. Not type-checked / tested by the app toolchain (Deno runtime).
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

// Throws at cold start if the VAPID secrets are missing — fail fast.
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

// Defensive bound so one pathological minute can't sweep unboundedly. Anything
// dropped stays notified=false and is picked up next minute (logged below).
const CANDIDATE_LIMIT = 1000

type CandidateTask = {
  id: string
  user_id: string
  title: string
  subcategory_id: string
}

type SubRow = { endpoint: string; p256dh: string; auth: string }

Deno.serve(async () => {
  // Service role bypasses RLS — this sweep is cross-user by design.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const nowIso = new Date().toISOString()

  // 1) Candidate prefilter (cheap). The per-row claim below is what's safe.
  const { data: candidates, error: selErr } = await admin
    .from('tasks')
    .select('id, user_id, title, subcategory_id')
    .lt('remind_at', nowIso)
    .eq('notified', false)
    .is('completed_at', null)
    .limit(CANDIDATE_LIMIT)

  if (selErr) {
    console.error('candidate select failed', selErr)
    return json({ error: 'select_failed' }, 500)
  }

  const candidateList = (candidates ?? []) as CandidateTask[]
  if (candidateList.length === CANDIDATE_LIMIT) {
    console.warn(
      `notify-due-reminders: candidate list hit the ${CANDIDATE_LIMIT} cap; ` +
        'remaining due reminders will be swept next minute',
    )
  }

  let claimedCount = 0
  let pushedCount = 0

  for (const candidate of candidateList) {
    // 2) Race-safe claim: only the invocation that flips false -> true gets the
    //    row back. The extra completed_at guard catches a task completed
    //    between the SELECT and here.
    const { data: claimedRows, error: claimErr } = await admin
      .from('tasks')
      .update({ notified: true })
      .eq('id', candidate.id)
      .eq('notified', false)
      .is('completed_at', null)
      .select('id, user_id, title, subcategory_id')

    if (claimErr) {
      console.error('claim failed', candidate.id, claimErr)
      continue
    }
    const claimed = (claimedRows ?? [])[0] as CandidateTask | undefined
    if (!claimed) continue // someone else won this row — exactly-once holds
    claimedCount++

    // 3) Push to each of the user's subscriptions.
    const { data: subs, error: subErr } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', claimed.user_id)
    if (subErr) {
      // Claim already taken — best-effort, do NOT un-claim (un-claiming would
      // reintroduce the double-send race). Brief, resolution 4.
      console.error('subscription fetch failed', claimed.user_id, subErr)
      continue
    }

    const payload = JSON.stringify({
      title: 'Reminder',
      body: claimed.title,
      taskId: claimed.id,
      url: `/dashboard/subcategory/${claimed.subcategory_id}`,
    })

    for (const sub of (subs ?? []) as SubRow[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        pushedCount++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // Expired / rotated subscription — prune it so it stops failing.
          await admin
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint)
        } else {
          // A failed send after a successful claim is a missed reminder,
          // surfaced here + in the return. We do NOT un-claim (resolution 4).
          console.error('push send failed', sub.endpoint, status, err)
        }
      }
    }
  }

  console.log(`notify-due-reminders: claimed=${claimedCount} pushed=${pushedCount}`)
  return json({ claimed: claimedCount, pushed: pushedCount }, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
