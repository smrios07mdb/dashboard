# Chunk 18 — Local-data hygiene + privacy disclosures

**Goal:** Stop secrets and free-text from persisting on, or leaving, the device unexpectedly — and disclose to the user what *does* leave. Closes the privacy findings from the post-chunk-16 audit. This is the one place the app's "trusted device, untrusted nothing-else" model visibly leaked.
**Findings:** AUTH-01 / PRIV-01 / PRIV-02 (sign-out cache wipe + stop caching secrets at rest), PRIV-03 (Apple Calendar notes), PRIV-04 (AI payload disclosure).
**Dependencies:** Chunks 3 (auth shell), 5 (repo + Dexie cache), 11 (AI triage), 13 (calendar integration).
**Effort:** ~3h.

> Reference `ARCHITECTURE.md` §10 (AI triage payload — sends `id, title, subcategory_name, category_name, estimate_minutes, due_at, priority`; **never `notes`**) and §14 (Known limitations table — extend it). Use `design/Settings.tsx` for the Settings UI and the existing Block Time sheet design for the sheet.
>
> **TDD:** write the failing test first for each behavioral item, then implement to green. `npm run build` + `npm test` must both be green before flipping `PROGRESS.md`.

## What to build

### 1. Wipe local cache on sign-out — AUTH-01 / PRIV-01 / PRIV-02

Today `signOut()` (`src/components/AccountMenu.tsx:21-28`) clears the Supabase session but never wipes Dexie. `wipeLocalCache()` (`src/db/localCache.ts`) exists but is only called from the manual Settings → Wipe and Import flows — there is **no `SIGNED_OUT` handler** (grep-confirmed). So after logout, task titles + notes, routine history, and the **cleartext `aiApiKey` + Apple ID** (`mappers.ts:213`, re-cached on every settings read per `repo.ts:891-892`) remain in IndexedDB — readable by the next person on a shared device or via DevTools.

- Find the existing `supabase.auth.onAuthStateChange` subscription (set up in the chunk-3 auth shell) and add a **`SIGNED_OUT` branch**. Wiring it here — not only in the AccountMenu button handler — means it also fires on token expiry and multi-tab / other-device sign-out, which the button can't catch.
- On `SIGNED_OUT`, after the session is cleared: call `wipeLocalCache()` and `clearVerified()`.
- **Outbox safety:** if `wipeLocalCache()` would also clear the offline outbox, gate that on the outbox being **empty**. If writes are still pending, preserve them and surface a warning — never silently drop queued edits.
- **Stop caching the two online-only secrets at rest** (the durable fix, independent of the wipe): in the settings → cache mapping (`mappers.ts:213`, `repo.ts:891-892`), omit `aiApiKey` and `caldavAppleId` from what gets written to Dexie, exactly as `caldavAppPassword` is already omitted. They are only ever used online (AI triage hits `api.anthropic.com`; CalDAV ops hit the proxy), so read them from the live Supabase settings fetch and don't persist them locally.

**Tests** (`localCache.test.ts` + the auth listener's test):
- After a `SIGNED_OUT` event, all user-scoped Dexie tables are empty and `clearVerified()` has run.
- With a non-empty outbox, `SIGNED_OUT` preserves the queued writes and raises the warning (does **not** clear them).
- A settings read populates the cache **without** `aiApiKey` or `caldavAppleId` present in the Dexie record.

### 2. Block Time → title-only Apple Calendar event by default — PRIV-03

`BlockTimeSheet.tsx:153-158` sends `description: task.notes ?? undefined` to the proxy → iCloud `VEVENT`, so free-text notes leave the device and sync to every device on the Apple ID plus any shared calendars. This is inconsistent with the AI triage path (which deliberately omits notes) and is disclosed nowhere.

- Default the created event to **title only** (no `description`).
- Add an **"Include notes in calendar event"** opt-in toggle to the sheet, **off by default**. Only when on does `description: task.notes` get sent.
- Add disclosure copy in the sheet: the event **title** (and notes, if the toggle is on) are saved to Apple Calendar and sync to all devices on your Apple ID.
- Update `docs/calendar.md` to state exactly which fields are written to iCloud.

**Tests** (`BlockTimeSheet.test.tsx`):
- Toggle **off** (default) → the payload to the proxy has no `description` (or `undefined`).
- Toggle **on** → the payload includes `description: task.notes`.

### 3. AI payload disclosure — PRIV-04

Settings copy near the AI key understates what triage sends. Add a one-line disclosure by the key field: triage sends task **titles** plus category, estimate, due date, and priority to Anthropic — **never notes**. Keep it consistent with `ARCHITECTURE.md` §10.

### 4. Docs — PRIV-02

- `docs/security.md`: note that, prior to this chunk, the Anthropic key and Apple ID also sat **at rest in IndexedDB** (not only in network traffic), and that Chunk 18 stops caching them and wipes the cache on sign-out.
- `ARCHITECTURE.md` §14 (Known limitations): add / adjust the row so it reflects the new at-rest behavior.

## Verify (manual — on the deployed build + DevTools)

1. Sign in; create a couple of tasks **with notes**. DevTools → Application → IndexedDB: confirm tasks + settings are present.
2. Confirm the settings record in IndexedDB has **no** `aiApiKey` and **no** `caldavAppleId` field.
3. Sign out via the account menu. Re-open IndexedDB → all user-scoped tables empty; app forces re-auth.
4. Sign in, make an edit while offline (DevTools → Network → Offline) so the outbox has a pending write, then sign out → confirm the warning fires and the queued write is **not** dropped.
5. Open Block Time on a task that has notes, leave the toggle **off**, confirm → inspect the event in Calendar.app: **title only, no notes**. Repeat with the toggle **on** → notes appear in the description.
6. Settings shows the AI-payload disclosure near the key field.
7. AI triage still returns recommendations and CalDAV calendar ops still work — proving the un-cached secrets are read correctly from the live settings.

## When the chunk is done (per `CLAUDE.md`)

- `npm run build` + `npm test` green; deploy workflow green on the push.
- Flip row 18 to ☑ in `PROGRESS.md` and add the commit SHA:
  ```
  | 18 | Audit: local-data hygiene + privacy disclosures | dashboard | ☑ | Claude Code | <sha> | — | <one-line note of any deviation> |
  ```
- Add to the Decisions log (today's date):
  ```
  | 2026-05-31 | Stop caching aiApiKey + caldavAppleId to Dexie; wipe local cache on SIGNED_OUT (online-only secrets, mirrors CalDAV password handling). |
  | 2026-05-31 | Block Time creates a title-only Apple Calendar event by default; notes are opt-in (prevents silent note sync to iCloud). |
  ```
- Update the "Last updated" date at the top of `PROGRESS.md`.

## Do NOT touch

- The AI request body in `ai.ts` — it already correctly omits notes; this chunk only adds the Settings **disclosure**, not a payload change.
- RLS / schema, the service worker, the CSP (all Chunk 17, shipped).
- `ReconnectBanner` and any empty-state / a11y work (Chunk 20).

---

_Next: Chunk 19 (mobile bottom-nav + touch/viewport polish)._
