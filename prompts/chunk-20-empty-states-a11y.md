# Chunk 20 — Audit: empty states + a11y completeness

**Goal:** Finish the first-run experience and close the screen-reader gaps the chunk-16 a11y pass left open. Two of these (the sync-indicator `aria-live` region and icon-button `aria-label`s) were chunk-16 acceptance criteria that slipped — this chunk completes them. This is the **last audit chunk**.
**Findings:** UX-05 (empty states), UX-06 (sync `aria-live`), UX-07 (chart labelling).
**Dependencies:** Chunks 6 (Dashboard), 16 (Insights + a11y pass).
**Effort:** ~2.5h.

> Read `ARCHITECTURE.md` first. The a11y bar is `ARCHITECTURE.md` §13 (UI rules) + the `DESIGN_BRIEF` **A11y** section (keyboard-reachable, visible 2px focus ring, `aria-label` where text isn't visible, focus-trapped dialogs, contrast ≥4.5:1). The empty-state visuals come from `DESIGN_NOTES` §3 (first-run). No gamification copy (`DESIGN_BRIEF`). If anything here disagrees with `ARCHITECTURE.md`, stop and surface it — don't silently pick one (`CLAUDE.md`).

This is the polish chunk — TDD the pure logic, then implement; the a11y-tree / VoiceOver behavior is acceptance-verified post-merge (Cowork Chrome MCP + Sergio on-device), not unit-tested.

---

## What to build

### 1. First-run / all-clear states — UX-05

`src/screens/Dashboard.tsx` currently renders bare columns when there's no data, so a brand-new or cache-cleared user lands on an empty grid with no guidance, and a user who has cleared all their tasks gets the same blankness. Add the two `DESIGN_NOTES` §3 states:

- **First-run** (the account has *never* had a task — no tasks across all subcategories, ever): a **dashed-border CTA card** guiding the user to add their first task. Match `DESIGN_NOTES` §3 styling and the brand tokens (`--primary` `#3a5a40`, `--background` `#faf8f3`, etc.).
- **All-clear** (tasks exist in the data, but none are currently outstanding/incomplete): the **jade "All clear" banner** per `DESIGN_NOTES` §3.
- Normal state (≥1 outstanding task) is unchanged.
- Copy is calm and non-gamified — no "Great job!", no streaks/celebration language (`DESIGN_BRIEF`).

The *selection* of which state to show (first-run vs all-clear vs normal) is pure logic — put it in a tested helper rather than inline JSX (see Tests).

**Files:**
```
src/lib/dashboardState.ts        (new — pure selector: tasks → 'first-run' | 'all-clear' | 'normal')
src/lib/dashboardState.test.ts   (new)
src/components/EmptyStateCard.tsx (new — the dashed-border first-run CTA)
src/components/AllClearBanner.tsx (new — the jade all-clear banner)
src/screens/Dashboard.tsx        (modify — render the selected state)
```

### 2. Sync-state announcements — UX-06

The sync indicator (`src/components/SyncIndicator.tsx`) has no `aria-live` region: its colored dot is `aria-hidden` and its text label is `hidden sm:inline`, so transitions between **offline / syncing / synced / sync_issues** are completely silent to screen readers (and invisible to SR users below the `sm` breakpoint).

- Wrap the status in an **`aria-live="polite"`** region that announces each transition with a concise text label (e.g. "Offline", "Syncing…", "Synced", "Sync issues"). The announced text must reach the a11y tree even when the visual label is `hidden sm:inline` — use an SR-only node if needed (`sr-only`, not `display:none`).
- Derive the announced label from sync state in a small pure function so it's unit-testable.
- **Leave `ReconnectBanner` alone** — it already announces correctly via the `role="alert"` Alert primitive. Do not duplicate its announcement.

**Files:**
```
src/lib/syncLabel.ts             (new — pure: SyncState → announced label string)
src/lib/syncLabel.test.ts        (new)
src/components/SyncIndicator.tsx (modify — add the aria-live region)
```

### 3. Chart labelling — UX-07

The recharts Insights chart (`src/screens/Insights.tsx`) is unlabeled in the a11y tree. A real semantic data-table fallback already ships beneath it, **but** that table is a per-subcategory aggregate, so per-day values are pointer-only (hover tooltip), and the chart itself exposes nothing to a screen reader. Color is also the only series differentiator.

- Add **`role="img"`** + a descriptive **`aria-label`** to the chart container, summarizing what's plotted and the active range (e.g. "Completed minutes per day, last 30 days, by subcategory"). Build the label string from the active filter range / category toggle in a pure function (unit-tested).
- Add **non-color legend cues** so series are distinguishable without relying on color alone — text labels and/or a shape/pattern marker per series (the brand uses green shades for Work and warm-neutral shades for Personal, which can be indistinguishable to colorblind users).
- **Keep the data-table fallback** exactly as-is.

**Files:**
```
src/lib/chartLabel.ts            (new — pure: {range, categoryFilter} → aria-label string)
src/lib/chartLabel.test.ts       (new)
src/screens/Insights.tsx         (modify — role="img" + aria-label on the chart container; non-color legend cues)
```

### Tests (TDD — write these first)

All pure, in Vitest:
- `dashboardState.test.ts`: returns `'first-run'` when no tasks have ever existed; `'all-clear'` when tasks exist but none are outstanding; `'normal'` when ≥1 outstanding task. Cover the boundary where all tasks are completed vs. all deleted.
- `syncLabel.test.ts`: each `SyncState` maps to its expected announced string.
- `chartLabel.test.ts`: label string reflects the 7/30/90 range and the All/Work/Personal filter.

The aria-live behavior, `role="img"` exposure, focus order, and VoiceOver narration are **acceptance-verified after merge** (Cowork Chrome MCP a11y-tree checks + Sergio's VoiceOver walkthrough) — they are not unit tests.

---

## Acceptance criteria

- A new / never-had-a-task account shows the first-run dashed-border CTA; an account with tasks but none outstanding shows the jade "All clear" banner; an account with outstanding tasks shows the normal dashboard.
- VoiceOver announces sync-state changes (offline → syncing → synced → sync_issues) via the `aria-live` region, including below the `sm` breakpoint.
- The Insights chart exposes `role="img"` + a descriptive label to the a11y tree; series are distinguishable without relying on color; the data-table fallback is unchanged.
- All new unit tests pass; `npm run build` + `npm test` green; deploy green.
- VoiceOver walkthrough of Dashboard + Insights is clean (post-merge, Sergio).

---

## Definition of done & handoff

- `npm run build` + `npm test` green; adversarial self-review. The **full** suite needs the Keychain-injected service-role key for the chunk-17 RLS tests (command in the run sequence Sergio runs) — your new tests don't need it, but the suite as a whole does.
- Push the branch; open the PR into `main` **on Sergio's go** (outward-facing — don't push/PR without it; same human gate as chunks 17 / 18 / 19). Sergio merges in the GitHub UI (merge-commit).
- **Do not edit `PROGRESS.md`** — it's the Cowork lane (`CLAUDE.md`). Hand back a ready-to-paste block for the post-merge Cowork task, keyed to the **on-main SHA** (the merge-commit SHA; if squash-merged, the new SHA):
  ```
  PROGRESS.md row 20 → ☑:
  | 20 | Audit: empty states + a11y completeness | dashboard | ☑ | Claude Code | <on-main-sha> | — | <one-line note of any deviation> |
  ```
- **Decisions log:** add an entry **only if** something deviated from `DESIGN_NOTES` §3 / the `DESIGN_BRIEF` A11y section / `ARCHITECTURE.md` §13 (per `CLAUDE.md`). Building the documented empty-state + a11y spec *as specified* is implementing existing spec, not a new decision — so expect **no** decisions-log entry unless, e.g., a state-selection rule or a legend technique departs from the spec. Note any such deviation in the row's Review-notes regardless.

## Do NOT touch

- `ReconnectBanner` (already correct — `role="alert"`).
- The chart's **data computation** (`src/lib/insights.ts` aggregation) — labelling only.
- The data / repo layer, RLS, the service worker, the CSP (Chunk 17), the sign-out / cache logic (Chunk 18), the mobile bottom-nav / touch-target / viewport work (Chunk 19).
- `PROGRESS.md` (Cowork's lane).

---
_Last audit chunk. After this, the audit remediation track (17–20) is complete._
