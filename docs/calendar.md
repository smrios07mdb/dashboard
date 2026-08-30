# Apple Calendar integration

How the dashboard reads your iCloud busy times and books "Block time" events.
Canonical design: [`ARCHITECTURE.md` §7 (CalDAV)](../ARCHITECTURE.md) and §8
(slot proposal).

## How it works

iCloud calendars speak **CalDAV**, which needs HTTP Basic auth with an
app-specific password. A browser can't do that reliably (CORS + credential
handling), so all calendar calls go through a small serverless **proxy** (the
`dashboard-caldav-proxy` repo, deployed on Vercel). The proxy:

- verifies your Supabase session token on every request,
- stores your app-specific password **encrypted** (AES-GCM) and never returns it,
- brokers the actual CalDAV calls to `caldav.icloud.com`.

The app talks to the proxy through `src/lib/calendarApi.ts`. The proxy URL is
configured via `VITE_CALDAV_PROXY_URL` (set in `.env.local` for local dev and as
a GitHub Actions secret for the production build) — there is no hardcoded
fallback.

```
Browser ──HTTPS+JWT──▶ proxy ──Basic auth──▶ caldav.icloud.com
  (app password only ever travels as an HTTPS request body; it is never
   persisted anywhere on the client — not even in the Settings type.)
```

`caldav_status` (`unconfigured` | `ok` | `auth_failed`) lives in your `settings`
row and is **owned by the server**. The proxy writes it; the client only reads
it back. The app never sets it optimistically, so the two can't drift.

## Connecting (Settings → Apple Calendar)

1. Generate an app-specific password (see below).
2. Enter your **Apple ID** (your iCloud email) and the **app-specific password**.
3. Click **Test connection**. The proxy runs CalDAV discovery and returns your
   calendars. Pick one.
4. Click **Save**. The proxy encrypts the password, stores it with the chosen
   calendar, and sets `caldav_status = 'ok'`. The status badge flips to
   **Connected**.

Once connected:

- The **Dashboard busy strip** shows today's busy ranges (e.g. `Busy: 9–11,
  14–15`), refreshed on load, on window focus, and every 5 minutes. Results are
  cached locally for 5 minutes so we don't hammer iCloud.
- **Block time** on any task's `⋯` menu proposes up to three free slots
  (working hours 09:00–18:00 in your timezone, 15-minute granularity, next 24
  hours) and creates the event on your Apple Calendar.

## Generating an app-specific password

Apple requires an app-specific password (your normal iCloud password won't work
over CalDAV):

1. Go to [appleid.apple.com](https://appleid.apple.com) and sign in.
2. **Sign-In and Security → App-Specific Passwords**.
3. Click **+** (or "Generate password…"), give it a label like "Dashboard",
   and copy the generated `xxxx-xxxx-xxxx-xxxx` value.
4. Paste it into the App-specific password field in Settings.

> Requires two-factor authentication on your Apple ID (it's required to create
> app-specific passwords at all).

## When the password expires or is revoked

App-specific passwords can be revoked at appleid.apple.com (or invalidated when
you change your main Apple ID password). When that happens:

1. The next busy-strip or block-time call returns `auth_failed`, and the proxy
   sets `caldav_status = 'auth_failed'` for you server-side.
2. The Dashboard busy strip is replaced by a **"Apple Calendar disconnected"**
   reconnect banner linking to Settings; the Block-time sheet shows the same
   reconnect notice instead of slots.
3. In **Settings → Apple Calendar**, the badge reads **Reconnect needed**.

To recover:

1. Generate a **new** app-specific password (above).
2. Re-enter your Apple ID + the new password and click **Test connection**, then
   **Save**.
3. `caldav_status` returns to `ok`. The busy strip comes back on its next
   refresh (within ~5 minutes, or immediately if you reload).

## Disconnecting

**Disconnect** in Settings clears your Apple ID, selected calendar, and resets
`caldav_status` to `unconfigured` (the busy strip then renders nothing — no
nagging). You can reconnect anytime by testing and saving again.

## What "Block time" writes to your calendar

Creating an event from the **Block time** sheet writes a `VEVENT` to your
selected iCloud calendar via the proxy. The fields written are:

- **Title** — always: the task's title (used as the event title).
- **Start / end** — always: the slot you picked.
- **Description** — only if you tick **"Include notes in calendar event"** (off
  by default). When on, the task's notes become the event description.

Because the event lands in iCloud, it syncs to every device signed into that
Apple ID and to anyone you share that calendar with. That's why notes are
**opt-in**: title-only is the default so free-text notes don't leave the device
unless you choose to include them. (The "What's next?" AI triage likewise never
sends notes — see `docs/security.md`.)

## Planner blocks on your calendar (opt-in)

Settings → Calendars → **Write planner blocks to Apple Calendar** mirrors every
block you schedule on the Week Planner to the selected iCloud calendar (title
= the task's title, description `Planned in Hupomnemata`). Moving, resizing
or carrying a block updates the event; unscheduling deletes it. The planner is
the source of truth — if the calendar write fails you see
`Saved — Apple Calendar not updated` and the block stays; the next time you
open that week the planner repairs the mirror (creates missing events, deletes
events whose block is gone, fixes moved times).

Mirrored events don't count as busy on the planner — the proxy tags them and
keeps them out of busy time so a block is never counted twice. Edits you make
in Calendar.app do **not** flow back. Turning the toggle off (or disconnecting)
leaves the events already on your calendar in place.

## Privacy

- The app-specific password is sent to the proxy only over HTTPS and stored
  encrypted at rest; it is never returned to or persisted by the browser.
- Busy ranges are cached in your browser's IndexedDB (per-device) for 5 minutes;
  clearing site data removes them.
