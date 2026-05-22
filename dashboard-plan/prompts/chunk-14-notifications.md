# Chunk 14 — Notifications + race-safe `notified` flag

**Goal:** Web Push for due reminders; in-app fallback while tabs open. Race-safe exactly-once delivery.
**Dependencies:** Chunks 4 (PWA), 5, 9.
**Effort:** ~5h.

> Reference `ARCHITECTURE.md` §9.

## What to build

### VAPID keys

Generate once at project setup. If not already generated, run `npx web-push generate-vapid-keys --json > vapid.json`. The key file is gitignored. Store:
- `vapid.publicKey` → `VITE_VAPID_PUBLIC_KEY` in `dashboard/.env.local` and GH Actions secret
- `vapid.privateKey` → Supabase project secret `VAPID_PRIVATE_KEY`
- `vapid.subject` → `mailto:<your-email>` → Supabase project secret `VAPID_SUBJECT`

Add a one-liner script `scripts/gen-vapid.ts` that generates and prints keys (for reference).

### Service worker push handler

In the vite-plugin-pwa config (chunk 4), add custom service worker code to handle:

**`push` event:**
```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const { title, body, taskId, url } = data;
  event.waitUntil(self.registration.showNotification(title, { body, data: { taskId, url }, icon: '/dashboard/icons/icon-192.png' }));
});
```

**`notificationclick` event:**
```js
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/dashboard/';
  event.waitUntil(clients.openWindow(url));
});
```

This requires switching vite-plugin-pwa to `strategies: 'injectManifest'` with a custom `src/sw.ts` if not already.

### Subscribe flow

`src/lib/push.ts`:
- `getPermission(): NotificationPermission`
- `requestPermissionAndSubscribe(): Promise<void>` —
  1. `Notification.requestPermission()`
  2. If granted: `navigator.serviceWorker.ready.then(reg => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VITE_VAPID_PUBLIC_KEY) }))`
  3. Send subscription to repo: `repo.pushSubscriptions.add({ endpoint, p256dh, auth })`
- `unsubscribe(): Promise<void>` — unsubscribe and delete from Supabase

### Settings — Notifications section

In `src/screens/Settings.tsx`, add a Notifications section:
- Status indicator: 'Disabled' / 'Enabled' / 'Permission denied (re-enable in browser settings)'
- "Enable notifications" button → calls `requestPermissionAndSubscribe`
- "Disable notifications" button (when enabled)
- On iOS, show note: "Web Push on iOS requires the app to be installed to the Home Screen (iOS 16.4+)."

### Edge Function

`supabase/functions/notify-due-reminders/index.ts`:
- Deno runtime
- Imports: `npm:web-push`, `@supabase/supabase-js`
- Reads env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- On each invocation:
  1. Use service role client to find candidate tasks: `select id, user_id, title, remind_at from tasks where remind_at < now() and notified = false and completed_at is null`
  2. For each, run conditional UPDATE: `update tasks set notified = true where id = $1 and notified = false returning id, user_id, title` — this is the race-safe claim
  3. For each successfully claimed task: fetch the user's `push_subscriptions`, send `webPush.sendNotification` to each with payload `{ title: 'Reminder', body: task.title, taskId: task.id, url: '/dashboard/subcategory/...' }`
  4. On `410 Gone` from push provider: delete that subscription
- Returns `{ claimed: N, pushed: M }`

`supabase/functions/notify-due-reminders/deno.json` — config.

### Cron

Add a cron entry in Supabase (Database → Cron) running the Edge Function every minute:
```sql
select cron.schedule(
  'notify-due-reminders',
  '* * * * *',
  $$ select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/notify-due-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))
  ) $$
);
```

Add a migration `supabase/migrations/05_cron.sql` documenting this (or as a manual step in the supabase README — pick whichever works for your hosted Supabase plan).

### In-app fallback

`src/lib/inAppReminders.ts`:
- On app mount, start an interval (60 seconds)
- Each tick: query Supabase directly with the same conditional UPDATE pattern as the Edge Function:
  ```sql
  update tasks set notified = true where remind_at < now() and notified = false and completed_at is null and user_id = auth.uid() returning id, title
  ```
  (achievable via repo with an `rpc` call to a Postgres function `claim_due_reminders()` — add as a Supabase migration)
- For each claimed row: show in-app `Notification` API (since we have permission already) and also a toast
- The conditional UPDATE makes server-side and client-side mutually exclusive — exactly-once

### Postgres function for client-side claim

`supabase/migrations/05_claim_due_reminders.sql`:
```sql
create or replace function public.claim_due_reminders()
returns table(id uuid, title text)
language plpgsql security definer
as $$
begin
  return query
    update tasks set notified = true
    where user_id = auth.uid()
      and remind_at < now()
      and notified = false
      and completed_at is null
    returning tasks.id, tasks.title;
end
$$;
grant execute on function public.claim_due_reminders() to authenticated;
```

### Docs

`docs/notifications.md`:
- How notifications work end-to-end
- iOS requirements: 16.4+, PWA installed, Notification permission
- Without all three: only in-app fallback fires, and only while a tab is open
- How to debug: check `push_subscriptions` in Supabase, hit the Edge Function manually, check service worker logs

## Files to create/modify

```
src/sw.ts                          (new — custom service worker)
vite.config.ts                     (modify — switch to injectManifest if needed)
src/lib/push.ts                    (new)
src/lib/inAppReminders.ts          (new)
src/screens/Settings.tsx           (modify — Notifications section)
src/App.tsx                        (modify — start inAppReminders interval after auth)
supabase/migrations/05_claim_due_reminders.sql  (new)
supabase/functions/notify-due-reminders/index.ts (new)
supabase/functions/notify-due-reminders/deno.json (new)
scripts/gen-vapid.ts               (new)
docs/notifications.md              (new)
```

## Acceptance criteria

- On iOS 16.4+ installed PWA: enable notifications → set a reminder 90 seconds out → close the app entirely → notification arrives
- On desktop browser: same flow works; notification appears in OS notification center
- On a browser tab that's open with no PWA install: in-app notification appears when reminder fires
- Setting a reminder for a task that's already completed never fires (the SQL filter excludes completed_at)
- Two devices both online, same account: only ONE notification fires (race-safe conditional UPDATE)
- The Edge Function logs `claimed > 0` when it processes due reminders
- `notificationclick` opens or focuses the app at the task's URL

## Do NOT

- Try to send notifications for routines (out of scope v1)
- Make the Edge Function do anything other than reminder pushes
- Bypass the conditional UPDATE — duplicate notifications are an immediate fail

## How to test

1. Generate VAPID keys, set env vars in main repo and Supabase secrets
2. Deploy the Edge Function: `supabase functions deploy notify-due-reminders --no-verify-jwt`
3. Set up the cron schedule
4. Install PWA on iPhone (iOS 16.4+)
5. Enable notifications in Settings
6. Create a task; set reminder for 2 minutes from now
7. Force-close the app
8. Wait — notification arrives
9. Tap notification → opens app at the right task
10. Test the race: open two devices, both subscribed, fire one reminder → only one notification arrives in total
