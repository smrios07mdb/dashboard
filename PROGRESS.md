# Build Progress

Last updated: 2026-05-23

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
| 2 | Supabase schema + RLS + signup trigger | dashboard | ☑ | Claude Code | 50296c0 | — | Added SUPABASE_ANON_KEY to .env.test for RLS tests (service-role bypasses RLS). Separate supabase/tests/vitest.config.ts to isolate from app's jsdom config. Fixed bad redirect URL example in chunk-02 prompt during commit. |
| 3 | Auth + protected shell | dashboard | ☑ | Claude Code | fd6c419 | — | Scope expanded to include design-system port (CSS tokens, fonts, .label utility, AppShell) — Login requires it. Localhost magic-link roundtrip verified end-to-end. Prod URL renders correctly; prod magic-link redirect URL verified statically via email content (window.location.origin used correctly). Prod click-through not tested live due to Supabase default-sender email rate limit. |
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
| 2026-05-23 | Migration files use numeric prefixes (00_, 01_, …) not Supabase CLI's default timestamps. Future migrations hand-named to match — documented in supabase/README.md. |
| 2026-05-23 | RLS schema tests run against an anon-key Supabase client (not service-role) because service-role bypasses RLS. Anon key lives in supabase/.env.test alongside URL + service-role; safe because the anon key is already public. |
| 2026-05-23 | Design tokens map to shadcn's HSL slots where concepts overlap (--bg→--background, --ink→--foreground, --ink-3→--muted-foreground, --line→--border) with Obsidian palette values. Design-only tokens (--work, --personal, --accent, --jewel-*, --surface-2, --ink-4, --accent-soft) added as net-new variables. --accent defaults to "ice". |
| 2026-05-23 | --border uses solid HSL approximation (225 8% 10%) of design's rgba(255,255,255,.055) because shadcn's HSL slot can't carry alpha cleanly for Tailwind opacity variants. Visually indistinguishable on Obsidian background; differs only if borders ever stack on non-bg surfaces. |
| 2026-05-23 | Routing uses BrowserRouter with basename={import.meta.env.BASE_URL}. createBrowserRouter is also v7-idiomatic but adds loader/action infra not needed for two routes. Documented in docs/auth.md, reversible later. |
| 2026-05-23 | Fonts bundled via @fontsource (Inter 400/500/600/700, IBM Plex Mono 500) instead of Google Fonts <link>. No render-blocking external request; will survive offline once chunk 4's service worker caches the assets. |
| 2026-05-23 | AppShell exposes a headerEnd prop (right of wordmark, left of AccountMenu) as the slot for SyncBadge in chunk 5+. AccountMenu always lives top-right. Max-width 1280, px-7. |

## Open questions for Cowork review

| Date | Question |
|---|---|
| 2026-05-23 | Supabase default-sender email rate limit (2/hr project-wide) blocked prod magic-link verification at chunk 3 close. Need a real SMTP provider (Resend free tier is the obvious pick) configured in Supabase Auth → SMTP before chunk 14 (due-reminder edge function). Setting up earlier is fine — would also unblock retroactive prod magic-link verification. |

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
