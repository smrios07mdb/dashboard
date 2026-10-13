# Chunk 63: A task drop counts only where the pointer is (Day-7 #4)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). App code only: no SQL, no migration, no proxy.

**Bases:**
- App `smrios07mdb/dashboard` @ `4a61a15` (docs). Last code commit `da1e557` (chunk 62), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md` (incl. "Smoke harness notes"), `src/components/CategoryColumn.tsx`, `src/screens/CategoryView.tsx` (`handleDragEnd` ≈ line 501, the `DndContext` ≈ line 578), the `useDroppable` in `src/components/SubcategoryHeader.tsx` (≈ line 118), the `useDraggable` in `src/components/TaskRow.tsx` (≈ line 203), ARCHITECTURE §13 "Drag affordance", and the PROGRESS Open-questions row "(chunk 9 → chunk 16 polish candidate) Cross-category drag…" first.

**Scope:** PROGRESS Revisions → Day-7 backlog item **4** (cross-category drag fall-back). It also closes that Open-questions row.

---

## The defect, as committed at `4a61a15`

Each Dashboard `CategoryColumn` mounts its own `DndContext`, so a Work task's drag only ever sees Work's droppables: the `subdrop:<id>` header droppables (`SubcategoryHeader`) and the `useSortable` subcategory sections (raw ids). Neither `DndContext` (CategoryColumn or CategoryView) passes `collisionDetection`. The default in `@dnd-kit/core` 6.3.1 is therefore `rectIntersection`, which picks the droppable that overlaps most with **the dragged row's rect**, not the pointer. (PROGRESS item 4 already corrects the old `closestCenter` wording.)

The dragged row is as wide as its column. When the pointer crosses into the Personal column, the translated row still overlaps Work's right-hand side, and `rectIntersection` returns a Work header. The orchestrator reproduced this against the real `rectIntersection` with synthetic rects:
- Work column `x 0–500`; header A `y 0–40`, section A `y 0–200`; header B `y 200–240`, section B `y 200–400`.
- Dragged row at `left 450, top 205` (500×30); pointer at `(700, 220)`, inside Personal.
- Result: `["subdrop:B", "B"]`. `handleDragEnd` moves the task into Work list B: a drop the user aimed at Personal lands in a Work list they never pointed at.

The same rect logic can light up and accept a header the pointer is not on inside one column, on the Dashboard and in the CategoryView drill-down.

Baseline (orchestrator, `da1e557` = `4a61a15` code, fresh clone, Node 22, clean `npm ci`): `vitest run` **805 / 805** (72 files), build green, eager JS **1,024,973 B**.

---

## Locked decisions

### D1 One collision function: `src/lib/taskDragCollision.ts` (new)

```ts
import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core'

/** `useDraggable` ids for tasks are `task:<uuid>` (TaskRow). */
export function isTaskDragId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('task:')
}

/**
 * Task drags (chunk 63, Day-7 #4): a drop counts only when the POINTER is
 * inside a subcategory header (`subdrop:<id>`, SubcategoryHeader). Anywhere
 * else — the other category's column, a section body, a gap — resolves to no
 * target, so the drop is a no-op and the row returns. Other drags (the
 * subcategory sortable reorder) keep `rectIntersection`, the dnd-kit default
 * they have always used.
 */
