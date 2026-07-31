# Chunk 36 smoke — results (Cowork / Chrome MCP, 2026-07-31 ~09:40–09:50 ET)

Run against local dev (`localhost:5173`), redesign checkout, signed in as
smrios07. Fixtures: `Smoke A` TUE Jul 28 10:00–11:30 and `Smoke B` THU Jul 30
14:00–15:00 created in Apple Calendar on the synced iCloud calendar
(deleted after the run). Outlook feed not connected (see checks 2/6).

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Week navigation | PASS | prev → Jul 20–26, prev → Jul 13–19, Today → Jul 27 – Aug 2, next → Aug 3–9; header range/kicker + day numbers updated each time; Today `disabled=true` on current week (DOM-verified); now-line only on FRI 31 of the current week. |
| 2 | Busy blocks, both sources | PASS* / BLOCKED | iCloud half PASS with upstream caveat: both blocks render on the correct columns with correct durations and solid ICLOUD treatment, but at 06:00–07:30 / 10:00–11:00 — exactly the times in the proxy payload, which serves local wall-clock stamped as UTC (see "Upstream finding"). Renderer is faithful to its data. Outlook half BLOCKED: feed `unconfigured` (confirmed live in the busy response), no historical row to confirm `outlook_cached_busy` shape — per spec, not guessed. |
| 3 | Header total = Σ day figures | PASS | Current week: `8h free` = FRI-only remaining figure (clamped, matched at two sample times: 8h 15m @09:42, 8h @09:47). Next week: `45h free` = 5 × 9h. Past weeks: `0m free`. |
| 4 | Day-figure placeholders | PASS | Past weekdays `—`; SAT/SUN always `—`; today clamped remaining; future weekdays `9h free`; no blank headers on any week visited. |
| 5 | Rails: count = expandable content | PASS | Current week collapsed: `SHOW 05:00 – 08:00 · 4 HIDDEN`; expanding reveals exactly 4 blocks (Pago Tarjeta TUE 05:00–06:00, Smoke A TUE 06:00–07:30, Rent Due SAT 05:00–06:00, Cynthia S Birthday SUN 05:00–06:00). Count is 4 (spec said 3) because Smoke A lands pre-08:00 via the upstream shift — accounting is exact, which is the invariant under test. Clean week (Aug 3–9): `SHOW 07:00 – 08:00`, no HIDDEN suffix. |
| 6 | Outlook stale path | BLOCKED | Same blocker as check 2's outlook half: `outlook_cached_busy` is null/never-populated, shape unconfirmable, so no SQL stale seed. Unblock by connecting a real published ICS via Settings (chunk-35 flow) once. |
| 7 | Block popover | PASS | Smoke A popover: title, `06:00–07:30` (payload time), `ICLOUD · PERSONAL`, `Synced 1m ago`; click on empty grid closes it. |
| 8 | Mobile strip + timeline | PASS | 570px viewport. Strip MON–SUN, selected-day dark pill + today dot; FRI summary `Friday · 8h free 09–18` matches desktop figure; THU timeline shows Smoke B identical to the desktop column; bottom nav 5 items, tap targets 111×61px. |
| 9 | Mobile rails | PASS | TUE: `SHOW 05 – 08 · 2 HIDDEN` (hour-only label, per-day count; 2 not 1 because Smoke A is pre-08:00 upstream-shifted); expanding reveals exactly both blocks. |
| 10 | Console | PASS | Reload + re-exercise of checks 1 and 5 with tracking on: zero errors (Vite/React dev noise only). |

## Upstream finding — proxy serves local wall-clock as UTC (timed events)

Payload evidence (busy endpoint, week Jul 27 – Aug 2):
`Smoke A` created in Apple Calendar at **10:00–11:30 ET** arrives as
`"start":"2026-07-28T10:00:00.000Z"` — local wall-clock with a `Z` suffix.
The app then (correctly) converts 10:00Z → 06:00 ET, so every iCloud block
renders 4h early. This is the timed-event sibling of the all-day 05:00–06:00
issue already in the Decisions log; both are dashboard-caldav-proxy scope,
not this repo. Also observed: the recurring "Pago Tarjeta Sergio" shows
FRI Jul 31 10:00 in Apple Calendar but arrives as TUE Jul 28 09:00Z —
recurrence expansion in the proxy is suspect too.

## Environment notes

- Harness: `resize_window` silently no-ops while Chrome is in macOS
  full-screen (reports success; viewport unchanged). Operator un-fullscreened
  Chrome for checks 8–9.
- "ANNIE YOGA EVENT" (SAT Aug 1 8:30 in Apple Calendar) is absent from the
  busy payload — it lives on a non-synced calendar; not a finding.

## End state

Smoke A / Smoke B deleted from Apple Calendar. No settings rows touched (the
check-2/6 SQL seed was never applied). Outlook remains unconfigured.
