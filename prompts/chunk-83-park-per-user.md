# Claude Code prompt — Chunk 83 (small): scope parked deletes to the signing-out user

Base: `4662f0d` (code = `6ad459a`). Given inline by Sergio on 2026-10-14; recorded here verbatim in substance.

1. When parking, store the user id with each parked delete.
2. On sign-in: commit only the entries whose user id matches the new user. Leave the other entries parked, or drop them after 7 days. Never commit them under a different user.
3. Tests, red-first: same user commits; a different user does not commit and does not clear the other user's entries; entries are dropped after 7 days.
4. Before writing the tests, confirm that RLS on delete actually rejects a cross-user delete, and report what happens at base when it's attempted.
5. Eager JS: we're at +549 of +600 B. Put this in the lazy undo path, or report the size delta before shipping.

Same 9-step protocol and gates as chunk 82 (`prompts/chunk-82-park-focus-zones.md`).
