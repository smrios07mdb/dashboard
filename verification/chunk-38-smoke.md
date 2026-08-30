# Chunk 38 smoke — results (Cowork / Chrome MCP, 2026-08-30 ~09:55–10:10 ET)

**No manual deletion required.** `Smoke Busy` was **not created** this run — it
only constrains check 1's packing, and checks 1–5 were blocked before any
fixture was needed. Nothing is left on iCloud.

Run against local dev `http://localhost:5173/dashboard/`, `redesign` @ `03a62f7`
(code identical to `486dfe6`; all source citations below are `git show 486dfe6`),
signed in as smrios07@gmail.com. Dev DB `dctfspcbkqvvyptddtif`, single user
`9b5ce57c-8b69-42b5-ba0c-d3e21b269f85`.
Pre-smoke `select count(*) from public.scheduled_blocks` = **0**; post-cleanup = **0**.

Tree state: `git status --short` showed one pre-existing untracked entry,
`?? _to_delete/` (left by an earlier session's delete workaround) — no tracked
modifications.

**Week under test: Aug 24 – 30 (WEEK 35) — the current week. Run date is
Sunday Aug 30, so `todayIdx = 6`.** Header before any fixture:
`0m planned · 0m free` — every weekday of the current week is already past, so
each carries `—` rather than a `free` figure.

Tray hygiene: `tasks?completed_at=is.null&priority=in.(1,2)` returned `[]` before
the run — no stray P1/P2 tasks, nothing reprioritized, nothing to restore.

## Fixtures

Created via PostgREST with the Dashboard's field shape, subcategory Work/General
(`396b54ec-4090-49b4-843f-0799b5cd6f0a`), in table order to fix the `created_at`
tie-break. All four appeared in the tray under `P1 — URGENT` ×2, `P2 — SOON`,
`P3 — WHENEVER`.

| Task | id | priority | est | due |
|---|---|---|---|---|
| `Smoke P1a` | `d2ab2654-9589-4206-8d72-f26c3791e6ff` | 1 | 45m | today 17:00 |
| `Smoke P1b` | `281d2178-a979-4ced-b703-3a403730ddac` | 1 | 30m | null |
| `Smoke P2`  | `9e4ce94d-1926-4915-b85c-41d4dd4273bf` | 2 | 60m | null |
| `Smoke P3`  | `ca8ff5bf-802a-498b-8439-eb79b56fd175` | 3 | 30m | null |

## Results

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Fill my week | **BLOCKED** | `Fill my week` is rendered **disabled** (`disabled` attribute present, computed `opacity: 0.5`) on the current week with all three P1/P2 fixtures live in the tray. Root cause is the day of week, not the tray: `src/screens/Planner.tsx:774-776` — `const fillable =` / `todayIdx <= 4 &&` / `trayItems.some((i) => i.task.priority === 1 \|\| i.task.priority === 2)`. `todayIdx` is `todayIndex(weekStartDate, now)` (`Planner.tsx:199`) on a Monday-start week, so Sunday ⇒ `6` ⇒ `fillable === false` regardless of tray contents. The button is only rendered at all when `proposals.length === 0` (`Planner.tsx:962`), so with no proposals obtainable there is no path to the bar. Not a code fault — this is exactly what the spec's "today must be Mon–Thu" data-setup line protects, and the header `0m free` shows why the gate exists (no open weekday capacity remains in week 35). |
| 2 | Clear | **BLOCKED** | Depends on check 1's bar. |
| 3 | Place all | **BLOCKED** | Depends on check 1's bar. |
| 4 | Proposals cleared by a manual drag | **BLOCKED** | Depends on check 1's bar. The chunk-37 drag residual it was meant to re-test is therefore still unretested. |
| 5 | Button disabled states | **BLOCKED (observed, non-discriminating)** | Both halves were observed true — on WEEK 34 (previous week) the button read `disabled=true`, `opacity: 0.5`. But today `fillable` is false for *every* input, so the check cannot distinguish "disabled because the week is not current / no P1–P2 in tray" from "disabled because `todayIdx > 4`". Recorded as blocked rather than PASS: passing for the wrong reason is not evidence. 5(b)'s Dashboard complete/un-complete round trip was not run, so no real task was touched. |
| 6 | Carry on the current week | **PASS** | `Smoke P1b` scheduled via the desktop Schedule sheet, custom time `09:15` (sheet defaulted to `SUN 30 (today)`, `aria-pressed=true`; entering a custom time deselected all three preset slots — `aria-pressed=false` on each). Toast verbatim: `Scheduled 09:15.` Block rendered hollow **immediately** (no wait for the 60s `now` tick, since `nowMin` was already past it): accessible name `Smoke P1b, 09:15–09:45, unfinished`; computed `border-style: dashed dashed dashed solid` (left edge stays the solid 3px category rail, `color(srgb 0.0196 0.588 0.412 / 0.45)`), `background-color: color(srgb 1 1 1 / 0.55)` (the `color-mix(in srgb, var(--surface) 55%, transparent)` at `TaskBlock.tsx:139-140`, resolved), `box-shadow: none`, title span `rgb(99, 95, 108)` = `--ink-2` `#635f6c`. Height 24px for 30m, so the visible range is suppressed and ` · unfinished` rides on the accessible name only. Hover action row read exactly `[→][✓][×]` — `Move to next open slot` (both `title` and `aria-label`), `Mark done`, `Unschedule`. Clicked `→` at **10:03:21**; toast verbatim `Moved to SUN 30, 10:15.` = `ceil15(10:03:21 + 10m)` ✓. Block re-rendered solid (`border-style: solid`, `background rgb(255,255,255)`, `box-shadow: rgba(30,26,40,0.06) 0px 1px 2px 0px`, title `rgb(34,31,40)` = `--ink`), accessible name back to `Smoke P1b, 10:15–10:45` with the `→` button gone. DB row `start_at 2026-08-30T14:15:00+00:00` / `end_at 14:45:00+00:00` = local 10:15–10:45 ✓. **Note:** the target slot is a Sunday — same-day weekend placement, consistent with the spec's "weekends allowed" for carry (and in deliberate contrast to `fillable`'s weekday gate). |
| 7 | Carry from a past week | **PASS (adapted — see Deviations)** | Block moved by PostgREST PATCH to `2026-08-21T14:00:00+00:00`–`14:30:00+00:00` = **Fri Aug 21 10:00–10:30 EDT**, i.e. the previous week (WEEK 34), *not* "last Friday" — on a Sunday run last Friday falls inside the current week. On WEEK 34 the block rendered hollow on FRI: `Smoke P1b, 10:00–10:30, unfinished`, `dashed dashed dashed solid`, `color(srgb 1 1 1 / 0.55)`, `box-shadow: none`, title `rgb(99,95,108)`; header `30m planned · 0m free`. Clicked `→` at **10:04:55**; toast verbatim `Moved to SUN 30, 10:15.` — names a day of the **current** week ✓, `ceil15(10:04:55 + 10m)` ✓. Past week's grid then held **zero** `task-block` elements, header fell to `0m planned`, and `Nothing planned yet.` rendered — the block was removed, not re-rendered there ✓. DB updated to `2026-08-30T14:15:00+00:00`–`14:45:00+00:00` ✓. `Today` → block present on SUN at 10:15–10:45, solid ✓. **Busy requests: exactly 1** (page-world `fetch`/`XHR` logger, counter reset immediately before the `→` click) — the current week's busy entry was older than 5 minutes (last fetched during the week-nav warm-up ~14 minutes earlier), so the spec's one-request branch is the correct one. |
| 8 | Mobile action sheet on a carry block | **PASS** | 570px same-origin iframe: `contentWindow.innerWidth = 566`, `[data-branch="mobile"]` measured 519px, `[data-branch="desktop"]` measured **0** — real media-query layout; mobile nav read `Tasks`, day summary `Sunday · weekend`, rails hour-only (`SHOW 07 – 08`). `Fill my week` is absent from the mobile header entirely, consistent with the D9 note at `Planner.tsx:931`. `Smoke P1b` re-seeded to 08:00–08:30 local (`12:00:00Z`–`12:30:00Z`) and rendered hollow with ` · unfinished` on the timeline. Tapping it opened the sheet with the button order **`Move to next open slot`, `Mark done`, `Unschedule`, `Cancel`** — exactly the spec order (plus the header `Close` affordance, which the spec does not enumerate). Tapped `Move to next open slot` at **10:07:00**: sheet closed (`[role="dialog"][data-state="open"]` count 0), toast verbatim `Moved to SUN 30, 10:30.` = `ceil15(10:07:00 + 10m)` ✓, block re-rendered solid at `Smoke P1b, 10:30–11:00`. |
| 9 | Done beats carry | **PASS** | `Smoke P2` scheduled at custom `09:00` (toast `Scheduled 09:00.`), rendering hollow as `Smoke P2, 09:00–10:00, unfinished`, height 50px for 60m, hover row `[→][✓][×]`. Clicked the done-check: accessible name `Smoke P2, 09:00–10:00, done`; computed `opacity: 0.72`; title span `rgb(148, 143, 158)` = `--ink-3` `#948f9e` with `text-decoration-line: line-through` and `text-decoration-color: rgb(148,143,158)`; visible range read plain `09:00–10:00` with **no** ` · unfinished`; hover row collapsed to `Mark not done`, `Unschedule` — **no** `Move to next open slot` ✓. Mobile sheet (same iframe) on that block listed `Mark not done`, `Unschedule`, `Cancel` — `Move to next open slot` absent ✓. Tapped `Mark not done`: block returned to `Smoke P2, 09:00–10:00, unfinished`, `dashed dashed dashed solid`, `color(srgb 1 1 1 / 0.55)`, title back to `--ink-2`, and the desktop hover row in the **parent tab** showed `Move to next open slot`, `Mark done`, `Unschedule` again — i.e. the un-complete propagated across the realtime channel to the other branch ✓. |
| 10 | Console clean | **PASS (for every check that ran)** | Page-world `console.error` wrapper installed by appending a `<script>` element, counting into `body[data-smoke-errors]`; self-tested with a page-world `console.error('SMOKE-WRAPPER-SELFTEST')` (counter 1, message captured) then reset. A second wrapper installed in the iframe's own document and self-tested the same way (`IFRAME-SELFTEST`). Counter read after every check: **fixtures 0 · check 5 observation 0 · check 6 0 · check 7 0 · check 8 0 (iframe) / 0 (parent) · check 9 0**. No React conflicting-style warning, no `validateDOMNesting`, no Supabase error text in any toast. |

