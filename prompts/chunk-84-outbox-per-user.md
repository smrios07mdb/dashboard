# Claude Code prompt — Chunk 84: scope the offline queue to the user who queued each op

Base: `ea5a089` (code = `4344f2e`). Given inline by Sergio on 2026-10-14; recorded here verbatim in substance.

0. Inventory first, report before tests: every op type the offline queue can hold (insert/update/delete, any table), and for each insert path whether user_id is sent in the payload or set by a DB default/trigger (auth.uid()). If any insert relies on the default, flag it as cross-account write risk at base and prove it with a rolled-back transaction as user B replaying user A's insert.
1. Stamp uid on every queued op at enqueue time (not at replay; the session may be gone).
2. Replay only ops whose uid matches the current user. Other users' ops stay queued; drop after 7 days, same as 83.
3. Inserts must send user_id explicitly from the stamped uid, never rely on the default. RLS insert policy should still reject a mismatch; verify it does.
4. Legacy entries with no uid (both offline queue and pre-83 pending deletes): drop them on first load after this ships, don't commit them. Record in PROGRESS.
5. Tests red-first in New York + Tokyo: same-user replays; different-user does not replay and does not clear; 7-day drop; legacy no-uid entries dropped; insert payload carries user_id. Label any base-passing test as not a regression guard.
6. Eager JS: 4 B left of +600. Put this on the lazy path; if that's impossible, stop and report the delta before shipping.

Same 9-step protocol and gates as chunk 82 (`prompts/chunk-82-park-focus-zones.md`).
