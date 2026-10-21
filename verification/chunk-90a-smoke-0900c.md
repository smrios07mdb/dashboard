# Smoke 0900c — chunk 90a (Sort General empties General)

- **Date:** 2026-10-21
- **Driver:** Claude in Chrome (run by Claude Code). Response body captured with a `fetch` wrapper on the page; network log not needed.
- **Target:** prod app `https://smrios07mdb.github.io/dashboard/`, proxy `b10b284` (deployment `dashboard-caldav-proxy-d7kcdcg4c`, aliased to `dashboard-caldav-proxy.vercel.app`).
- **Replaces** the old 0900c brief; also covers the `max_tokens 12000` fix (`0b8e14d`).

## Pre-state

- D4: `update public.routing_proposals set status = 'stale', decided_at = now() where user_id = '9b5c…5f85' and status = 'pending'` → **41 rows** (all run `1ee0ae31`, the 0900b run).
- Candidates: 41 open tasks in General — Personal 36, Work 5.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Chip gone, **Sort General** button shows | ✅ only button text was `Sort General` |
| 2 | Tap → `Sorting…` → sheet opens | ✅ ~20 s |
| 3 | Response | ✅ `200 { ok: true, run_id: c199e52b-873f-4ed0-abb3-1078a5fd0880, proposed: 39, kept: 2, skipped: 0, remaining: 0, usage: { input_tokens: 4630, output_tokens: 3790 } }` |
| 4 | Model | ✅ proxy log `sort model=claude-haiku-5-5 source=resolved` |
| 5 | stop_reason | Not `max_tokens` (that path returns 502 `truncated`; this was 200). The proxy does not return `stop_reason`; with a forced `tool_choice` Anthropic reports `tool_use`, not `end_turn`. 3,790 output tokens for 41 tasks, well under 12,000. |
| 6 | Keep share | ✅ **2 / 41 = 4.9 %** (target ≤ 15 %) |
| 7 | Not now → sheet closes, every proposal pending | ✅ run `c199e52b`: 41 `pending`; chip reads `Sort General · 41` |
| 8 | Console clean | ✅ no errors or exceptions |

## Destinations (run `c199e52b`, from `routing_proposals`; matches the sheet)

| Kind | Destination | Category | Tasks |
|---|---|---|---|
| Existing | House | Personal | 4 |
| Existing | Viaje | Personal | 2 |
| Existing | Body - Brain - Heart | Personal | 1 |
| Existing | ADHD | Personal | 1 |
| Existing | Full Harvest | Work | 2 |
| Existing | AI | Work | 2 |
| Existing | LinkedIn | Work | 1 |
| NEW | Finances | Personal | 8 |
| NEW | Tech Setup | Personal | 8 |
| NEW | Errands | Personal | 3 |
| NEW | Learning | Personal | 3 |
| NEW | Subscriptions | Personal | 2 |
| NEW | Contacts | Personal | 2 |
| Keep | General | Personal | 2 |

Totals: existing 13, new 26 (6 lists, all Personal), keep 2.

- **Category changes: 0.** All 5 Work-General tasks went to Work lists; all 36 Personal-General tasks stayed Personal.
- **Keep list:** `Max al vet` — "Vet appointment for Max the dog."; `Call dad` — "Call to dad; family task." Both are single-task themes (a pet, family). The prompt sends lone themes to the closest list, so these were most likely proposed as one-task new lists and dropped by the min-2 rule (`kept_fallback`); the rows don't record which.

## Left for Sergio

All 41 proposals of run `c199e52b` are **pending**. Nothing approved.