**Console counter, per check:** 1–4 n/a (blocked, no interaction) · 5 `0` · 6 `0` ·
7 `0` · 8 `0` iframe + `0` parent · 9 `0` · 10 `0`.

## The spec's expectation was wrong, not the code (2 items)

1. **Check 7's "last Friday" is only correct Mon–Fri.** On a Sunday run, week 35
   is Aug 24–30 and last Friday (Aug 28) is *inside* it, so "move to last Friday,
   then navigate to the previous week" cannot produce a block on the previous
   week's grid. The invariant under test is "a carry block on a week before the
   current one", not the literal Friday. **Amend the spec** to "the Friday of the
   previous week" (computed, not `now - 2d`).
2. **Check 6/9's ` · unfinished` is not visible on a 30m block.** At 24px the
   range span is suppressed and only the title renders; the suffix is carried on
   the accessible name. Check 6 as written ("range suffix ` · unfinished`") reads
   as a visible-text assertion. The 60m `Smoke P2` in check 9 *does* show the
   visible range, which is why the same wording is testable there. **Amend check
   6** to assert the accessible name, or specify an estimate ≥45m.

Not a spec error but worth recording: **chunk-37 check 15's residual is gone.**
The React "Updating a style property during rerender (textDecoration) when a
conflicting property is set (textDecorationColor)" warning did not reproduce on
any done-toggle this run (counter stayed 0 across two toggles in both branches).
`TaskBlock.tsx:158-159` now sets `textDecorationLine` alongside
`textDecorationColor` rather than the shorthand.

