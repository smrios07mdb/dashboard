# Build Progress

Last updated: _(update on every change)_

This file is the canonical tracker. A GitHub Project board mirrors it for visual review in Cowork.

## Status legend

- ☐ Not started
- ◐ In progress
- ☑ Shipped (PR merged, deployed, working in production)
- ⚠ Blocked

## Chunks

| # | Chunk | Repo | Status | Owner | PR / Commit | Blockers | Review notes |
|---|---|---|---|---|---|---|---|
| 1 | Scaffold + GH Pages | dashboard | ☐ | Claude Code | — | — | — |
| 2 | Supabase schema + RLS + signup trigger | dashboard | ☐ | Claude Code | — | — | — |
| 3 | Auth + protected shell | dashboard | ☐ | Claude Code | — | — | — |
| 4 | PWA shell | dashboard | ☐ | Claude Code | — | — | — |
| 5 | Data repo (Supabase + Dexie cache) | dashboard | ☐ | Claude Code | — | — | — |
| 6 | Dashboard read-only + dev sample data | dashboard | ☐ | Claude Code | — | — | — |
| 7 | Task CRUD | dashboard | ☐ | Claude Code | — | — | — |
| 8 | Subcategory management | dashboard | ☐ | Claude Code | — | — | — |
| 9 | Task reassignment + drill-down routing | dashboard | ☐ | Claude Code | — | — | — |
| 10 | Routines tab | dashboard | ☐ | Claude Code | — | — | — |
| 11 | AI triage | dashboard | ☐ | Claude Code | — | — | — |
| 12 | CalDAV proxy | dashboard-caldav-proxy | ☐ | Claude Code | — | — | — |
| 13 | Calendar integration + reconnect UX | dashboard | ☐ | Claude Code | — | — | — |
| 14 | Notifications + race-safe `notified` flag | dashboard + supabase | ☐ | Claude Code | — | — | — |
| 15 | Offline outbox replay | dashboard | ☐ | Claude Code | — | — | — |
| 16 | Insights + export/import + a11y polish | dashboard | ☐ | Claude Code | — | — | — |

## Decisions log

| Date | Decision |
|---|---|
| YYYY-MM-DD | Chose Path B (Supabase + CalDAV proxy) over native Apple app. |
| YYYY-MM-DD | App-specific iCloud password wrapped with AES-GCM (env-var key) on top of Supabase at-rest encryption. |
| YYYY-MM-DD | Seed categories via `auth.users` signup trigger (not first-insert). |
| YYYY-MM-DD | AI key remains client-side; documented security tradeoff in ARCHITECTURE §10. |
| YYYY-MM-DD | Slot proposal uses 9–18 local working hours, 15-min granularity. |
| YYYY-MM-DD | Insights groups beyond top-7 subcategories into "Other". |
| YYYY-MM-DD | Streak ignores items created on the same day. |
| YYYY-MM-DD | Outbox replay is its own chunk (15) for testability. |
| YYYY-MM-DD | Drill-down primary affordance: visible chevron; double-click on desktop only; no long-press. |
| YYYY-MM-DD | Cross-subcategory drag on Dashboard + Category view (desktop only); menu picker on mobile. |

## Open questions for Cowork review

_(none yet — add as they come up)_

## Revisions

After-the-fact changes to shipped chunks go here, with the change written as its own mini-prompt that was actually run.

_(none yet)_

## How to update this file

After every chunk:

1. Flip the status emoji.
2. Add the PR link.
3. Note any blockers.
4. Add a row to "Decisions log" if anything material was decided that wasn't already in `ARCHITECTURE.md`.
5. Update the "Last updated" date at the top.
6. Sync to the GitHub Project board.
