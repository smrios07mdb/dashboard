# Notifications

Web Push for task reminders, with an in-app fallback while a tab is open. See
`ARCHITECTURE.md` §9 for the canonical model. This doc is the end-to-end
operator runbook: generate keys, wire env, deploy, schedule, and verify.

## How it works

```
        reminder set (chunk 9)            ┌─ Edge Function (cron, 1/min) ─┐
   tasks.remind_at = <UTC instant>        │  SELECT due candidates        │
   tasks.notified  = false                │  per-row CLAIM (UPDATE …       │
              │                           │    notified=false→true RETURNING)
              ▼                           │  push ONLY claimed rows        │
   ┌──────────────────────┐              │  410/404 → prune subscription  │
   │ remind_at < now()     │  ───────────▶└───────────────────────────────┘
   │ notified = false      │              ┌─ In-app fallback (tab open) ──┐
   │ completed_at is null  │  ───────────▶│  claim_due_reminders() RPC     │
   └──────────────────────┘              │  (same conditional UPDATE,     │
                                          │   user-scoped) → toast + Notif │
                                          └───────────────────────────────┘
```

**Exactly-once** is guaranteed entirely by the conditional `UPDATE … SET
notified = true WHERE … AND notified = false RETURNING`. Whoever flips the row
wins and notifies; the loser's update returns zero rows. This holds across:

- two Edge Function invocations racing,
- two devices both running the in-app poll,
- the Edge Function racing the in-app poll.

Neither channel ever reads-then-notifies — both push/notify strictly off the
rows their own claim returned. (`src/lib/inAppReminders.ts` →
`repo.tasks.claimDueReminders()` → the `claim_due_reminders()` RPC;
`supabase/functions/notify-due-reminders/index.ts` → per-row PostgREST claim.)

**Routines are out of scope** — only `tasks` reminders fire.

## The three pieces

| Piece | File | Role |
|---|---|---|
| Service worker | `src/sw.ts` | `push` → `showNotification`; `notificationclick` → focus/open the task URL. Also carries chunk-4 precache + Supabase `NetworkOnly` + autoUpdate (the `injectManifest` switch made these our code). |
| Subscribe flow | `src/lib/push.ts` | permission → `pushManager.subscribe` → `repo.pushSubscriptions.add`. `unsubscribe()` reverses it. |
| In-app fallback | `src/lib/inAppReminders.ts` | 60s poller; claims via RPC; OS `Notification` + toast for claimed rows. Started by `<InAppReminders/>` (in `App.tsx`) once authed. |
| Edge Function | `supabase/functions/notify-due-reminders/` | cron sweep: candidate prefilter → per-row claim → Web Push → prune dead subs. |
| Claim RPC | `supabase/migrations/06_claim_due_reminders.sql` | `security definer`, `auth.uid()`-scoped conditional UPDATE for the client half. |
| Cron | `supabase/migrations/07_notify_cron.sql` | inert template; schedule via SQL editor or the Dashboard Cron UI (operator step). |

## Setup runbook

### 1. Generate VAPID keys (once)

```sh
node scripts/gen-vapid.ts          # dependency-free (Node ≥ 22)
# or: npx web-push generate-vapid-keys --json
```

Output: `{ publicKey, privateKey, subject }` (P-256, base64url).

### 2. Wire the matched pair into FIVE places

The **public** key must be byte-identical in the client and the function, and
matched to the private key — any mismatch makes every push **401** at the push
service. Miss the GH Actions secret and the prod build inlines `undefined`, so
`urlBase64ToUint8Array(undefined)` throws and subscribe fails **in prod only**.

| Value | Destination | How |
|---|---|---|
| `publicKey` → `VITE_VAPID_PUBLIC_KEY` | `.env.local` | local dev build |
| `publicKey` → `VITE_VAPID_PUBLIC_KEY` | **GitHub Actions secret** | prod build (already referenced in `.github/workflows/deploy.yml`) |
| `publicKey` → `VAPID_PUBLIC_KEY` | Supabase secret | `supabase secrets set VAPID_PUBLIC_KEY=…` |
| `privateKey` → `VAPID_PRIVATE_KEY` | Supabase secret | `supabase secrets set VAPID_PRIVATE_KEY=…` |
| `subject` → `VAPID_SUBJECT` | Supabase secret | `mailto:you@example.com` |

```sh
# .env.local (gitignored)
echo 'VITE_VAPID_PUBLIC_KEY=<publicKey>' >> .env.local

# GitHub: repo → Settings → Secrets and variables → Actions → New secret
#   name: VITE_VAPID_PUBLIC_KEY   value: <publicKey>

# Supabase secrets (service-side):
supabase secrets set \
  VAPID_PUBLIC_KEY=<publicKey> \
  VAPID_PRIVATE_KEY=<privateKey> \
  VAPID_SUBJECT='mailto:you@example.com'
```

`VITE_*` is public (it ships in the client bundle, by design). The **private
key and subject live only as Supabase secrets** — never client-side, never
committed.

