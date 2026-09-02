# Chunk 51 brief — Multi-calendar iCloud read ("the calendar is empty")

**Date:** 2026-09-02 · **Author:** Claude (orchestrator) · **Status:** decisions locked, prompt authored
**App:** `smrios07mdb/dashboard` `main` @ `6de87ab` (gh-pages `version.json` = `ba10f74`)
**Proxy:** `smrios07mdb/dashboard-caldav-proxy` `main` @ `1fb9200`

Chunk 51 was reserved for the Notebook tab. Per **D4** the Notebook slides to chunk 52; this chunk takes 51.

---

## 1. Diagnosis

The Planner and Dashboard busy strip are not broken. They read exactly one Apple calendar — the one chosen in the Settings dropdown at connect time (chunk 13) — and that calendar is nearly empty.

**Source evidence (read at the SHAs above):**

- `api/_lib/caldav.ts` `getBusy(calendarUrl, appleId, password, from, to)` — one `fetchCalendarObjects` against one URL.
- `api/calendar/busy.ts` builds `icloudCreds.calendarUrl` from `settings.caldav_calendar_url` and calls `getBusy` once.
- `supabase/migrations/01_tables.sql:60` — `caldav_calendar_url text` is a single value.
- `src/screens/Settings.tsx:764–782` — a `<select>` picks one of the calendars `discover()` returns.
- The same `caldav_calendar_url` is the **write target** for chunk-39 planner mirrors (`api/calendar/events.ts`).

**Live evidence (2026-09-02, signed-in page-context fetch from `localhost:5173`, JWT never left the browser):**

```
GET /api/calendar/busy?from=2026-08-31T04:00:00Z&to=2026-09-07T04:00:00Z → 200
busy: 1 interval — "Rent Due" 2026-09-01T14:00:00.000Z
sources.icloud: { configured: true, ok: true }
sources.outlook: { configured: false, status: 'unconfigured' }
plannerEvents: 0
```

Prior runs already recorded the same shape: chunk-42 spot run (week 36: only `Rent Due`), chunk-36 smoke ("ANNIE YOGA EVENT … lives on a non-synced calendar; not a finding").

## 2. What is already built (do not rebuild)

| Direction | State |
|---|---|
| App → Apple Calendar | Done — chunk 39 mirror (`hupo-block-*` uids, `planner_writeout` opt-in). |
| Apple Calendar → app | **One calendar only.** This chunk widens it to N calendars. |
| Outlook → app | Built (chunks 34/35), never connected. Unblock is operator-only: Outlook → Settings → Shared calendars → Publish → copy ICS link → paste into app Settings → Outlook. No code. |
| Outlook → Apple Calendar | Not the app's job. Apple Calendar can subscribe to the same published ICS URL (Calendar.app → File → New Calendar Subscription). Delegable to Cowork via computer use. |
| App → Outlook | **Out of scope (D5).** Published ICS is read-only; Graph OAuth is a locked no. Only path is an app-published ICS feed — backlog. |

## 3. Locked decisions

| Code | Decision |
|---|---|
| **D1** | Read **all** VEVENT calendars on the iCloud account, with per-calendar on/off toggles. Default: all on. The toggles live **on the Planner (calendar view)**, not in Settings — a "Calendars" popover in the Planner header. The connect flow (Apple ID + app password + write-target dropdown) stays in Settings. |
| **D2** | Read set and write target are separate. `settings.caldav_calendar_url` stays the single write target (unchanged; chunk 39/50 mirror code untouched). New column `settings.caldav_read_calendars jsonb` holds `[{ url, name, enabled }]`. |
| **D3** | Proxy `getBusy` fans out across enabled calendars in parallel (`Promise.allSettled`). One failing calendar does not fail the response. Every iCloud interval gains a `calendar` (display name) field so the popover reads `ICLOUD · <name>`. |
| **D4** | This is chunk 51. Notebook → chunk 52. The Notebook docs-prep prompt (docs-only) is unaffected except its chunk number references. |
| **D5** | No app → Outlook write. Backlog. |

**Behavior when `caldav_read_calendars` is `null`** (every existing user, and after any re-save of credentials): the proxy falls back to the legacy single-calendar read (write target only) so nothing changes server-side until the app initializes the read set. The app initializes it to **all discovered calendars, all enabled** on first Planner mount with `caldav_status === 'ok'` (D1 "default all on"). After that, `null` never recurs except via Settings re-save or disconnect.

**Write target vs read set:** the proxy always fetches the write-target calendar (it is where `plannerEvents` live and the reconcile depends on them) but only contributes its *busy* intervals when it is enabled in the read set.

## 4. Scope boundaries

In: migration 13, proxy fan-out + new `GET /api/calendar/calendars` endpoint, app types/mappers/repo, Planner "Calendars" popover, popover/label change, tests, docs (ARCH §7 table + settings columns, proxy README, PROGRESS, decisions log, Notebook renumber).

Out: any change to `api/calendar/events.ts`, `plannerCalendarMirror.ts`, the reconcile, `busyExpand.ts`, the Outlook ICS path, `lib/insights.ts`, the chunk-13 Block Time sheet's semantics, timezone/all-day handling in the proxy (separate known issue), the Notebook design pass.

## 5. Sequencing

1. Claude Code runs `prompts/chunk-51-multi-calendar-read.md` (proxy first, then app; two repos, two SHAs reported).
2. Operator: `vercel --prod` in the proxy repo (Hobby tier, manual). Confirm new build via OPTIONS preflight **and** `GET /api/calendar/calendars` returning 200 (new endpoint = new build). Device-OAuth re-login may be required — the one unavoidable manual step.
3. Claude authors the Cowork smoke spec against the reported SHAs (checks: picker lists all calendars, toggling off a calendar removes its blocks after the `busyRefreshKey` bump, popover shows the calendar name, disabled write-target still yields `plannerEvents`, null-set auto-init writes the row once, Dashboard busy strip reflects the union).
4. Cowork smoke run → Claude independent verification at exact SHAs (tarball, `npm ci`, `tsc`, tests, lint, build; proven-red on new tests; bundle grep on gh-pages) → chunk closes.
5. Separately, operator connects the Outlook published ICS (Settings → Outlook). Zero code; can happen any time.

## 6. Risks / watch items

- **iCloud rate/latency:** N parallel `fetchCalendarObjects` per week load. Sergio's account likely has ≤ 10 event calendars; acceptable. The prompt caps fan-out concurrency at 6 and keeps the existing per-week client cache, so a week load is still one `/busy`.
- **Subscribed/holiday calendars** (e.g. "US Holidays", birthdays) will now appear as busy by default. That is what "all on" means; the toggle is the remedy. Flagging so it isn't reported as a bug.
- **Mirror double-count:** `PLANNER_UID_RE` exclusion must run on every fetched calendar, not just the write target, so a mirror never becomes busy even if the write target changes later.
- **Realtime:** `settings` row updates already flow through the existing settings realtime path (chunk 35 precedent for `outlook_*` columns); the read set piggybacks. No new channel.
