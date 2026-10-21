# Chunk 90 — "Sort General" button: suggestions on demand through the saved Anthropic key

**Repos:** `smrios07mdb/dashboard` (app) and `smrios07mdb/dashboard-caldav-proxy` (one endpoint).
**Base:** app `d2032e7` (code = `975343b`), proxy `7d94a3c`.
**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Stop and report on any conflict.

## Goal

Sergio taps a button and gets Claude's General-sorting suggestions in seconds, then reviews/drags/approves them in the chunk-89 `SortingSheet`, which is unchanged. The suggestions come from the **existing** saved Anthropic key (chunk 55) and the **existing** latest-Haiku resolver (chunk 57). No scheduled task is used.

## Locked decisions

- **D1 Endpoint.** `POST /api/ai/sort` on the proxy, Supabase-JWT auth like `/api/ai/triage`, empty body. It acts on the JWT's user, not on `ROUTER_USER_ID`.
- **D2 Reuse chunk 89.** Candidates and targets come from `api/_lib/router.ts`, with one change: the 10-minute age filter is **off** for this path (the button is an explicit request). Proposals go through the same propose/validate code (D3 new-list rules, name merge, existing-name collapse, one `run_id`, `status = 'pending'`). Refactor `router.ts` to take `{ userId, minAgeMinutes }` instead of reading env, so both paths share it. Router-token endpoints stay as they are.
- **D3 Model call.** The model comes from the existing resolver (latest Haiku, floor `claude-haiku-5-5`), using the key from `settings.ai_api_key_encrypted`. One request, `temperature 0`, `max_tokens 4000`. Output is forced through a single tool `propose_sorting` whose input schema is the chunk-89 `propose` body. The system prompt (in `api/_lib/sortPrompt.ts`):
  - Sort each task into the existing list it clearly belongs to, using the list names and their example titles.
  - Suggest a new list only when **≥ 2** tasks share a clear theme no existing list covers; give it a short name (≤ 3 words, Title Case) and pick Work or Personal; at most 3 new lists.
  - If unsure, or if the task is genuinely general, keep it (`subcategory_id: null`, `new_list: null`).
  - Give a one-line reason for each task (≤ 120 chars).
  - Never invent ids; use only the ids given.
  Validate with zod. Unknown or hallucinated ids are dropped as `skipped: bad_target` / `not_candidate`. A tool call missing or failing the schema → 502 `malformed`.
- **D4 Limits and cost.** At most 100 candidates per press (oldest first; the response reports `remaining`). Targets carry up to 8 example titles each. Log `usage.input_tokens` / `usage.output_tokens` in the response as `usage` (no other logging of task content).
- **D5 Responses.** `200 { ok, run_id, proposed, kept, skipped, remaining, usage }`; `200 { ok, proposed: 0, … }` when there are no candidates (no Anthropic call made). Errors reuse the triage mapping: 412 `no_key`, 422 `bad_key` (and set `ai_status = 'auth_failed'`), 502 `upstream` / `malformed`, 401 for a missing or invalid JWT.
- **D6 App button.** This lives in the existing Sort General chip slot in the Tasks header (`Dashboard.tsx` / `DailyHero` chip):
  - pending > 0 → chip `Sort General · N` opens the sheet (unchanged).
  - pending = 0 and at least one open task in a General list → button `Sort General`. Tap → label `Sorting…`, disabled → on success with `proposed + kept > 0`, open the sheet; with 0, toast `Nothing to sort`.
  - Hidden when `ai_status !== 'ok'` (no key): show nothing, not an error.
  - Errors → toast with the triage copy (`src/lib/ai.ts` `MESSAGES`); `missing-key` / `auth` toasts link to Settings.
  - `remaining > 0` → after Approve or Not now, the toast reads `N more in General — tap Sort General again`.
  - Offline → button disabled, `Needs a connection`.
- **D7 No auto-run.** Nothing calls `/api/ai/sort` except the button.
- **D8 Budget.** Eager JS **+500 B** over `975343b`'s eager total. The fetch helper and error mapping go in a lazy module imported on tap. Stop and report if over.

## Tests (red-first)

**Proxy:**
- 401 without a JWT; 412 with no key; 422 sets `auth_failed`.
- No candidates → no Anthropic call.
- The age filter is off on this path and on (10 min) on the router path.
- Hallucinated ids are dropped; the min-2 / max-3 new-list rules hold on model output.
- A missing tool call → `malformed`.
- `remaining` is correct at 101 candidates.
- The model id comes from the resolver.

Mock Anthropic; no live call in unit tests.

**App:** the chip/button states per D6 (pending > 0, = 0 with General tasks, no General tasks, no key, offline); Sorting… disables the button; success opens the sheet; 0 → toast; each error kind → its toast; the `remaining` toast.

## Deploy and verify

1. Proxy: `vercel --prod` from `~/Documents/dashboard-caldav-proxy`. No env changes.
2. App: code commit pushed alone with no `[skip ci]` and a green deploy; then a docs commit `[skip ci]` with PROGRESS row 90, the Decisions log entry, ARCH §10 "General sorting" extended with the on-demand path, and `usage` noted.
3. **Live smoke (Claude in Chrome, run by Claude Code, run id `0900a`; name the driver in the record):**
   - Fixtures: SQL-insert into Work › General `Smoke-0900a-Call auditor re Q3 review`, `Smoke-0900a-Book flight to NYC`, `Smoke-0900a-Hotel for NYC trip`, `Smoke-0900a-Misc`.
   - Before the press, record the count of real (non-Smoke) pending proposals (expected 0).
   - Tap `Sort General` → `Sorting…` → the sheet opens. Record what the model proposed for the 4 fixtures. Any outcome is acceptable as long as it is valid per D3 — don't assert a specific grouping.
   - Record `usage` from the network response and compute the cost at the current Haiku list price (look it up; cite the source).
   - **Real General tasks will be proposed too — do not approve or keep them.** Tap **Not now**, then via SQL delete the Smoke tasks (their proposals cascade). Leave Sergio's real proposals **pending** for him to review.
   - Re-open the chip: the count equals the number of real pending proposals.
   - Console clean.
4. Report: the SHAs, the live bundle, the test counts in 3 zones, eager delta, the smoke results including the model id, `usage`, cost per press, and how many real proposals are waiting for Sergio.

## Out of scope

Changes to the review sheet; auto-run; a scheduled task; removing the router-token endpoints; a per-press cost display in the UI.
