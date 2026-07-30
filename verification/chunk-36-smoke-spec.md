# Chunk 36 smoke spec — Week Planner grid (for Cowork / Chrome MCP)

Target: **local dev server** on the `redesign` branch at the chunk-36-fixes
commit or later — the branch is not deployed, so do NOT test against the Pages
URL. Operator starts `npm run dev` and signs in first; the app URL is whatever
Vite prints (usually `http://localhost:5173`).

Surface under test: the **Planner** tab (desktop grid ≥640px; mobile branch
below 640px).

Harness caveats (see CLAUDE.md "Smoke harness notes"): screenshots are inline
in the Cowork transcript only — never promise file paths. The mobile checks
need a real viewport below 640px: `resize_window` works only when Chrome is
NOT in macOS full-screen; if it refuses, run checks 8–9 on-device instead. No
drag interactions in this spec (read-only grid until chunk 37).

Known data on the dev iCloud calendar (week of Jul 27 – Aug 2 2026): three
all-day items the proxy reports as 05:00–06:00 local — "Pago Tarjeta Sergio"
(TUE 28), "Rent Due" (SAT 1), "Cynthia S Birthday" (SUN 2). Checks 4–5 use
them as-is; check 2 needs extra seeded events (below).

Setup for check 2 (both-sources busy):

- **iCloud (timed):** in Apple Calendar, create two timed events in the
  visible week — `Smoke A` TUE 10:00–11:30, `Smoke B` THU 14:00–15:00
  (local). Delete them at the end.
- **Outlook (known ranges):** if a real published Outlook ICS link with at
  least one timed event this week is available, connect it via Settings
  (chunk-35 flow). Otherwise seed the cached-busy path via SQL on dev project
  `dctfspcbkqvvyptddtif`: first `select outlook_cached_busy from
  public.settings;` on a row that has held a live feed to confirm the JSON
  shape, then write one range for WED 30 09:30–10:30 local into
  `outlook_cached_busy`, set `outlook_status='unreachable'` and
  `outlook_fetched_at=now()`. (Unreachable ⇒ the proxy serves the cache — this
  doubles as the stale fixture for check 6.) If the shape can't be confirmed,
  record check 2's outlook half as BLOCKED rather than guessing.

Record results as `verification/chunk-36-smoke.md` in the chunk-33 table
format (check / PASS-FAIL / note), and commit it.

## Checks

| # | Check | Steps | Expected |
|---|-------|-------|----------|
| 1 | Week navigation | Load Planner (current week). Click prev, prev, Today, next. | Header range/kicker and day numbers update each time (Jul 20–26, Jul 13–19, back to Jul 27 – Aug 2, then Aug 3–9). "Today" button disabled on the current week. Now-line only on today's column of the current week. |
| 2 | Busy blocks, both sources | With the setup events in place, load the current week. | `Smoke A` on TUE at 10:00–11:30 and `Smoke B` on THU at 14:00–15:00 with the iCloud (solid) treatment; the outlook range on WED at 09:30–10:30 with the outlook treatment (diagonal hatch while stale). Days/times exact — blocks sit on the correct column at the correct grid offset. |
| 3 | Header total = Σ day figures | On any week with visible busy, read the seven per-day header figures and the week header's "· Nh free". | The header free-total **equals the arithmetic sum** of the per-day figures, treating `—` as 0. E.g. next week (no busy): 5 × 9h = 45h. Current week on THU afternoon: THU-remaining + FRI 9h (minus any seeded busy inside 09:00–18:00). A `45h free` on a past or current week is a FAIL (that was finding 3). |
| 4 | Day-figure placeholders | Look at day headers on prev / current / next week. | Past weekdays show `—`; SAT/SUN always show `—` (planning window is Mon–Fri); today shows remaining-time-clamped figure; future weekdays show full figures. No day header is ever blank. |
| 5 | Rails: count = expandable content | Current week, collapsed grid. | Top rail reads `SHOW 05:00 – 08:00 · 3 HIDDEN` (window stretches below 07:00 because the three 05:00 items exist). Expanding reveals exactly 3 blocks at 05:00–06:00 on TUE/SAT/SUN. Collapse again; on a week with no pre-08:00 busy the rail reads `SHOW 07:00 – 08:00` with **no** HIDDEN suffix. Any HIDDEN count that expanding does not visually account for is a FAIL (finding 2). |
| 6 | Outlook stale path | With `outlook_status='unreachable'` (check-2 SQL seed), trigger a busy refetch: navigate next week then back (the planner refetches per week; it does not react to settings realtime). | Amber `OUTLOOK FEED STALE` chip in the Planner header; outlook blocks render with the diagonal hatch; block popover shows the stale note + "Synced …" line. Restore `outlook_status` afterwards and confirm chip clears on the next refetch. |
| 7 | Block popover | Click `Smoke A`; then click empty grid. | Popover with title, `10:00–11:30`, `ICLOUD · <calendar>` line, "Synced Xm ago". Clicking empty grid closes it. |
| 8 | Mobile strip + timeline | Viewport <640px (resize or on-device), Planner tab. | Day-strip buttons MON–SUN (today highlighted), single-day timeline for the selected day showing the same blocks as that desktop column, summary line "<Day> · <free> free 09–18" where <free> matches the desktop figure for that day, 5-item bottom nav with adequate tap targets. |
| 9 | Mobile rails | On the mobile timeline for TUE 28. | Top rail `05 – 08 · 1 HIDDEN` (hour-only label, count for that day only); expanding reveals the 05:00 block. |
| 10 | Console | Reload once with console tracking on; re-exercise checks 1 and 5. | Zero console errors (warnings from Vite/React dev tooling are fine). |

## End state

Delete the `Smoke A` / `Smoke B` iCloud events. Restore
`outlook_status`/`outlook_cached_busy`/`outlook_fetched_at` to their pre-smoke
values (or disconnect the feed if one was connected just for check 2). No
other settings touched.