export const taskDragCollision: CollisionDetection = (args) => {
  if (!isTaskDragId(args.active.id)) return rectIntersection(args)
  return pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      String(c.id).startsWith('subdrop:'),
    ),
  })
}
```

- `rectIntersection` for non-task drags is written out explicitly so the subcategory reorder is byte-for-byte the behaviour it has today. Do not swap it for `closestCenter` or anything else.
- No pointer coordinates (no sensor here provides drags without them) → `pointerWithin` returns `[]` → no-op. That is the safe outcome.

### D2 Wire it into both task-drag contexts

- `src/components/CategoryColumn.tsx`: `<DndContext sensors={sensors} collisionDetection={taskDragCollision} onDragEnd={handleDragEnd}>`. Delete the local `isTaskDragId` and import it from `@/lib/taskDragCollision`.
- `src/screens/CategoryView.tsx`: the same two edits.
- `RoutinePanel` is untouched (no task drags).

### D3 What does not change

- Both `handleDragEnd` bodies, including the `target?.type === 'subcategory'` and `targetSubId !== currentSubId` guards.
- The per-column `DndContext` structure: no shared context and no cross-category drag on the Dashboard. A task changes category only through the ⋯ menu's Move to… picker, as ARCH §13 already says for touch.
- Sensors, activation constraints, `SubcategoryHeader`'s droppable id and data, `TaskRow`'s draggable id and data, styling, the `isOver` ring.
- No new dependency; `package.json` / `package-lock.json` unchanged. No Dexie, repo, realtime or migration change.

### D4 Tests

**`src/lib/taskDragCollision.test.ts` (new)** — pure, against the real `@dnd-kit/core`. Build `droppableRects` (a `Map`) and `droppableContainers` (`{ id, key, data: { current }, rect: { current }, disabled: false, node: { current: null } }`) from the four synthetic rects in "The defect" above, and cast the args `as never` where the type needs it.

1. **The bug, pinned.** Row at `left 450, top 205` (500×30), pointer `(700, 220)`. `rectIntersection` returns `subdrop:B` first (assert it: it documents the defect), and `taskDragCollision` returns `[]`.
2. **Pointer on a header.** Pointer `(300, 220)` → `taskDragCollision` returns exactly `['subdrop:B']`. The sortable section `B` is not returned even though the pointer is inside it too.
3. **Pointer on a section body.** Pointer `(200, 310)` (inside section B, below its header) → `[]`.
4. **Subcategory reorder unchanged.** Active id `'A'`: `taskDragCollision(args)` deep-equals `rectIntersection(args)` for the same args.
5. **No pointer.** `pointerCoordinates: null` with a task active → `[]`.
6. **`isTaskDragId`.** `'task:x'` → true; `'subdrop:x'`, `'x'`, `undefined` → false.

**Wiring (one test each):** in `src/screens/Dashboard.test.tsx` and `src/screens/CategoryView.test.tsx`, mock `@dnd-kit/core` with `importOriginal`, replacing only `DndContext` with a pass-through that records `props.collisionDetection` and renders the original. Assert that every recorded value is `taskDragCollision`, and that at least one was recorded (Dashboard: one per rendered column). Follow each file's existing `vi.mock` pattern; touch no existing test.

**Red-first:** run the two wiring tests against `4a61a15`'s `CategoryColumn.tsx` and `CategoryView.tsx` (keep the new lib and tests) and report the failing lines. Report what `taskDragCollision.test.ts` does against `4a61a15` (the module does not exist there, so the file cannot collect: say so).

### D5 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`** (`dist/` changes): `src/lib/taskDragCollision.ts`, `src/lib/taskDragCollision.test.ts`, `src/components/CategoryColumn.tsx`, `src/screens/CategoryView.tsx`, `src/screens/Dashboard.test.tsx`, `src/screens/CategoryView.test.tsx`. Subject: `Chunk 63: task drops resolve by pointer, cross-category drop is a no-op (Day-7 #4)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green (805 + the new tests — exact test and file count); `npm run build` green.
- Eager JS before (at `4a61a15`) and after, on your machine. Limit **+10 kB** (expect a few hundred bytes: both collision functions already ship inside `@dnd-kit/core`).
- After the push: deploy run id and result; live `version.json` read cache-busted.

---

## Sequence

### 1. Code (D1–D5)

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

Expect `4a61a15`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record that eager-JS figure as the base. Make the D1–D2 edits and the D4 tests. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 4a61a15 -- package.json package-lock.json
grep -rn "function isTaskDragId" src
git add src/lib/taskDragCollision.ts src/lib/taskDragCollision.test.ts src/components/CategoryColumn.tsx src/screens/CategoryView.tsx src/screens/Dashboard.test.tsx src/screens/CategoryView.test.tsx
git status --short
git commit
git push origin main
```

`grep -rn "function isTaskDragId" src` must return exactly one hit, in `src/lib/taskDragCollision.ts`. The commit body lists D1–D3 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`. `git status --short` must show nothing else staged; anything unexpected, stop and report.

**Stop after the push and report.** Do not start step 3.

### 2. Smoke

The orchestrator runs this on the deployed app in Sergio's Chrome, at desktop width (columns side by side). **Not you.**

It uses synthesized pointer drags per `CLAUDE.md` "Smoke harness notes" on one throwaway `Smoke-63` task created through the UI in a Work list, and checks `tasks.subcategory_id` by REST after each drop:
- Pointer released over a Personal header → no move.
- Pointer released just inside the Personal column, where the row still overlaps a Work header (the bug's geometry) → no move.
- Pointer released over a Work section body → no move.
- Pointer released over another Work header → moves there.

Console clean throughout. The subcategory reorder is not exercised live (it would reorder your real lists); D4 test 4 covers it. The smoke task is deleted afterwards.

### 3. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md` §13 "Drag affordance":** after "Cross-subcategory drag enabled on Dashboard and Category drill-down (desktop only).", add:
- **Drop target (chunk 63):** a task drop counts only when the pointer is inside a subcategory header (`taskDragCollision`: `pointerWithin` over `subdrop:` droppables). Anywhere else, including the other category's column, is a no-op.
- **Changing category:** each Dashboard column is its own `DndContext`, so a task moves across categories only through Move to…; the subcategory reorder keeps `rectIntersection`.

**`PROGRESS.md`**
- Row 63 ☑: the step-1 SHA, gates, red-first lines, test count and file count, eager JS before/after, deploy run, live `version.json`, the smoke result, deviations numbered.
- Day-7 backlog: item 4 → ☑ with `(done: chunk 63, <SHA> — task drops resolve by pointer over subcategory headers; a cross-category drop is a no-op.)`; the status line becomes **7 done, 1 moot, 3 open** with the chunk-63 date.
- Open questions: strike the "(chunk 9 → chunk 16 polish candidate) Cross-category drag…" row's remaining text in the existing `~~…~~` style and append **Resolved 2026-10-13 (chunk 63, `<SHA>`)** with one sentence.
- Decisions log: D1–D3 (2026-10-13, chunk 63), one row each.
- Last-updated paragraph per the chunk-54 convention; the current chunk-62 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-63-cross-category-drag.md` in the same commit. A commit cannot carry its own SHA: if row 63 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- A shared Dashboard `DndContext` or any real cross-category drag.
- Day-7 items 9, 10, 11.
- Dropping onto a section body or a task row as a move target.
- Touch drag (grips are not rendered on touch; Move to… is the touch path).
- `RoutinePanel` and the Planner's native pointer drag.

## Report back

- **Step 1:** commit SHA; `git diff --stat 4a61a15 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count, build); red-first failing lines for the two wiring tests, and what `taskDragCollision.test.ts` does at `4a61a15`; the `isTaskDragId` grep; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Every deviation, numbered.
