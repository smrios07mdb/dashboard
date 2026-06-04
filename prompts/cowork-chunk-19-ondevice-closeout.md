# Cowork handoff — Chunk 19 on-device close-out

**Why this exists:** the prior chat's question UI broke. This file carries the
state + the exact remaining edits so the work can finish in a fresh conversation.
Everything below is verified, not assumed.

## Verified state (as of handoff)

- Branch `main`, `HEAD == origin/main == b04ed99`, working tree clean
  (only untracked file is `prompts/` docs like this one).
- Recent history:
  - `b04ed99` docs(progress): chunk 19 — note Part-A steps 5–6 pending on-device + track Day-7 zoom outliers
  - `49d3e74` docs(architecture): record 16px-input + viewport-fit/safe-area UI rules in §13
  - `db8b5dd` docs(progress): chunk 19 row + decisions log
  - `1aa447c` feat(mobile): chunk 19 — bottom-nav + touch & viewport polish (UX-01..04) (#6)  ← the app commit
- `PROGRESS.md` row 19: ☑, SHA `1aa447c (#6)`, Review-note currently ends with the
  on-device PENDING caveat ("…two focus-zoom outliers tracked for Day-7.").
- `PROGRESS.md` "Open questions for Cowork review" has 2 chunk-19 bullets
  (on-device gate; two zoom outliers).

## What the user (Sergio) confirmed on his iPhone

1. **In-scope no-zoom (Part-A step 5):** task title, + New task, and dashboard
   "I have ___ min" inputs — **no Safari zoom on focus. PASS.**
2. **Header notch clearance (Part-A step 6, header half):** installed PWA, header
   clears the notch / Dynamic Island in portrait and landscape. **PASS.**
3. **InstallHint banner:** appears correctly at top in Safari, clears the status
   bar. **PASS.** (Banner only renders in Safari, never standalone — that's by
   design per `src/components/InstallHint.tsx:32-37`; the "banner in installed PWA"
   combination from the original prompt is unreachable and was noted as such.)
4. **The two known outliers:** subcategory-rename field (`text-[14px]`) and the
   What's-Next minutes field (`text-[13px]`) — **DID zoom on focus, bug confirmed
   on-device** ("It happened"). These match the deployed CSS prediction.

Net: the on-device gate is satisfied. Steps 5 and 6 pass for everything in scope;
the only fails are the two already-known, already-tracked Day-7 outliers.

## Remaining edits (docs-only, PROGRESS.md; no code, no §13, no Decisions log, no SHA change)

### Edit 1 — row 19: replace the PENDING caveat with a PASS note
Find the end of row 19's Review-note (the line starting `| 19 | Audit: mobile bottom-nav`).
It currently ends with:

> … — On-device (Part-A steps 5–6) PENDING: iOS focus-zoom and notch/InstallHint clearance are verified in the deployed bundle (index-BLFnZ01F.css: text-base=16px, before:size-11, pt/pb-[env(safe-area-inset-*)], @media(width>=640px){sm:hidden/sm:flex}) and viewport-fit=cover is live, but NOT yet confirmed visually on a real iPhone; two focus-zoom outliers tracked for Day-7.

Replace that appended sentence (from " — On-device (Part-A steps 5–6) PENDING:" to the end of the cell, before the closing ` |`) with:

> — On-device (Part-A steps 5–6) CONFIRMED on a real iPhone 2026-05-31 (Sergio): no Safari focus-zoom on the three in-scope inputs (task title, add-task, dashboard minutes); installed-PWA header clears the notch/Dynamic Island in portrait + landscape; InstallHint banner clears the status bar in Safari (banner is Safari-only by design — unreachable in standalone). The two 16px-override outliers (`SubcategoryHeader` rename `text-[14px]`, What's-Next minutes `text-[13px]`) reproduced the zoom on-device → moved to Revisions as Day-7 fixes.

Status stays ☑. SHA stays `1aa447c (#6)`.

### Edit 2 — Open questions section: resolve the 2 chunk-19 bullets
The two bullets currently read (verbatim):

> - Chunk 19 — on-device confirmation outstanding. Run Part-A steps 5–6 on a real iPhone (PWA installed, fresh/cleared profile so InstallHint renders): (a) no Safari focus-zoom on inline-edit, add-task, and dashboard inputs; (b) AppShell header AND the InstallHint top banner both clear the notch/Dynamic Island. Code is bundle-verified; this is the visual-on-device gate.
> - Chunk 19 — two focus-zoom outliers flagged during verification. Repro/confirm on-device during Day-7 lived-use; each fix ships as its own mini-prompt + PR (logged under Revisions).

Replace bullet 1 with (strikethrough = resolved, matching the file's existing `~~…~~ **Resolved**` convention used elsewhere in this section):

> - ~~Chunk 19 — on-device confirmation outstanding. Run Part-A steps 5–6 on a real iPhone…~~ **Resolved 2026-05-31 (on-device, Sergio):** steps 5–6 pass — no focus-zoom on the three in-scope inputs; header clears the notch portrait + landscape; InstallHint banner clears the status bar in Safari (Safari-only by design).

Replace bullet 2 with:

> - ~~Chunk 19 — two focus-zoom outliers flagged during verification.~~ **Confirmed on-device 2026-05-31:** `SubcategoryHeader` rename (`text-[14px]`) and What's-Next minutes (`text-[13px]`) both zoom on focus → seeded as Day-7 Revisions mini-prompts (each gets its own PR adding the `text-base sm:text-[…]` mobile override, mirroring chunk-19 UX-03).

### Edit 3 — Day-7 backlog (optional but recommended)
In `## Revisions` → "Day-7 lived-use revision backlog (seeded 2026-05-30)" (numbered
list), append one item so the outliers are tracked where Day-7 work is picked up:

> N. **Chunk-19 focus-zoom outliers.** Add the mobile `text-base` (≥16px) override (compact at `sm:`) to the `SubcategoryHeader` rename input (`src/components/SubcategoryHeader.tsx`, currently `text-[14px]`) and the What's-Next available-minutes input (`src/components/WhatsNextSheet.tsx`, currently `text-[13px]`). Confirmed zooming on iOS Safari on-device 2026-05-31. Mirror the chunk-19 UX-03 pattern; one PR each or one combined.

(Use the next number in that list — read it first; don't guess the index.)

## Commit (Sergio runs in terminal — sandbox can't push; clear the stale lock first)

```bash
cd "/Users/sergiorios/Documents/To-Do Dashboard"
rm -f .git/index.lock
git add PROGRESS.md
git commit -m "docs(progress): chunk 19 — on-device steps 5-6 confirmed pass; two zoom outliers seeded for Day-7"
git push
```

## Guardrails for the next session
- Read each anchor string from the live file before editing — do not paste from
  memory. (Prior chat repeatedly failed edits by guessing anchor text.)
- PROGRESS.md only. Do NOT touch ARCHITECTURE.md §13, the Decisions log, or row 19's SHA.
- Status stays ☑ (it shipped + deployed + now device-verified).
- The sandbox has no git creds and leaves a stale `.git/index.lock`; all commits
  are run by Sergio in his terminal.
- The GitHub connector is read-only (merges/commits via connector 403). Not needed
  here — this is a local-file + Sergio-commits flow.
