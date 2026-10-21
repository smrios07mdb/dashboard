# Chunk 89 — Claude suggests where General tasks belong; Sergio reviews, drags, approves

**Repos:** `smrios07mdb/dashboard` (migration 21 + app UI) and `smrios07mdb/dashboard-caldav-proxy` (two endpoints).
**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Stop and report on any conflict.

## Goal

A Claude scheduled task (cloud, runs on Sergio's Claude subscription — **no Anthropic API key**) reads open tasks sitting in a **General** list and writes **proposals**: move to an existing list, move to a **new list** it names, or keep in General. Nothing moves until Sergio opens a review sheet in the app, rearranges by drag if he wants, and taps **Approve**.

The cloud runner reaches `*.vercel.app` but **not** `*.supabase.co` (verified 2026-10-21: CONNECT 403), so the scheduled task talks only to the proxy. The app applies approvals itself with the user's session.

## Locked decisions

- **D1 Candidates.** Open tasks (`completed_at is null`) in a non-archived subcategory named `General` (case-insensitive, trimmed) under either category, `created_at <= now() - interval '10 minutes'`, with **no** `routing_proposals` row in status `pending`, `approved` or `kept`. Limit 100, oldest first.
- **D2 Existing targets.** Any non-archived, non-General subcategory of the user, **either category**. Each carries up to 8 recent task titles (open, or completed within 90 days) as context for the model.
- **D3 New lists.** A proposal may name a new list instead of an existing one: `new_list_name` (1–40 chars, trimmed, not `General`, not equal case-insensitively to an existing non-archived list in that category) + `new_list_category` (`Work` | `Personal`). The proxy rejects a new-list proposal backed by fewer than **2** tasks in the same run (those tasks fall back to keep) and more than **3** distinct new lists per run.
- **D4 Keep.** `to_subcategory_id` and `new_list_name` both null = keep in General.
- **D5 Proposals only.** The proxy never moves a task or creates a list. It writes `routing_proposals` rows with `status = 'pending'`.
- **D6 Review sheet.** New `components/SortingSheet.tsx` (lazy), opened from a chip `Sort General · N` in the Tasks tab header (visible when N > 0 pending proposals; hidden otherwise). Sheet layout:
  - One **group** per destination, in this order: existing lists (category, then list order), proposed **New** lists (tagged `NEW`, name editable inline), then **Keep in General** last (always present, may be empty).
  - Each task card shows title + Claude's reason (one line, truncated, full on hover/long-press).
  - **Drag** a card to any group, or use the card's `Move to…` menu (keyboard/touch fallback, same targets incl. every existing non-General list not already shown, which adds that group). Reuse the dashboard's `@dnd-kit` setup and `TaskDragGhost`; no new dependency.
  - A New group emptied by dragging disappears. `+ New list` at the bottom of the sheet adds an empty New group (name + Work/Personal picker).
  - Footer: **Approve** (applies the sheet as arranged) and **Not now** (closes; proposals stay pending). Per-card `×` = keep in General.
  - Desktop: right-side sheet like `WhatsNextSheet`; phone: full-height sheet. Both branches scoped per CLAUDE.md `data-branch` convention if both mount.
- **D7 Approve = one RPC.** `public.apply_routing(p jsonb)` (migration 21), `security invoker` (RLS applies), single transaction:
  1. Create each New list (`subcategories` insert, `sort_order` = max+1 in its category).
  2. For each task: if it is still open and still in its `from_subcategory_id` → set `subcategory_id` (moved), else skip (`stale`).
  3. Set each proposal's `status` to `approved` (moved), `kept` (Keep group) or `stale`, and `final_subcategory_id` to where it ended up.
  Returns `{ moved, kept, stale, created_lists }`. Toast: `Moved X · kept Y` (+ `· Z changed since` when stale > 0). Online-only — offline, Approve is disabled with `Needs a connection`. No outbox path.
- **D8 Decide once.** `approved` and `kept` tasks are never proposed again; moving one back into General by hand sticks. `stale` proposals free the task to be proposed again if it is still a D1 candidate. Pending proposals whose task was completed, deleted or moved out of General are hidden from the sheet and the count (filter at read time; the RPC marks them `stale` on the next Approve).
- **D9 Proxy auth.** Vercel env `ROUTER_TOKEN` (32 random bytes, base64url) and `ROUTER_USER_ID` (`9b5ce57c-8b69-42b5-ba0c-d3e21b269f85`). Endpoints require `Authorization: Bearer <ROUTER_TOKEN>` (constant-time compare; wrong/missing → 401, env unset → 503) and act only on that user's rows via the service-role client.
- **D10 Untouched.** `scheduled_blocks`, calendar mirror, export/import. `routing_proposals` is not exported (note in ARCH §4).

## 1. Migration 21 — `supabase/migrations/21_routing_proposals.sql`

```sql
create table if not exists public.routing_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  from_subcategory_id uuid not null references public.subcategories(id) on delete cascade,
  to_subcategory_id uuid null references public.subcategories(id) on delete set null,
  new_list_name text null check (new_list_name is null or char_length(btrim(new_list_name)) between 1 and 40),
  new_list_category_id uuid null references public.categories(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 280),
  status text not null default 'pending' check (status in ('pending','approved','kept','stale')),
  final_subcategory_id uuid null references public.subcategories(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz null,
  check (not (to_subcategory_id is not null and new_list_name is not null)),
  check ((new_list_name is null) = (new_list_category_id is null))
);
create unique index if not exists routing_proposals_one_pending
  on public.routing_proposals (task_id) where status = 'pending';
alter table public.routing_proposals enable row level security;
create policy routing_proposals_select_own on public.routing_proposals for select using (auth.uid() = user_id);
create policy routing_proposals_update_own on public.routing_proposals for update using (auth.uid() = user_id);
-- inserts: service role only (proxy).
alter publication supabase_realtime add table public.routing_proposals;
```

Plus `public.apply_routing(p jsonb)` per D7. Payload:
```json
{ "new_lists": [{ "key": "n1", "name": "Taxes", "category_id": "<uuid>" }],
  "items": [{ "proposal_id": "<uuid>", "to": { "subcategory_id": "<uuid>" } | { "new_list_key": "n1" } | null }] }
```
`null` = keep. Validate inside the function (names per D3, every proposal belongs to `auth.uid()` and is `pending`; raise on violation so nothing applies). Apply to the dev project (`dctfspcbkqvvyptddtif`). Document in ARCH §4 and a new §10 subsection "General sorting (chunk 89)".

## 2. Proxy — `GET /api/route/inbox`

`200 { ok, tasks: [{ task_id, title, category_name, from_subcategory_id, estimate_minutes, due_at, priority, created_at }], targets: [{ subcategory_id, name, category_name, examples: [title…] }], categories: [{ id, name }] }`

## 3. Proxy — `POST /api/route/propose`

Body (zod, strict): `{ proposals: [{ task_id, subcategory_id: uuid|null, new_list: { name, category: 'Work'|'Personal' } | null, reason }] }`, 1–100, unique `task_id`, not both `subcategory_id` and `new_list`.
- Re-check each task is a D1 candidate (else `skipped: not_candidate`); existing target must be a D2 target (else `skipped: bad_target`).
- Apply D3 limits (normalize names: trimmed, case-insensitive match merges into one group; a name matching an existing list in that category becomes that list).
- Insert all rows with one shared `run_id`, `status = 'pending'`.
- `200 { ok, run_id, results: [{ task_id, status: 'proposed'|'kept_fallback'|'skipped', detail? }] }`.

Helper in `api/_lib/router.ts`; proxy tests: auth 401/503, D1 filters (10-min age, pending/approved/kept excluded, stale re-eligible), cross-category target, General/archived target rejected, new-list min-2 and max-3 rules, name merge, existing-name collapse.

## 4. App

- `repo.routing.pending()` (joined to tasks, D8 read-time filter), `repo.routing.apply(payload)` → RPC. Realtime on `routing_proposals` refreshes the chip count.
- `SortingSheet` per D6, lazy-loaded; chip in the Tasks header.
- Tests (red-first per house rule): grouping order; drag between groups changes destination; `Move to…` adds an existing-list group; emptied New group disappears; rename New group; `×` sends to Keep; Approve builds the exact RPC payload; offline disables Approve; stale count in toast; chip hidden at 0; pending rows whose task left General are excluded.
- Eager JS budget: **+800 B** (chip + count only; everything else lazy). Stop and report if over.

## 5. Deploy and verify

1. **Proxy (your Mac, Claude Code):**
   ```
   cd ~/Documents/dashboard-caldav-proxy
   TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
   printf '%s' "$TOKEN" | vercel env add ROUTER_TOKEN production
   printf '%s' '9b5ce57c-8b69-42b5-ba0c-d3e21b269f85' | vercel env add ROUTER_USER_ID production
   vercel --prod
   printf '%s' "$TOKEN" | pbcopy && echo "ROUTER_TOKEN copied to clipboard"
   ```
   (Adjust the `cd` to the proxy clone's path.) Never print the token in a report.
2. **App:** code commit pushed alone (deploy must run green), docs commit `[skip ci]` after — CLAUDE.md per-push rule. PROGRESS row 89 + Decisions log.
3. **Live smoke** (Claude in Chrome, run by Claude Code; fixtures prefixed `Smoke-0890a-`; name the driver in the record):
   - Unauthed `GET /api/route/inbox` → 401 (curl, Mac).
   - SQL-insert into Work › General, `created_at = now() - interval '1 hour'`: `Smoke-0890a-a`, `-b`, `-c`, `-d`; plus `-e` created now.
   - curl `propose`: `a` → an existing Work list; `b` + `c` → new list `Smoke-0890a-New` (Work); `d` → keep. Inbox before: a–d listed, e not. After: none of a–d.
   - App: chip `Sort General · 4` → sheet shows the existing-list group, `NEW Smoke-0890a-New` (b, c), Keep (d). Drag `c` to Keep (synthesized pointer sequence per CLAUDE.md). Approve → toast `Moved 2 · kept 2`; DB: `a` in its list, new list exists holding `b`, `c` and `d` in General; proposals `approved`/`kept`; chip gone.
   - Inbox again → a–d absent.
   - Cleanup: delete tasks `like 'Smoke-0890a-%'` and the `Smoke-0890a-New` list.

## Out of scope

Proxy calling Anthropic; auto-approve; undo after Approve (tasks can be moved by hand); proposing for non-General lists; export of proposals.
