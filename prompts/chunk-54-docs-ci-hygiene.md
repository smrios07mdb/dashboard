# Chunk 54 — docs + CI hygiene (2026-10-12 audit, P2 #4/#5, P3 #11/#12)

**Base:** `main` @ `9b5d0eb` (chunk 53 squash; deployed, live `version.json` = `9b5d0eb`).
**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md` first — the `[skip ci]` per-push rule governs the push order below.
**Source:** `claude/audit-2026-10-12.md` in the To-Do App Project, re-checked by the orchestrator against `9b5d0eb` on 2026-10-12. Where this prompt and the audit disagree, this prompt wins (corrections marked **⚠ audit**).

## Scope

Two pushes, in this order. No `src/` changes. No dependency changes.

### Push 1 — Node 22 in CI (code-affecting: **no `[skip ci]`**)

1. `.github/workflows/deploy.yml`: `node-version: '20'` → `'22'`. Nothing else in the file.
2. Commit alone: `ci: build on Node 22 (matches local gates)`.
3. Push to `main` on its own. Confirm the run exists and is green (`gh run list --workflow deploy.yml -L 1`), then confirm live `version.json` = this commit's short SHA.
4. If the build fails on 22, stop and report — do not fall back to 20 silently.

### Push 2 — docs (`[skip ci]`), only after Push 1's deploy is green

All in `PROGRESS.md` / `README.md`. One commit, message ends `[skip ci]`.

**D1 — row 53 SHA.** Row 53's "PR / Commit" reads `(squash on merge)`. Set it to `9b5d0eb (#9)`.

**D2 — header trim.** Lines 3–29 hold 14 dated update paragraphs (~29 kB). Keep only the newest `Last updated:` paragraph at the top. Move every `Prior update:` paragraph, verbatim and in the same order, under a new `## Update history` section placed directly above `## How to update this file`. Lines 31 (MVP COMPLETE) and 33 (canonical-tracker note) stay where they are. No wording changes to moved text.

**D3 — Day-7 backlog triage** (`### Day-7 lived-use revision backlog`). Replace "**none are shipped yet.**" with a one-line status note dated 2026-10-12, then mark each item. Statuses below are the orchestrator's read of `9b5d0eb`; **verify each against source before writing it** and report any you disagree with instead of writing it.

| # | Status | Evidence to confirm |
|---|---|---|
| 1 UTC→local bucketing | open | `src/lib/insights.ts` doc comment still says UTC date portion |
| 2 reminder TZ | open | confirm in `SetReminderPopover` |
| 3 transactional Replace RPC | open | no RPC migration (latest is `13_caldav_read_calendars.sql`); `import.ts` makes no `rpc(` call |
| 4 cross-category drag | open | per-`CategoryColumn` `DndContext` still in `src/components/CategoryColumn.tsx`; confirm collision strategy |
| 5 coarse-pointer 44 pt | **check** | `SubcategoryHeader` says the drag handle is desktop-only — if the grip never renders on touch, mark *moot* with that reason; otherwise open |
| 6 doc reconciliation | done | `ARCHITECTURE.md` no longer carries `#faf8f3` or `status='completed'`; only `DESIGN_BRIEF.md` (historical) does |
| 7 Lighthouse | done (no-op) | as written |
| 8 lucide-react pin | done for this bump | re-verified in the 2026-10-12 audit; chunk 53 left the pin unchanged |
| 9 focus-zoom outliers | **open** | `SubcategoryHeader.tsx` rename input still `text-[14px]` (line ~208) |
| 10 Today DB persistence | **open** ⚠ audit | `src/state/todayPlan.ts` is still client-local |
| 11 Today from `dueAt` | **open** ⚠ audit | `src/lib/today.ts` still reads `remindAt` |

Marking style: prefix each item with `☑`, `☐`, or `— moot`, plus one short clause of evidence. Do not delete items; do not reword item bodies.

**D4 — README.** "Build sequence lives in `ORCHESTRATION.md`" is stale (`ORCHESTRATION.md` line 5 says Phases 0–4 are history). Change to: process rules in `CLAUDE.md`, state in `PROGRESS.md`, `ORCHESTRATION.md` for history and the Design → Code handoff pattern. Keep it to one sentence.

**D5 — "How to update this file" footer.** Step 6 "Sync to the GitHub Project board" is wrong: the board *is* `PROGRESS.md` (see line 33). Replace with "Commit `PROGRESS.md` with the chunk or as an immediate `[skip ci]` follow-up (`CLAUDE.md`)." Align steps 1–5 with `CLAUDE.md` "Progress tracking" if they differ.

**D6 — pin rationale.** Add a Decisions-log row (2026-10-12) recording why `dexie` is exact-pinned at `4.4.2` and `lucide-react` sits at `^1.16.0`. Find the reason in the Decisions log / `git log -S'"dexie": "4.4.2"' -- package.json`. If no reason is recorded, the row says so plainly ("pin predates recorded rationale; re-evaluate on next bump") — do not invent one.

**D7 — row 54 + header.** Add row 54 (☑, both SHAs: Push 1 code, Push 2 docs) and a new `Last updated:` paragraph for chunk 54 (the chunk-53 paragraph moves to Update history per D2).

## Out of scope (explicitly)

- `check.yml` PR workflow (audit #6). Not now: tests need `.env.local`, and `plannerCalendarMirror.counts.test.ts` needs the real proxy origin as `VITE_CALDAV_PROXY_URL` — a check job would need repo secrets wired, which is its own decision.
- Moving `hupomnemata_handoff/`, `today_list_handoff/`, `DESIGN_BRIEF.md` (audit #11) — leave in place.
- Any Day-7 item's actual fix. Triage only.
- AI-key handling (audit #2), Tailwind 4 (chunk 53 D1), file splits (#9), bundle splitting (#10).

## Gates

- Push 1: `npm ci && npm run build` green locally on Node 22 before pushing; deploy run green; live `version.json` = Push 1 SHA.
- Push 2: `git diff --stat` touches only `PROGRESS.md` and `README.md`; head commit carries `[skip ci]`; no deploy run triggered; live `version.json` still = Push 1 SHA.
- D2 integrity: the moved Prior-update paragraphs are byte-identical — `diff` the sorted set of `Prior update:` lines before and after; must be empty.

## Report back

Push 1 SHA + run id, Push 2 SHA, the D3 table as finally written (flag every row where you disagreed with the orchestrator's status), and the D6 finding.
