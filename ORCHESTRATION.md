# Orchestration Instructions

Step-by-step sequence to drive the build. Follow in order.

> **Status (2026-08-31).** Phases 0–4 below are the MVP build sequence and are kept as history, not as live instructions — do not run them. The live process is `CLAUDE.md` (rules, lanes, definition of done) plus `PROGRESS.md` (state). "Design → Code handoff (general pattern)" is the one section below that describes how work runs today.

---

## Phase 0 — Setup (do once, before any chunk)

1. **Create both GitHub repos:**
   - `dashboard` (the app + Supabase migrations + Edge Function)
   - `dashboard-caldav-proxy` (the Vercel proxy)
2. **Drop this entire plan package into the root of `dashboard`** and commit:
   ```
   README.md
   ARCHITECTURE.md
   DESIGN_BRIEF.md
   PROGRESS.md
   ORCHESTRATION.md
   prompts/
     chunk-01-scaffold.md
     ... through ...
     chunk-16-insights-polish.md
   ```
3. **Create the Supabase project:**
   - Note the project URL and anon key (used by app).
   - Note the service role key (used only by proxy on Vercel — store in password manager).
   - Note the JWKS URL: `<project-url>/auth/v1/.well-known/jwks.json`.
4. **Generate VAPID keys** (used in chunk 4 setup but generate now): `npx web-push generate-vapid-keys --json > vapid.json`. Keep the JSON safe.
5. **Generate the CalDAV encryption key:** `openssl rand -base64 32 > caldav-key.txt`. Save for chunk 12.

---

## Phase 1 — Build (chunks 1 through 11, mostly serial)

### Run Chunk 1
- Open Claude Code in the `dashboard` repo root.
- Paste contents of `prompts/chunk-01-scaffold.md`.
- After it's done: confirm the GH Pages URL serves the "Dashboard" heading.
- Update `PROGRESS.md`: row 1 → ☑, add PR link.

### Run Design brief
- Open a **fresh Claude conversation in Design mode**.
- Paste contents of `DESIGN_BRIEF.md` (just the part between the `---` lines).
- Save the generated components into `dashboard/design/` (Login.tsx, Dashboard.tsx, CategoryView.tsx, SubcategoryView.tsx, Routines.tsx, Insights.tsx, Settings.tsx, types.ts, mock-data.ts, responsive-demo.tsx, and components/ui/*).
- **Do not wire these to data yet.** They are visual references.
- Commit the `design/` folder.

### Run Chunks 2 through 11 in order
- For each chunk: open Claude Code, paste the prompt, let it complete, verify acceptance criteria, update `PROGRESS.md`, push, confirm deploy.
- For UI chunks (6, 7, 8, 9, 10, 11), the prompt already references the `design/` folder. If Claude Code needs more context, open the matching `design/[Screen].tsx` alongside the prompt and add:
  > *Use `design/[Screen].tsx` as the visual reference; replace its mock-data props with real data via `src/db/repo.ts`.*
- **Never run two chunks in parallel** during this phase.

---

## Phase 2 — CalDAV proxy (chunk 12, parallel-eligible)

Chunk 12 can run **in parallel** with chunks 6–11 once chunks 2 and 3 are merged (the proxy needs the Supabase project URL and JWT verification setup, both established by then).

- Switch to the `dashboard-caldav-proxy` repo.
- Paste `prompts/chunk-12-caldav-proxy.md`.
- Generate an app-specific password at appleid.apple.com for testing.
- Deploy to Vercel and copy the deploy URL.
- Add the URL to `dashboard/.env.local` as `VITE_CALDAV_PROXY_URL=<vercel-url>`.
- Also add as a GitHub Actions secret in the `dashboard` repo (same name).
- Update `PROGRESS.md` row 12 → ☑.

---

## Phase 3 — Integration (chunks 13, 14, 15, 16, serial)

Return to `dashboard` repo. Run chunks 13 → 14 → 15 → 16 in order.

- Chunk 14 also touches `dashboard/supabase/functions/notify-due-reminders/`. The chunk prompt covers it.
- After chunk 16: do a real-device check on iPhone, iPad, and Mac.

---

## Phase 4 — Lived-use review (Day 7)

After chunk 16 ships, use the app on all three devices for a week. Document any friction or bugs in `PROGRESS.md` under "Revisions" with proposed mini-prompts. Do not silently modify shipped chunks; every change is its own commit with a written prompt.

---

## Design → Code handoff (general pattern)

How a design pass runs today:

1. **The orchestrator authors a scoped brief, one per pass** — a single screen or a single feature, never the whole app — written against the current system of record: `design/DESIGN_NOTES.md` for the visual system, `ARCHITECTURE.md` for anything the screen touches.
2. **The pass runs in Claude Design**, and its output is committed under `design/` as a prototype — the existing `design/src/*.jsx` are the shape to match. It stays unwired: no Supabase, Dexie, CalDAV or AI calls; data in via props, changes out via callbacks.
3. **Claude Code consumes the prototype** plus `design/DESIGN_NOTES.md`'s tokens and wires it to real data through `src/db/repo.ts`, per the implementation chunk prompt.
4. **Revisions to the visuals go back to Design with specific feedback, never to Code.**

If Claude Design output needs revisions before Code consumes it, re-run the Design prompt with specific feedback ("the dashboard header is too dense; the subcategory chevrons need more contrast") — don't ask Code to re-design.

---

## Rules

- **No skipping ahead.** Each chunk's "Do NOT touch" list assumes serial execution within its phase.
- **No silent modifications.** Every change to a shipped chunk is logged in `PROGRESS.md` Revisions and committed as its own PR.
- **The Supabase JWT is the only link between the two repos.** No shared code, no shared deploy. They evolve independently.
- **`ARCHITECTURE.md` is the canonical reference.** If a chunk prompt and `ARCHITECTURE.md` disagree, fix the prompt, log the decision, and continue.
- **Update `PROGRESS.md` after every chunk.** It's the single source of truth for "where are we."

---

## What "done" looks like

After chunk 16:

- App installable from Safari on iPhone, iPad, and Mac.
- Magic-link login works across all three devices, syncs in seconds.
- Apple Calendar integration creates events that appear in Calendar.app instantly.
- Web Push fires on iPhone when reminders are due (PWA installed, 16.4+).
- Offline edits queue and replay automatically on reconnect.
- AI triage returns sensible recommendations.
- Insights chart reflects real completion data.
- Full keyboard navigation; all screens accessible.

That's MVP. Day 7 lived-use review identifies the next chunks.
