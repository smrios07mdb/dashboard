# Chunk 56 — drop `settings.ai_api_key`; imports stop writing server-held state

**Repos / bases:**
- App `smrios07mdb/dashboard` @ `a29cc48` (last code `02030f4`, live).
- Proxy `smrios07mdb/dashboard-caldav-proxy` @ `bc55426`.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md` first.

**Precondition (verified 2026-10-12, chunk 55 step 6):** for user `9b5ce57c-8b69-42b5-ba0c-d3e21b269f85`, `ai_api_key is null`, `ai_api_key_encrypted is not null`, `ai_status = 'ok'`. Re-run that check first (MCP `execute_sql`); if it no longer holds, stop and report.

## Why the order is fixed

The proxy references `ai_api_key` in **three write paths and one read**, not just the D5 read: `ai.ts` `getLegacyAiKey` (select), `triage.ts` `resolveKey` (update `ai_api_key: null`), `key.ts` POST and DELETE (update `ai_api_key: null`). PostgREST rejects an unknown column on both select and update, so if the column drops first, triage, Save key and Remove key **all 500**. And any pre-chunk-55 export file carries `ai_api_key` in `settings`, which `import.ts` would upsert into a column that no longer exists. Both must be gone before the drop.

## Locked decisions

- **D1 Proxy.** Remove every `ai_api_key` reference (the column, not `ai_api_key_encrypted`): delete `getLegacyAiKey`; `resolveKey` becomes decrypt-or-null; drop the `ai_api_key: null` keys from `triage.ts` and both `key.ts` handlers. Update `tests/ai.test.ts` — the legacy-migration cases are deleted, not skipped; add one assertion that no `.select`/`.update` in any `api/ai/*` path names `ai_api_key`. README: remove the lazy-migration paragraph; one line in its history notes that it ran once on 2026-10-12.
- **D2 Import strips server-held settings.** In `src/lib/import.ts`, the settings upsert strips `CREDENTIAL_SETTINGS_KEYS` (unchanged) **plus** a new `IMPORT_STRIPPED_SETTINGS_KEYS` exported from `export.ts`: `['ai_api_key', 'ai_status', 'caldav_status', 'outlook_status']`.
  - `ai_api_key`: legacy column. Pre-chunk-55 files carry it.
  - The three statuses describe secrets the file does not carry. Importing `ai_status: 'ok'` onto an account with no key shows "Key saved" while triage 412s; the same happens for `caldav_status` and `outlook_status`. The live row's value is the only truthful one.
  - Export stays a faithful dump of these four: it does **not** redact them. Stripping happens on import only.
  - Do **not** introduce a column allowlist. A hardcoded list of known columns drifts on every migration.
- **D3 Migration 15** (`supabase/migrations/15_drop_ai_api_key.sql`, app repo): `alter table public.settings drop column if exists ai_api_key;` with a header comment in the migration-13/14 style naming chunk 55 D5 and this chunk. Apply via MCP `execute_sql`; confirm absence via `information_schema.columns`. If you have no Supabase MCP, stop and report.

## Sequence (each step gated before the next)

1. **Proxy code (D1).** Gates: `npm run typecheck`, `npx eslint api tests` (the gitignored `.remember/` file is a known local-only lint hit), `npm test`. `grep -rn "ai_api_key[^_]" api tests` → no hits. Commit, push.
2. **Proxy deploy.** `vercel --prod` from the proxy repo, **run by the operator in a terminal on his Mac** (the permission classifier refused it for Claude Code in chunk 55). Report the deployment id and confirm the alias `dashboard-caldav-proxy.vercel.app` points at it.
3. **App code (D2).**
   - Tests in `import.test.ts`:
     - (a) A pre-55-shaped file carrying `ai_api_key: null` and `ai_status: 'ok'` upserts settings **without** those keys.
     - (b) `caldav_status` and `outlook_status` are stripped the same way.
     - (c) Non-credential settings (e.g. `timezone`) still import.
   - In `export.test.ts`, assert the four D2 keys are **not** redacted.
   - Gates on a clean `npm ci`, with `.env.local` containing `VITE_CALDAV_PROXY_URL=https://dashboard-caldav-proxy.vercel.app`: `tsc -b` passes, `eslint .` reports **0**, `vitest run` is all green, `npm run build` passes.
   - Commit the code **alone** and push. The deploy run must be green, and the live `version.json` must equal that SHA (use a cache-busted read).
4. **Migration 15 (D3).** Apply only after steps 2 and 3 are both live.
5. **Smoke, operator's Chrome, deployed app.** The operator does two things:
   - (a) Run one **What's next?** triage. Expect recommendations, not an error.
   - (b) Settings → AI assist shows **Key saved**.

   Do **not** exercise Remove: it would delete the only copy of the key. The DELETE path is covered by the step-1 tests. Then confirm via `execute_sql` that `ai_status = 'ok'` and `ai_api_key_encrypted is not null` still hold.
6. **Docs (`[skip ci]`, after step 5):**
   - `ARCHITECTURE.md`: remove the `ai_api_key` line from the settings schema (~line 113); collapse the "Legacy key migration (chunk 55 D5)" paragraph (~line 323) to one historical sentence; add the D2 import rule wherever §-export/import describes the credential list.
   - `docs/security.md`: present tense, no live legacy column.
   - `PROGRESS.md`: row 56 ☑ with both repos' SHAs, D1–D3 in the Decisions log, and the last-updated paragraph (the previous one moves to Update history verbatim, per the chunk-54 convention).

## Out of scope

- Any change to how the key itself is stored, or to `/api/ai/triage` behaviour.
- `01_tables.sql`: historical migrations are never edited.
- The pre-existing drift where an export file's `ai_status` / `caldav_status` sit stale in old files on disk. D2 makes that harmless; there is nothing to clean up.

## Report back

- The precondition SQL output.
- Proxy SHA and the `vercel --prod` deployment id.
- App code SHA, deploy run id, and live `version.json`.
- The migration-15 `information_schema` result.
- The step-5 results.
- The docs SHA.
- Every deviation.
