# Claude Code prompt — Chunk 85: cold-start stamping only

Base: `c3f862b` (code = `9ced783`). Given inline by Sergio on 2026-10-14; recorded here verbatim in substance.

Chunk 85 (small): cold-start stamping only. Single-user app; no multi-account work.

1. Report what uid an op gets if enqueued before the sign-in listener has fired (cold start, offline, expired token).
2. If it can be null/undefined, stamp from the last-known user id persisted at sign-in (cleared on SIGNED_OUT) so the op replays instead of being dropped. Never drop an op the current user just made.
3. Red-first test: enqueue before the listener fires → op is stamped and replays.
4. Eager JS: report the delta; stay within budget or put the change on the lazy path.
5. Record in PROGRESS: app is single-user; the "replace-import / sample-reset clears other users' entries" gap is closed as won't-fix.

Same 9-step protocol and gates as 82–84. Live smoke run by Claude Code via Chrome MCP; anything that cannot be run (sign-out, offline) is recorded as unit-test-only.
