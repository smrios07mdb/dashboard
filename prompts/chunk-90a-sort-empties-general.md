# Chunk 90a — Sort General empties General: Work/Personal first, new lists freely

Repos: smrios07mdb/dashboard-caldav-proxy (prompt + limits) and smrios07mdb/dashboard (docs only).
Base: proxy 0b8e14d (max_tokens 12000 fix). App: current main.
This chunk deliberately supersedes chunk 89 D3's "max 3 new lists per run" and chunk 90 D3's "if unsure, keep" — log both in the Decisions log.

## Why
Sergio's first real press (run 0900b, 41 pending proposals) left most tasks in General and did not separate Work from Personal. He wants few tasks left in General, most moved into lists, new lists created where none fit. Causes at 0b8e14d:
1. SORT_SYSTEM_PROMPT tells the model to keep when unsure and to suggest new lists sparingly.
2. NEW_LISTS_PER_RUN = 3 in api/_lib/router.ts drops every new-list group past the third back to Keep (kept_fallback: new_list_max).
3. The prompt never asks the model to decide Work vs Personal from the task's content.

## Locked decisions
- D1 Prompt (api/_lib/sortPrompt.ts, SORT_SYSTEM_PROMPT). Replace the rules with:
  - Goal: empty the General lists. Keeping a task in General is the exception, for a task that truly fits no list and shares no theme with any other task.
  - Step 1 for every task: decide Work or Personal from what the task is about, ignoring which General list it is in now. Work = MDB Capital, deals, clients, investors, compliance, colleagues, work tools. Personal = home, family, health, money, errands, personal projects and apps.
  - Step 2: put it in the existing list in that category that fits, judging by list names and example titles.
  - Step 3: if none fits, put it in a new list in that category. Prefer broad, durable names (Home, Finances, Health, Family, Errands, Deals, Compliance) so tasks group. At most 3 words, Title Case. Same exact spelling for every task going to the same new list. A new list needs at least 2 tasks; if a task's theme is truly alone, put it in the closest existing or new list in its category instead of keeping it.
  - One-line reason ≤ 120 chars; never invent ids.
- D2 Limits (api/_lib/router.ts). NEW_LISTS_PER_RUN 3 → 8. NEW_LIST_MIN_TASKS stays 2. Applies to both paths. Update tests asserting 3; add one asserting 8 groups pass and the 9th falls back.
- D3 Thinking. If the /api/ai/sort request body does not disable thinking the way 934dcbc does for triage, add it. Test that the sent body carries it.
- D4 Discard the 41. Do NOT approve them (approve marks keeps `kept`, never re-proposed). After the proxy deploy, on Supabase dev project dctfspcbkqvvyptddtif run:
  update public.routing_proposals set status = 'stale', decided_at = now()
   where user_id = '9b5ce57c-8b69-42b5-ba0c-d3e21b269f85' and status = 'pending';
  Record the row count (expected 41).
- D5 Unchanged: SortingSheet, apply_routing, the app button and states, SORT_MAX_TOKENS 12000, SORT_BATCH 100, response shape.

## Tests (red-first)
- Prompt contains the Work/Personal-first step and no "if unsure … keep" rule.
- 8 new-list groups all proposed; the 9th → kept_fallback: new_list_max.
- Min-2 rule still holds.
- Sort request body disables thinking.
- Mock Anthropic; no live calls. Proxy suite green.

## Deploy and verify
1. Proxy: npm test; commit; push; `vercel --prod`.
2. Run the D4 SQL. Record the count.
3. Live smoke 0900c (Claude in Chrome, run by Claude Code; name the driver in the record). Replaces the old 0900c brief and still covers the 12000 fix.
   - Confirm the chip is gone and the Sort General button shows.
   - Tap Sort General → Sorting… → sheet opens.
   - From the network response record proposed, kept, skipped, remaining, usage, model id, and whether stop_reason was end_turn.
   - From the sheet or routing_proposals for the new run_id record: count per destination, every NEW list name + category + task count, Keep count, and how many tasks changed category.
   - Target: Keep ≤ 15% of tasks sent. Over that → stop and report the Keep list with reasons before the docs commit; don't tweak the prompt in the same run.
   - Tap Not now. Leave every proposal pending for Sergio. Do not approve.
   - Console clean.
4. App docs commit after the smoke (PROGRESS row 90a; Decisions log rows superseding 89-D3 and 90-D3; ARCH §10 "General sorting" updated; smoke 0900c record under verification/), `[skip ci]`.
5. Report: proxy SHA, docs SHA, test counts, D4 stale count, the 0900c numbers including Keep share and NEW list names.

## Out of scope
Review sheet changes; auto-approve; re-proposing tasks already kept or approved; per-press cost display.