## Deviations from the spec

1. **Checks 1–5 not run.** `fillable` requires `todayIdx <= 4`; the run date is
   Sunday. See check 1's row for the citation. The precondition in both the
   chunk-38 prompt (§0.1) and the spec's data-setup line was checked and reported
   before the run; the run proceeded on the carryover half at the operator's
   direction.
2. **Check 7 adapted** to the previous week's Friday (Aug 21) — see above.
3. **`Smoke Busy` not created.** Needed only for check 1's packing constraint.
   No iCloud event exists and none needs hand-deleting.
4. **Fixtures via PostgREST**, not the Dashboard UI (the chunk-37 method); task
   creation itself was not exercised. Tray grouping verified in the UI.
5. **Second tab (check 3's realtime line) not opened** — check 3 is blocked.
   Cross-branch realtime was nonetheless observed in check 9, where an
   un-complete performed in the iframe re-rendered the parent tab's desktop grid.

## Harness notes for the next pass

- **The hover action row lands one tick late, exactly like the drop preview.**
  Dispatching `pointerenter` + `mouseover` + `mouseenter` and reading
  `button[aria-label="Move to next open slot"]` in the *same* call returns
  nothing; the buttons are present on the next call. One attempt this run failed
  this way and looked like a missing feature. Dispatch hover in one call, read or
  click in the next — same rule CLAUDE.md already gives for `[data-testid="drop-slot"]`.
- **`Control Chrome`'s `execute_javascript` does not await promises.** It returns
  `"JavaScript executed"` and discards the value for an `async` IIFE. Every
  PostgREST call has to write its result into a hidden DOM node and be read back
  on the following call. (This session used the local `Control Chrome` MCP, not
  the Chrome MCP the earlier chunks used; DOM behaviour was otherwise identical,
  including the isolated-world constraint.)
- **Use a second sink node.** The toast `MutationObserver` and the PostgREST
  reader both writing to one hidden element silently clobbers query results with
  toast text. Two nodes.
- **The Supabase access token expires mid-run.** A captured `Authorization`
  header goes stale (`PGRST303 JWT expired`) after ~10 minutes. Read
  `localStorage['sb-dctfspcbkqvvyptddtif-auth-token'].access_token` fresh per
  request instead of caching the header; the `apikey` is the anon key and is
  stable.
- **The carry block's border is not uniformly dashed.** Computed `border-style`
  is `dashed dashed dashed solid` — the 3px category rail on the left edge stays
  solid at 45% mix (`TaskBlock.tsx:142`). Assert the shorthand, not `=== 'dashed'`.
- **The title colour lives on the inner `span.min-w-0`,** not the block element
  or its first child `div` (which is the flex wrapper and reports `--ink`).
  Selecting `b.querySelector('span,div,p')` reads the wrapper and produces a
  false `--ink-2` failure.
- **`Fill my week` is only rendered when `proposals.length === 0`**
  (`Planner.tsx:962`), and is absent from the mobile branch entirely. A future
  pass asserting "the button disappears" (check 1) should distinguish
  *unmounted-because-proposals-exist* from *absent-because-mobile*.

## Cleanup / end state

- All four `Smoke *` tasks deleted (`204` each); scheduled blocks cascaded.
- `select count(*) from public.scheduled_blocks` = **0**, matching the pre-smoke
  baseline.
- `tasks?title=like.Smoke*` returns `[]`.
- `tasks?updated_at=gte.<run start>` over the whole run returned **only** the
  four `Smoke *` rows — **no real task was created, completed, reprioritized or
  otherwise modified**, and nothing needs restoring.
- No calendar event created; nothing to delete in Calendar.app.
- Iframe removed and the page reloaded to discard both injected wrappers, the
  observers and the sink nodes.

---

# Re-run (checks 1–5, 2026-08-30)

**Needs manual deletion:** the **chunk-37** `Smoke Busy` (uid
`25d58a32-2ea6-4cec-9fab-46a5beeee1f6`, WED Sep 2 10:00–11:00 local) is **still
on iCloud** — it renders on WEEK 36 and holds WED Sep 2 at `8h free` instead of
`9h`. The first run never checked precondition §0.5 and its header line "No
manual deletion required" is therefore too broad — it was true only of the event
that run created (none), not of this pre-existing one. The operator must
delete it in Calendar.app before any run that uses week 36, or check 1's packing
derivation there will be wrong. **No new calendar event was created by this
re-run.**

Run 2026-08-30 (Sunday) ~10:15–10:25 ET against local dev
`http://localhost:5173/dashboard/`, signed in as smrios07@gmail.com.
Code under test `486dfe6`; working HEAD `6cbd44a` (the first-run results commit).
Tree: only the pre-existing `?? _to_delete/`.
DB baseline `select count(*) from public.scheduled_blocks` = **0**; end = **0**.
Tray hygiene `tasks?completed_at=is.null&priority=in.(1,2)` = `[]` before and
after — no strays, nothing reprioritized.

## Preconditions: 2 of 5 failed

- **§0.1 day-of-week — FAILED.** The re-run fired 25 minutes after the first run
  ended; it is still **Sunday Aug 30**, `todayIdx = 6` for the current week.
- **§0.5 leftover `Smoke Busy` — FAILED.** See the deletion notice above.
- §0.3 first-run results commit: already committed as `6cbd44a`, but **not
  pushed** — the device shell has no GitHub credentials (`no gh`, no
  `credential.helper`, no `GITHUB_TOKEN`, no `.git-credentials`), so
  `git push` fails with `could not read Username for 'https://github.com'`.
  The operator must push from their own terminal.

## What made a partial run possible anyway

`fillable` is `todayIdx <= 4` (`Planner.tsx:774-776`). `todayIndex` is documented
at `plannerGeometry.ts:150` as *"May be negative or > 6 when today falls
outside that week"*, so for a **future** week today is *before* the week start and
`todayIdx` is **negative** — which passes `<= 4`. `autoFill`'s docblock
(`plannerSchedule.ts:243-249`) confirms the intent: *"A weekend (`todayIdx >= 5`)
or past week (`todayIdx > 6`) yields `[]`; **a future week starts at Monday**"*,
and the loop is `for (let d = Math.max(todayIdx, 0); d < 5; d++)`
(`plannerSchedule.ts:265`).

So checks 1–4 were run **on WEEK 36 (Aug 31 – Sep 6)** as a *future-week
variant*, and check 5 was run in full. **This is not a substitute for check 1.**
The variant exercises the bar, proposal previews, packing order, tray dimming,
`Place all`, `Clear`, realtime and the drag-clears path — but the branch it
takes is `dayCursor` = Monday 09:00, **not** the today-relative branch
(`max(09:00, ceil15(now + 10))`, today's occupancy, spill-to-tomorrow, and
`Smoke Busy` avoidance). **Those remain untested and still require a Mon–Thu run.**

## Fixtures

Same shape and order as the first run, Work/General
(`396b54ec-4090-49b4-843f-0799b5cd6f0a`), via PostgREST:

| Task | id | priority | est | due |
|---|---|---|---|---|
| `Smoke P1a` | `84430203-f8e4-4ba5-8295-067363d93be9` | 1 | 45m | today 17:00 |
| `Smoke P1b` | `27bc897f-3bc3-48b1-b698-e9dc33040324` | 1 | 30m | null |
| `Smoke P2`  | `a66a50d3-53e2-45c1-a2a0-8cb0d63f82ab` | 2 | 60m | null |
| `Smoke P3`  | `745b9586-a3e2-49a3-a4da-55c436656120` | 3 | 30m | null |

**Week 36 pre-fill state:** header `0m planned · 43h free`; MON 31 `9h free`,
TUE 1 `8h free` (`Rent Due`), WED 2 `8h free` (the stale `Smoke Busy`), THU 3
`9h free`, FRI 4 `9h free`, SAT/SUN `—`. Σ weekday = 43h ✓. Tray cards all
`opacity: 1`, `Smoke P1a` showing `Due Sun 30`.

**Derived packing** (MON empty 09:00–18:00, cursor = Monday 09:00, sort
`compareTasks('priority')` = P1a due-today → P1b → P2):
P1a `09:00–09:45` · P1b `09:45–10:15` · P2 `10:15–11:15` · total `2h 15m`.

## Results

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Fill my week | **PASS (future-week variant — see caveat above)** | Button enabled on week 36 (`disabled` absent, `opacity: 1`) — the direct contrast with the current week, where it is `disabled`/`0.5` with the identical tray, isolating `todayIdx` as the only difference. Clicked: button **unmounted** (the `proposals.length === 0` path at `Planner.tsx:962`, on the desktop branch). Bar text verbatim: `3 proposals · 2h 15m` + `P1–P2 tasks into the earliest open weekday slots.` with `Place all` / `Clear`. Three `[data-testid="proposal-block"]`, all `border-style: dashed`, all in the MON column (`x = 412`), ordered by `y`: `Smoke P1a` (y 417, h **37**) → `Smoke P1b` (y 456, h **24**) → `Smoke P2` (y 482, h **50**) — **observed = derived, exactly**. `[data-testid="tray-proposed"]` read `→ MON 09:00`, `→ MON 09:45`, `→ MON 10:15`, matching each preview. Tray: the three cards at computed `opacity: 0.6` with the arrow replacing the due text; `Smoke P3` untouched at `opacity: 1`, no arrow. **Capacity unchanged to the minute**: `0m planned · 43h free` and every day header identical to pre-fill. `scheduled_blocks` unchanged (0). ⚠️ **One prompt expectation was wrong** — see "Spec/prompt expectations" below: the 45m (37px) preview is **title-only**, not `HH:MM–HH:MM · proposed`. |
| 2 | Clear | **PASS** | Bar gone, zero `proposal-block`, zero `tray-proposed`; all four tray cards back to `opacity: 1` with due text restored (`Smoke P1a` → `Due Sun 30`); `Fill my week` remounted and **enabled**. Capacity still `0m planned · 43h free`. No DB write. |
| 3 | Place all | **PASS** | Second signed-in tab opened on the same week (week nav is not URL-persisted, so tab B was navigated to week 36 by hand). Toast verbatim: **`3 tasks placed.`** Bar gone. Three `task-block`s with accessible names matching the proposals exactly — `Smoke P1a, 09:00–09:45`, `Smoke P1b, 09:45–10:15`, `Smoke P2, 10:15–11:15` — same heights (37/24/50) and column. Tray reduced to `Smoke P3` alone. DB +3 rows, `start_at`/`end_at` = `2026-08-31T13:00:00Z`–`13:45Z`, `13:45Z`–`14:15Z`, `14:15Z`–`15:15Z` = the local slots at UTC−4 ✓. Header `0m planned · 43h free` → **`2h 15m planned · 40h 45m free`** (planned +2h15m, free −2h15m); MON 31 `9h free` → **`6h 45m free`**, other days unchanged — all three land inside 09–18. Tab B (40ms interval observer): 3 blocks present **1008 ms** after the `Place all` click (click ts `1788099542443` → observed ts `1788099543451`), with identical capacity figures. |
| 4 | Proposals cleared by a manual drag | **PASS** | The three blocks unscheduled first via hover `×`, each with toast verbatim `Returned to tray.` (ts 1788099582894 / 1788099589994 / 1788099598149), DB back to 0. `Fill my week` → bar present. Synthesized drag of the `Smoke P3` tray card from (166, 556) toward MON 14:00 at (440, 677): `window.scrollY === 0` asserted and `getBoundingClientRect()` re-read immediately before dispatch (grid at x 352 / y 363 / 885×573); `pointerdown` + **14** `pointermove`s in one call, `pointerup` in a separate call. **Read after the moves, before `pointerup`:** bar **unmounted**, `proposal-block` count **0**, `tray-proposed` count **0**, `Smoke P1a`/`P1b`/`P2` back to `opacity: 1` — and `[data-testid="drop-slot"]` present reading **`14:00–14:30`** (the dragged P3 card itself at `opacity: 0.45`). Then `pointerup` → toast verbatim **`Placed MON 14:00.`**, block `Smoke P3, 14:00–14:30`. **Console counter 0 at drag start and 0 at drop** — the chunk-37 `PlannerTray` residual does not reproduce. Unscheduled afterwards. |
| 5 | Button disabled states | **PASS (both halves discriminating)** | **(a)** Past week WEEK 34 (Aug 17–23): `disabled` attribute **present**, `opacity: 0.5` — `todayIdx > 6`. Future week WEEK 36: **enabled**, `opacity: 1`, and clicking it produced proposals starting at that week's **Monday 09:00** exactly as the prompt predicts; `Clear` afterwards. Current week WEEK 35 (`todayIdx = 6`): disabled — the Sunday case, recorded for completeness. **(b)** `Smoke P1a`/`P1b`/`P2` completed **on the Dashboard** using the nearest-ancestor method (all four rows resolved a single `button[aria-label^="Mark task"]` at depth 1; each click logged `Mark task complete`). Returning to the Planner on week 36 with only `Smoke P3` open: `Fill my week` **`disabled`, `opacity: 0.5`** — the same week that was enabled minutes earlier, so the tray predicate is isolated. Un-completing the three re-enabled it (`disabled: false`, `opacity: 1`) with all four cards back. Audit `tasks?updated_at=gte.<run start>` returned **only** the four `Smoke *` rows before and after ✓. *(The un-complete was done via PostgREST rather than the Dashboard checkbox — the Dashboard path was already exercised in the complete direction, and chunk-37's 5r proved the trigger mirrors both ways.)* |

