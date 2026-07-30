# Chunk 35 smoke spec — Outlook feed settings (for Cowork / Chrome MCP)

Target: **local dev server** on the `redesign` branch at `ef9e04f` or later —
the branch is not deployed, so do NOT test against the Pages URL. Operator
starts `npm run dev` and signs in first; the app URL is whatever Vite prints
(usually `http://localhost:5173` or `:5174`).

Surface under test: Settings → section **02 · Calendars** → the two Outlook
rows below the Apple rows ("Outlook (work)" status row, "ICS link" input row).

Harness caveats (see CLAUDE.md "Smoke harness notes"): screenshots are inline
in the Cowork transcript only — never promise file paths. No drag or mobile
emulation is needed for this spec. The Disconnect confirm is an in-app shadcn
dialog, not a native `confirm()` — safe to click.

Record results as `verification/chunk-35-smoke.md` in the chunk-33 table
format (check / PASS-FAIL / note), and commit it.

## Checks

| # | Check | Steps | Expected |
|---|-------|-------|----------|
| 1 | Bad-URL 422 path | In the ICS link input, paste `https://example.com`, click **Verify & save**. | Button flips to "Verifying…" then re-enables; error toast **"That URL isn't an iCalendar feed."** (the proxy fetches example.com, gets HTML → `invalid_feed`); status badge stays **Not connected**; nothing persisted (reload Settings → still Not connected). If the toast instead reads "The feed didn't respond — check the link." the proxy classified it `unreachable` — record which, both prove the 422→message mapping; but "That doesn't look like a valid https ICS link." for THIS input would be a FAIL (that's the `invalid_url` pre-check, which https://example.com should pass). |
| 2 | Happy path (public ICS) | Paste `https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics`, click **Verify & save**. | Toast `Connected — {feedName} · {N} events this week` (N may be 0 — holiday feeds are sparse; that's fine). Status row flips to green **Connected · {feedName}** badge + `.num` "Last refreshed …" line. Input **cleared**. |
| 3 | Write-only URL | After check 2, reload the page, return to Settings. | ICS link input is **empty** (never prefilled); the ICS URL string appears nowhere in the DOM (verify via JS: `document.body.innerHTML.includes('basic.ics') === false`). Badge still Connected (status read back from settings, not local state). |
| 4 | Realtime badge flip | Keep Settings open. Operator (or Cowork via the Supabase SQL editor / MCP, dev project `dctfspcbkqvvyptddtif`) runs: `update public.settings set outlook_status = 'unreachable' where user_id = '<uid>';` — get `<uid>` from `select user_id from public.settings;` (single-user dev DB). Do NOT reload the tab. | Within ~2s the status row flips to the **amber** warning badge "Feed unreachable since {HH:MM}" (24h clock of the stored `outlook_fetched_at`) + the `--ink-3` cached-data line "Showing busy times cached at {HH:MM}…". Amber (`warning` variant), NOT red/destructive. Then restore: `update public.settings set outlook_status = 'ok' where user_id = '<uid>';` → badge returns to green Connected, still without reload. |
| 5 | Disconnect | Click **Disconnect** under the ICS link row. | Confirm dialog "Disconnect Outlook feed?" (copy notes the published calendar in Outlook is untouched). Confirm → toast "Outlook feed disconnected."; status returns to **Not connected**; Disconnect button disappears. DB check: `outlook_status='unconfigured'`, `outlook_ics_url_encrypted is null`. |
| 6 | Console + Apple untouched | Reload once with console tracking on, re-exercise checks 1, 2 and 5 quickly, and eyeball the Apple Calendar rows. | Zero console errors. Apple rows (status badge, Apple ID, app-password, Test connection / Save) render exactly as before chunk 35 — same section, now titled "Calendars". |

## End state

Feed **disconnected** (check 5 is last-but-one; if check 6's re-exercise
reconnects, disconnect again). No other settings touched. The Apple Calendar
connection must be left exactly as found.
