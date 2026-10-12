# Chunk 57 — triage always uses the latest Claude Haiku

**Run after chunk 56 is closed (row 56 ☑).** Bases: take both repos' `main` at that point and state the SHAs in your report.
**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md` first.

**Operator rule (2026-10-12):** "always and only the latest Haiku model". Today that is `claude-haiku-5-5`.

**Facts checked by the orchestrator (2026-10-12):**
- Anthropic documents **no** `-latest` alias.
- Since the 4.6 generation, a model ID *is* a snapshot. A new model ships under a **new** ID.
- So "latest" has to be resolved at runtime from `GET /v1/models`, which returns:
  - results newest first;
  - a per-model `line` (`haiku` / `sonnet` / `opus` / …), which the docs say not to infer from `id`;
  - a `lifecycle` (`active` / `deprecated` / `retired`).
- Sources: platform.claude.com/docs/en/api/models/list and platform.claude.com/docs/en/about-claude/models/model-ids-and-versions.

## Locked decisions

- **D1 Resolution (proxy `api/_lib/ai.ts`).** Add `resolveHaikuModel(apiKey)`:
  - Call `GET /v1/models?limit=100&lifecycle=active` with the caller's key.
  - Follow `has_more` / `after_id` for at most 3 pages.
  - Keep entries with `line === 'haiku'` and pick the one with the greatest `created_at`. Do not rely on response order alone, and never match on `id` text.
  - `deprecated` and `retired` models are never eligible.
- **D2 Floor.** `HAIKU_FLOOR = 'claude-haiku-5-5'`. Use it when the Models call fails, times out (the existing 12 s budget), or returns no active Haiku. The floor is always a Haiku: "only Haiku" holds even on failure. Never fall back to another line.
- **D3 Cache.**
  - In-memory, per warm instance, keyed by SHA-256 of the API key. Never key on or log the raw key.
  - A resolved model is cached for 24 h. A floor result is cached for 5 min, so an outage doesn't hammer `/v1/models`.
  - No persistence: Supabase stays unaware of the model.
- **D4 Retired-model recovery.** If `/v1/messages` returns **404** with `error.type === 'not_found_error'`, drop that key's cache entry, re-resolve, and retry the call **once**. A second failure maps to the existing `upstream` (502).
- **D5 Key validation unchanged.** `POST /api/ai/key` keeps validating with `GET /v1/models?limit=1`. It does not pre-resolve or cache a model.
- **D6 App.**
  - Delete `TRIAGE_MODEL` from `src/lib/ai.ts`: the app no longer names a model.
  - The Settings label becomes **"Uses the latest Claude Haiku"**. Update `Settings.test.tsx` to match.
  - No model is shown anywhere else. The Anthropic response's own `model` field is not surfaced.
- **D7 Docs.**
  - ARCH line ~49 and §10 line ~308: "latest active Haiku, resolved per D1–D4; floor `claude-haiku-5-5`".
  - Add a Decisions-log row recording the operator rule verbatim.
  - Proxy README: AI section.

## Tests (proxy `tests/ai.test.ts`, stubbed `fetch`)

1. Newest-by-`created_at` Haiku is picked even when the response lists an older Haiku first.
2. A newer `line: 'sonnet'` model and a newer `lifecycle: 'deprecated'` Haiku are both ignored.
3. Pagination: the only Haiku sits on page 2 and is found.
4. Floor on: Models 5xx, network reject, timeout, and zero Haiku. The floor is cached for 5 min; a second call inside that window makes no Models request; a call after it does (fake timers).
5. 24 h cache: a second triage within 24 h makes no Models request; different keys do not share a cache entry.
6. D4: a `not_found_error` 404 leads to re-resolve plus exactly one retry, using the new model. A second 404 returns 502. A non-404 error never retries.
7. The model actually sent in the `/v1/messages` body equals the resolved ID, asserted from the request body.
8. No log line contains the key. Spy on `console.*` across all cases.

## Sequence

1. **Proxy code.** Gates: `npm run typecheck`, `npx eslint api tests`, `npm test`. Commit and push.
2. **Proxy deploy.** The operator runs `vercel --prod` in a terminal on his Mac. Git-push auto-deploy is off.
3. **App code (D6).** On a clean `npm ci`, with `.env.local` containing `VITE_CALDAV_PROXY_URL=https://dashboard-caldav-proxy.vercel.app`, these must pass:
   - `tsc -b`
   - `eslint .` with 0 problems
   - `vitest run`, all green
   - `npm run build`
   - `grep -rn "claude-haiku" src` must return nothing.

   Commit the code alone and push. The deploy run must be green, and live `version.json` must equal the new SHA (check with a cache-busted read).
4. **Smoke, in the operator's Chrome on the deployed app.** The operator runs one What's next? triage and expects recommendations. Then confirm which model served it from the proxy's Vercel function log:
   - Log one line per triage, `triage model=<id> source=<resolved|floor|cache>`, with no key material.
   - `<id>` must equal the newest active Haiku that `GET /v1/models` lists at that moment.
5. **Docs (D7)** as one `[skip ci]` commit. In `PROGRESS.md`, mark row 57 ☑ and update the last-updated paragraph (the previous one moves verbatim to Update history).

## Out of scope

- Model choice for any other feature.
- Exposing a model picker in Settings.
- Effort or thinking parameters. Keep the request body otherwise identical to chunk 55.

## Report back

Report each of these:
- base SHAs;
- proxy SHA and deployment ID;
- app SHA, deploy run ID and live `version.json`;
- the step-4 log line and the `/v1/models` evidence for it;
- docs SHA;
- deviations.