**Console counter, per check:** setup/fixtures `0` · check 1 `0` · check 2 `0` ·
check 3 `0` · **check 4 drag start `0`, drop `0`** · check 5(a) `0` ·
check 5(b) `0`. Page-world wrapper installed by appended `<script>`, self-tested
with `SELFTEST-RERUN` (counter 1, message captured) then reset. No React
conflicting-style warning, no `validateDOMNesting`, no Supabase error text in any
toast.

## Spec/prompt expectations that were wrong, not the code

3. **The 45m proposal preview is title-only.** The re-run prompt asserts
   `HH:MM–HH:MM · proposed` "on the 45m and 60m previews (37px / 50px)". The
   threshold is **40px**: `ProposalBlock.tsx:58` is `{pos.height >= 40 && (`,
   documented at `ProposalBlock.tsx:9` as *"with the title and, at ≥40px,
   `HH:MM–HH:MM · proposed`"*, and asserted by the unit test
   `WeekGrid.test.tsx:356` — *"renders a proposal preview with title and
   '· proposed' at ≥40px"*. A 45m block is 37px, so title-only is correct.
   **Amend the prompt** to expect the range on the 60m preview only.

(Items 1 and 2 are in the first run's section above — check 7's "last Friday"
and check 6's visible ` · unfinished`. All three are for chunk 39's Task 0.)