### 3. Apply the migration + deploy the function

```sh
supabase db push                                              # adds claim_due_reminders()
supabase functions deploy notify-due-reminders --no-verify-jwt
```

`--no-verify-jwt` is intended: the function is cron-invoked with the
service-role bearer and has **no caller-controlled targeting** — it only sweeps
rows already due and claims them atomically. A public trigger just runs the
idempotent sweep early. (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform; you only set the three VAPID secrets above.)

### 4. Schedule the cron (every minute)

Pick one (see `supabase/migrations/07_notify_cron.sql` for the full SQL):

- **Dashboard** → Integrations → Cron → Create job → type *Supabase Edge
  Function* → `notify-due-reminders`, schedule `* * * * *`. The UI wires the
  Authorization header.
- **SQL editor** (`pg_cron` + `pg_net`): store the service-role key in Vault,
  then `cron.schedule('notify-due-reminders', '* * * * *', $$ … net.http_post … $$)`.

## iOS gate (all three required)

1. iOS / iPadOS **16.4+**
2. PWA **installed to the Home Screen** (Share → Add to Home Screen)
3. Notification **permission granted** (Settings → Notifications → *Enable*)

Without all three, **only the in-app fallback fires, and only while a tab is
open.** This is surfaced inline in Settings → Notifications.

## Verify

1. Install the PWA on an iPhone (16.4+); open Settings → Notifications → Enable.
2. Create a task; set a reminder ~90s out.
3. Force-close the app. Wait. → push notification arrives.
4. Tap it → app opens/focuses at `/dashboard/subcategory/<id>`.
5. **Desktop**: same flow; notification lands in the OS notification center.
6. **Tab open, no install**: the in-app toast + `Notification` fires when due.
7. **Completed task**: set a reminder, complete the task → it never fires (the
   `completed_at is null` filter).
8. **Race**: two devices, same account, both subscribed, one reminder → exactly
   **one** notification total.

## Debugging

| Symptom | Check |
|---|---|
| No push at all | `supabase functions logs notify-due-reminders` — expect `claimed=N pushed=M`. `claimed=0` when due → cron not firing or `remind_at`/`notified` not as expected. |
| `claimed>0 pushed=0` | No rows in `push_subscriptions` for that user, or every send failed (check logs for status codes). |
| Every push 401 | VAPID public/private mismatch, or client `VITE_VAPID_PUBLIC_KEY` ≠ function `VAPID_PUBLIC_KEY`. Re-check step 2. |
| Subscribe fails in prod only | GH Actions secret `VITE_VAPID_PUBLIC_KEY` missing → bundle inlined `undefined`. |
| Subscription keeps failing | Expired/rotated endpoint — the function prunes it on `410`/`404`; it self-heals after one sweep. |
| In-app toast but no OS notification | Permission not granted, or the browser blocks the `Notification` constructor in that context (the toast still shows). |
| Reminder fires at the wrong time | See the timezone note below. |

Inspect state directly: `select id, title, remind_at, notified, completed_at
from tasks where remind_at is not null;` and `select * from push_subscriptions;`
(service role / SQL editor). Trigger the sweep by hand:
`curl -X POST https://<ref>.supabase.co/functions/v1/notify-due-reminders`.

## Policies (decisions worth knowing)

- **Send-failure after claim = best-effort, no un-claim.** Once a row is
  claimed (`notified=true`), a later `sendNotification` failure does **not**
  revert it — un-claiming would reintroduce the double-send race under
  concurrency. A failed send is a missed reminder, surfaced in the function's
  return (`{ claimed, pushed }`) and logs.
- **`410 Gone` / `404` → prune.** The function deletes that `push_subscriptions`
  row so a dead endpoint stops failing.
- **In-app claim is online-only + silent.** `repo.tasks.claimDueReminders()`
  returns `[]` on any failure (offline, transient 5xx) and retries next tick —
  it deliberately does not throw or flip the sync indicator the way
  user-initiated writes do, because exactly-once is preserved by the claim
  regardless of missed ticks.

## Known caveat — reminder timezone (chunk-9 origin)

`remind_at` is written by chunk 9's `SetReminderPopover`, which interprets the
picked wall-clock time in the **browser's** timezone (`new Date("YYYY-MM-DDTHH:mm")`),
not `settings.timezone`. So `remind_at` is the correct UTC instant **only when
the browser TZ matches `settings.timezone`** — the normal single-user case. A
user whose device TZ differs from their configured `settings.timezone` will see
reminders fire offset by the difference. The Edge Function's `remind_at < now()`
comparison itself is correct (UTC vs UTC); the question is purely what instant
the pick stored.

This is logged as a **chunk-9 revision candidate** (convert the pick via
date-fns-tz `fromZonedTime(value, settings.timezone)`, consistent with
`src/lib/clock.ts`), not patched inside chunk 14 — per ORCHESTRATION's
"no silent modifications." The chunk-9 popover already anticipated revisiting
this here.