## New harness notes

- **A future week is the way to exercise `Fill my week` off-schedule.** `todayIdx`
  is negative there, so `fillable` passes and `autoFill` starts at Monday 09:00.
  Any future smoke that needs the fill machinery but cannot run Mon–Thu should
  use week +1 and record it as a variant — it does **not** cover the
  today-relative cursor.
- **`proposal-block` elements are `aria-hidden`** (`ProposalBlock.tsx:9`), so
  `getAttribute('aria-label')` is `null`. Assert their `innerText` and geometry,
  not accessible names — unlike `task-block`, which does carry one.
- **Unscheduling N blocks needs 2 calls each.** The hover-then-read rule means
  hover block[0] → click its `×` → re-query → hover the new block[0] → … Clicking
  one `×` re-renders and drops the hover state of the others.
- The tab-B realtime figure landed at **1008 ms**, right on the spec's "~1s"
  boundary (chunk 37 measured 796 ms for a single-row unschedule). A future spec
  should state a bound rather than "~1s" if this is meant to be a hard assertion.

## Cleanup / end state

- All four `Smoke *` tasks deleted (`204` each); blocks cascaded.
- `scheduled_blocks` = **0**, matching baseline. `tasks?title=like.Smoke*` = `[]`.
- `tasks?updated_at=gte.<run start>` = `[]` after cleanup — **no real task was
  created, completed, reprioritized or otherwise modified**, nothing to restore.
- Tab B closed; tab A reloaded to discard the page-world wrapper, the observers
  and both sink nodes.
- No calendar event created by this re-run. The chunk-37 `Smoke Busy` still needs
  hand-deleting (top of this section).
