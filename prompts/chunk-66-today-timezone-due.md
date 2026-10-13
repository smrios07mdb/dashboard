# Chunk 66: Today runs on your Settings time zone, and tasks get due dates (Day-7 #11)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). App code only: no SQL, no migration (`tasks.due_at` already exists), no proxy.

**Bases:**
- App `smrios07mdb/dashboard` @ `262092e` (docs). Last code commit `cbf84d4` (chunk 65), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md`, `src/lib/today.ts`, `src/state/todayPlan.ts`, `src/lib/clock.ts`, `src/lib/userTimezone.ts`, `src/components/SetReminderPopover.tsx`, `src/components/PriorityPicker.tsx`, ARCHITECTURE §4 "Today marks" and §13 "Dashboard Today panel", and PROGRESS Day-7 item 11 first.

**Scope:** PROGRESS Revisions → Day-7 backlog item **11**.

---

## The defect, as committed at `262092e`

- `lib/today.ts` decides Overdue / Due today from `remindAt` only, in the **browser's** zone (`setHours(0,0,0,0)`). `dueAt` is never read.
- `state/todayPlan.ts` stamps `today_marks.day` with the browser-local day.
- Nothing in the app can set `dueAt`: every create path writes `dueAt: null`, and no screen has a due-date control. Only imports and sample data carry one.

Sergio's decisions (2026-10-13): "due today" comes from `dueAt` in the Settings time zone, and Today's day boundary moves to that zone too. Add a due-date picker. A reminder due today still counts.

The orchestrator built the whole change on a fresh clone of `262092e` (Node 22, clean `npm ci`, placeholder env except the real `VITE_CALDAV_PROXY_URL`). The patch below is that change, verbatim:
- Before: `vitest run` **837 / 837** (75 files), build green, eager JS **1,028,606 B**.
- After: `tsc -b` clean, `eslint .` 0 problems, `vitest run` **860 / 860** (76 files) with the runner in `America/New_York` **and** in `UTC`, build green, eager JS **1,031,971 B** (+3,365 B). `src/lib/iosFocusZoom.test.ts` passes with the new date input.
- `today.test.ts` and `todayPlan.test.ts` (51 tests) also pass with the runner in `Asia/Tokyo`.

---

## Locked decisions

### D1 The day frame is the Settings time zone

- `lib/today`'s `todayReason`, `autoTodayIds`, `resolveToday` and `reconcileTodayMembership` take a **required** `timeZone` argument (before the optional `now`). Days are computed with the new `clock.dateKeyIn(at, timeZone)`.
- `useTodayPlan(tasks, marks, writeMark, timeZone)`: the plan's day, every `today_marks.day` it writes, and the rollover check all use `timeZone`. A change of `timeZone` re-derives the auto plan (this session's toggles for the day are kept).
- The Dashboard passes the zone it already resolves for the streak (`settings.timezone`, default `'America/New_York'` until loaded or when unset), now also kept in state and handed to `useTodayPlan` and both `TodayPanel` mounts. The Today header date is formatted in that zone.
- The legacy `hup:todayPlan` read keeps the browser-local key (`localDayKey`): pre-chunk-64 builds dated that entry in that frame.
- Existing `today_marks` rows are not rewritten. Their `day` was browser-local; Sergio's browser and Settings zone are both New York, so they read the same.

### D2 The signals

Precedence unchanged: Overdue → Due today → Priority → (Pinned).
- **Overdue:** the due date's day (in the Settings zone) is before today, **or** the reminder instant has passed (unchanged).
- **Due today:** the due date's day is today, **or** the reminder falls later today (unchanged rule, now in the Settings zone).
- **Priority:** `priority === 1` (unchanged).
- A due date is a calendar day: its time of day never matters, so a due date never turns Overdue during its own day. An unparseable `dueAt` / `remindAt` is ignored.

### D3 The due-date picker

- New `src/components/SetDuePopover.tsx`: a native `<input type="date">` in a Popover, built on the SetReminderPopover pattern (reset-on-open, `loadUserTimezone`, input and Save disabled until the zone resolves, `Dates in <zone>` when it differs from the device's, Clear only when a due date is set). It stores **00:00 of the picked day in `settings.timezone`** as the ISO instant, and opens an existing `dueAt` on its day in that zone.
- Its only entry is TaskMenu → **Set due date…** (**Edit due date** when one is set), placed above the reminder item. TaskRow owns the open state; with no visible trigger the popover anchors to a zero-size span in a grid slot that exists only while it is open (PriorityPicker's menu-only idiom).
- `onSetTaskDue(id, dueAt | null)` is plumbed exactly like `onSetTaskReminder` — TaskRow `onSetDue`, SubcategorySection, CategoryColumn, and the handlers in Dashboard, CategoryView and SubcategoryView: `repo.tasks.update(id, { dueAt })`, toast `Due date set` / `Due date cleared`, `SAVE_ERROR` on failure.
- No due chip on the row, mirroring the reminder (the bell shows state, not the time). As with reminders and priority today, a due date set on an existing task joins the auto plan at the next load; in-place edits never re-derive membership.

### D4 What does not change

- Planner day/time math stays browser-local (ARCH §13); WhatsNext and PlannerTray due display, AI triage, export/import, `taskSort`.
- `clock.today()` and its DEV override; the streak's zone handling.
- No schema, Dexie, outbox, realtime or proxy change. No new dependency (`date-fns-tz` is already in); `package.json` / `package-lock.json` unchanged.

### D5 Tests (in the patch)

- `src/lib/today.test.ts`: existing fixtures pass the runner's own zone (`LOCAL_TZ`) so every existing assertion is unchanged; a new block of 11 covers D2 with fixed UTC instants in `America/New_York` vs `UTC` (due today / before / after, due date never Overdue during its day, the day boundary, reminder later today, either signal, Overdue beats Due, unparseable, completed, `autoTodayIds` / `resolveToday` take the zone).
- `src/state/todayPlan.test.ts`: `renderPlan` takes an optional zone (default `LOCAL_TZ`); 3 new tests: toggle stamps the Settings-zone day, only marks dated today in that zone count, a zone change re-derives the plan.
- New `src/components/SetDuePopover.test.tsx` (9): saves 00:00 of the day in the settings zone, opens an existing due date (and one imported with a time) on its day, disabled until the zone resolves, the zone line, Clear, the converters, and the TaskMenu item (label and wiring).
- `SubcategorySection.test.tsx` and `notebook/TaskSide.test.tsx`: one added `vi.fn()` prop each. No other existing test changes.

**Red-first:** with the patch applied:

```bash
cp src/lib/today.ts /tmp/today.new.ts
cp src/state/todayPlan.ts /tmp/todayPlan.new.ts
git show 262092e:src/lib/today.ts > src/lib/today.ts
git show 262092e:src/state/todayPlan.ts > src/state/todayPlan.ts
npx vitest run src/lib/today.test.ts src/state/todayPlan.test.ts
cp /tmp/today.new.ts src/lib/today.ts
cp /tmp/todayPlan.new.ts src/state/todayPlan.ts
```

Report the counts and confirm all 14 new tests fail. Existing tests in those two files also fail in that state, because the argument order changed; say so, don't count them. The orchestrator's run: 28 failed, 23 passed (51).

### D6 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**: the 17 files in the patch. Subject: `Chunk 66: Today runs on the Settings time zone; due dates (Day-7 #11)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green (**860** tests, **76** files expected); `npm run build` green; also `TZ=UTC npx vitest run` green.
- Eager JS before (at `262092e`) and after, on your machine. Limit **+6 kB**.
- After the push: deploy run id and result; live `version.json` read cache-busted.

---

## Sequence

### 1. Code

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

Expect `262092e`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record that eager-JS figure as the base. Write the patch at the end of this prompt, byte for byte, to `/tmp/chunk-66.patch` with your Write tool (not a shell heredoc). Then:

```bash
git apply --check /tmp/chunk-66.patch
git apply /tmp/chunk-66.patch
git status --short
```

`git status --short` must list exactly the 17 files (15 `M`, 2 `??`). If `--check` fails, stop and report; do not hand-merge. Read the applied diff end to end against D1–D5 and report anything that contradicts them. Run red-first (D5). Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 262092e -- package.json package-lock.json
grep -rn "setHours(0" src/lib/today.ts
git add -A src
git status --short
git commit
git push origin main
```

`grep -rn "setHours(0" src/lib/today.ts` must return nothing. The commit body lists D1–D4 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`. `git status --short` after `git add` must show only the 17 files staged; anything else, stop and report.

**Stop after the push and report.** Do not start step 3.

### 2. Smoke (not you)

The orchestrator runs this on the deployed app in Sergio's Chrome via the Claude in Chrome extension, on one throwaway `Smoke-66` task created through the UI:
- ⋯ → **Set due date…** → today → Save. `tasks.due_at` by REST = 00:00 today in `America/New_York` as UTC. After a reload the task is on Today with **Due today**.
- Due date → yesterday: after a reload, **Overdue**. Due date → tomorrow: after a reload, off Today.
- ⋯ → **Edit due date** → Clear: `due_at` null.
- A sun toggle writes a `today_marks` row with `day` = today in `America/New_York`.
- Console clean; the smoke task is deleted afterwards.

### 3. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md`**
- §4 "Today marks", **Day-scoping:** replace "`day` is the browser-local calendar day the mark was made for (the `lib/today` local-midnight frame; `settings.timezone` is not consulted — Day-7 #11)." with: "`day` is the calendar day in the user's Settings time zone the mark was made for — the frame `lib/today` derives in (chunk 66). Rows written before chunk 66 carry the browser-local day."
- §13 "Dashboard Today panel": replace "P1 tasks plus `remindAt` due/overdue" with "P1 tasks, tasks due today or overdue by `dueAt`, and `remindAt` due/overdue — days in the Settings time zone (chunk 66)"; replace "the browser-local day they were made on" with "the Settings-zone day they were made on"; replace the sentence "`dueAt`/`settings.timezone`-aware derivation remains deferred (PROGRESS Day-7 #11), and the day frame of `today_marks.day` moves with it." with: "A due date is a calendar day set from ⋯ → Set due date…, stored as 00:00 of that day in `settings.timezone`; it never turns Overdue during its own day (chunk 66)."
- §13 planner bullet: replace "`settings.timezone` stays a routines/streak, Insights and reminder-entry concern" with "`settings.timezone` stays a routines/streak, Insights, reminder/due-date entry and Today concern".

**`PROGRESS.md`**
- Row 66 ☑: the step-1 SHA, gates (both runner zones), red-first counts, test count and file count, eager JS before/after, deploy run, live `version.json`, the smoke result, deviations numbered.
- Day-7 backlog: item 11 → ☑ with `(done: chunk 66, <SHA> — Today derives Overdue / Due today from dueAt and reminders in settings.timezone; today_marks.day stamped in that zone; due-date picker in the task menu.)`; the status line becomes **10 done (☑), 1 moot, 0 open (☐)** with the chunk-66 date and SHA.
- Decisions log: D1–D4 (2026-10-13, chunk 66), one row each.
- Last-updated paragraph per the chunk-54 convention; the current chunk-65 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-66-today-timezone-due.md` in the same commit. A commit cannot carry its own SHA: if row 66 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- A due chip on task rows; due dates on create.
- Re-deriving Today on an in-place edit (a due date, reminder or priority set on an existing task joins the auto plan at the next load, as today).
- Moving the planner, WhatsNext or PlannerTray due display to the Settings zone.
- Backfilling old `today_marks.day` values.
- Observation, not this chunk: `SetReminderPopover.test.tsx` test (6) fails at `262092e` when the runner is in `Asia/Tokyo` (pre-existing, chunk 61).

## Report back

- **Step 1:** commit SHA; `git diff --stat 262092e <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build); red-first counts; the empty `setHours(0` grep; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Anything in the applied diff that contradicts D1–D5.
- Every deviation, numbered.

---

## The patch (`/tmp/chunk-66.patch`), verbatim

```diff
diff --git a/src/components/CategoryColumn.tsx b/src/components/CategoryColumn.tsx
index 7910af5..8ead297 100644
--- a/src/components/CategoryColumn.tsx
+++ b/src/components/CategoryColumn.tsx
@@ -64,6 +64,10 @@ export type CategoryColumnProps = {
     id: string,
     remindAt: string | null,
   ) => void | Promise<void>
+  onSetTaskDue: (
+    id: string,
+    dueAt: string | null,
+  ) => void | Promise<void>
   onSetTaskPriority: (
     id: string,
     priority: 1 | 2 | 3 | null,
@@ -111,6 +115,7 @@ export default function CategoryColumn({
   onDeleteTask,
   onMoveTaskToSubcategory,
   onSetTaskReminder,
+  onSetTaskDue,
   onSetTaskPriority,
   sortKey,
   onChangeSortKey,
@@ -286,6 +291,7 @@ export default function CategoryColumn({
                   onDeleteTask={onDeleteTask}
                   onMoveTaskToSubcategory={onMoveTaskToSubcategory}
                   onSetTaskReminder={onSetTaskReminder}
+                  onSetTaskDue={onSetTaskDue}
                   onSetTaskPriority={onSetTaskPriority}
                   sortKey={sortKey}
                   onRenameSubcategory={onRenameSubcategory}
@@ -336,6 +342,10 @@ type SortableSubSectionProps = {
     id: string,
     remindAt: string | null,
   ) => void | Promise<void>
+  onSetTaskDue: (
+    id: string,
+    dueAt: string | null,
+  ) => void | Promise<void>
   onSetTaskPriority: (
     id: string,
     priority: 1 | 2 | 3 | null,
diff --git a/src/components/SetDuePopover.test.tsx b/src/components/SetDuePopover.test.tsx
new file mode 100644
index 0000000..3617a84
--- /dev/null
+++ b/src/components/SetDuePopover.test.tsx
@@ -0,0 +1,183 @@
+import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
+import { MemoryRouter } from 'react-router-dom'
+import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
+
+/*
+ * Chunk 66: the due-date picker stores a calendar day in `settings.timezone`
+ * as 00:00 of that day in that zone. `@/lib/userTimezone` is mocked (settings
+ * zone Asia/Tokyo, device zone America/New_York) so every assertion is
+ * independent of the zone of the machine running the suite.
+ */
+
+const { loadUserTimezone } = vi.hoisted(() => ({
+  loadUserTimezone: vi.fn(),
+}))
+
+vi.mock('@/lib/userTimezone', () => ({
+  browserTimezone: () => 'America/New_York',
+  loadUserTimezone,
+}))
+
+import type { Task } from '@/db/types'
+
+import SetDuePopover, {
+  fromDueInputValue,
+  toDueInputValue,
+} from './SetDuePopover'
+import TaskMenu from './TaskMenu'
+
+// Radix Popover / DropdownMenu need these jsdom shims.
+beforeAll(() => {
+  Element.prototype.hasPointerCapture ??= () => false
+  Element.prototype.releasePointerCapture ??= () => {}
+  Element.prototype.scrollIntoView ??= () => {}
+  if (typeof globalThis.ResizeObserver === 'undefined') {
+    globalThis.ResizeObserver = class {
+      observe() {}
+      unobserve() {}
+      disconnect() {}
+    } as unknown as typeof ResizeObserver
+  }
+})
+
+function popover(
+  props: Partial<React.ComponentProps<typeof SetDuePopover>> = {},
+) {
+  return (
+    <SetDuePopover
+      open
+      onOpenChange={() => {}}
+      dueAt={null}
+      onSave={() => {}}
+      onClear={() => {}}
+      {...props}
+    />
+  )
+}
+
+const input = () => screen.getByLabelText('Due date') as HTMLInputElement
+const save = () => screen.getByRole('button', { name: 'Save' })
+
+describe('SetDuePopover — calendar day in settings.timezone (chunk 66)', () => {
+  beforeEach(() => {
+    vi.clearAllMocks()
+    loadUserTimezone.mockResolvedValue('Asia/Tokyo')
+  })
+
+  it('(1) saves the picked day as 00:00 of that day in settings.timezone', async () => {
+    const onSave = vi.fn()
+    render(popover({ onSave }))
+    await waitFor(() => expect(input()).not.toBeDisabled())
+
+    fireEvent.change(input(), { target: { value: '2026-10-20' } })
+    await act(async () => {
+      fireEvent.click(save())
+    })
+    // 00:00 Oct 20 in Tokyo (UTC+9) is 15:00 Oct 19 UTC.
+    expect(onSave).toHaveBeenCalledWith('2026-10-19T15:00:00.000Z')
+  })
+
+  it('(2) opens an existing due date on its day in settings.timezone', async () => {
+    render(popover({ dueAt: '2026-10-19T15:00:00.000Z' }))
+    await waitFor(() => expect(input().value).toBe('2026-10-20'))
+  })
+
+  it('(3) a due date imported with a time of day opens on its day', async () => {
+    // 23:30 Oct 20 in Tokyo.
+    render(popover({ dueAt: '2026-10-20T14:30:00.000Z' }))
+    await waitFor(() => expect(input().value).toBe('2026-10-20'))
+  })
+
+  it('(4) input and Save stay disabled until the zone resolves', () => {
+    loadUserTimezone.mockReturnValue(new Promise(() => {}))
+    render(popover())
+    expect(input()).toBeDisabled()
+    expect(save()).toBeDisabled()
+  })
+
+  it('(5) names the zone when it differs from the device’s', async () => {
+    render(popover())
+    expect(await screen.findByText('Dates in Asia/Tokyo')).toBeInTheDocument()
+  })
+
+  it('(6) Clear shows only when a due date is set, and clears it', async () => {
+    const { unmount } = render(popover())
+    await waitFor(() => expect(input()).not.toBeDisabled())
+    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
+    unmount()
+
+    const onClear = vi.fn()
+    render(popover({ dueAt: '2026-10-19T15:00:00.000Z', onClear }))
+    await act(async () => {
+      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
+    })
+    expect(onClear).toHaveBeenCalledTimes(1)
+  })
+
+  it('(7) converters', () => {
+    expect(fromDueInputValue('2026-10-20', 'America/New_York')).toBe(
+      '2026-10-20T04:00:00.000Z',
+    )
+    expect(fromDueInputValue('', 'America/New_York')).toBeNull()
+    expect(fromDueInputValue('20/10/2026', 'America/New_York')).toBeNull()
+    expect(toDueInputValue('2026-10-20T04:00:00.000Z', 'America/New_York')).toBe(
+      '2026-10-20',
+    )
+    expect(toDueInputValue(null, 'America/New_York')).toBe('')
+    expect(toDueInputValue('not a date', 'America/New_York')).toBe('')
+  })
+})
+
+describe('TaskMenu due-date item (chunk 66)', () => {
+  const base: Task = {
+    id: 't1',
+    userId: 'u1',
+    subcategoryId: 's1',
+    title: 'Atlas launch',
+    estimateMinutes: 30,
+    dueAt: null,
+    remindAt: null,
+    notified: false,
+    priority: null,
+    completedAt: null,
+    createdAt: '2026-10-01T00:00:00.000Z',
+    updatedAt: '2026-10-01T00:00:00.000Z',
+  }
+
+  function menu(task: Task, onOpenDue = vi.fn()) {
+    render(
+      <MemoryRouter>
+        <TaskMenu
+          task={task}
+          categories={[]}
+          subcategories={[]}
+          onMoveToSubcategoryId={vi.fn()}
+          onOpenReminder={vi.fn()}
+          onOpenPriority={vi.fn()}
+          onOpenDue={onOpenDue}
+          notes={[]}
+          onOpenNotes={vi.fn()}
+          onDelete={vi.fn()}
+        />
+      </MemoryRouter>,
+    )
+    fireEvent.keyDown(
+      screen.getByRole('button', { name: `Actions for "${task.title}"` }),
+      { key: 'Enter' },
+    )
+    return onOpenDue
+  }
+
+  it('offers "Set due date…" and opens the picker', async () => {
+    const onOpenDue = menu(base)
+    fireEvent.click(await screen.findByRole('menuitem', { name: /Set due date…/ }))
+    expect(onOpenDue).toHaveBeenCalledTimes(1)
+  })
+
+  it('reads "Edit due date" when the task has one', async () => {
+    menu({ ...base, dueAt: '2026-10-20T04:00:00.000Z' })
+    expect(
+      await screen.findByRole('menuitem', { name: /Edit due date/ }),
+    ).toBeInTheDocument()
+  })
+})
diff --git a/src/components/SetDuePopover.tsx b/src/components/SetDuePopover.tsx
new file mode 100644
index 0000000..23a871f
--- /dev/null
+++ b/src/components/SetDuePopover.tsx
@@ -0,0 +1,167 @@
+import { useEffect, useRef, useState } from 'react'
+import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
+
+import { Button } from '@/components/ui/button'
+import {
+  Popover,
+  PopoverAnchor,
+  PopoverContent,
+} from '@/components/ui/popover'
+import { browserTimezone, loadUserTimezone } from '@/lib/userTimezone'
+import { cn } from '@/lib/utils'
+
+/*
+ * Due-date picker (chunk 66, Day-7 #11). A native `<input type="date">` in a
+ * shadcn Popover, opened only from TaskMenu → "Set due date…". Open state is
+ * owned by TaskRow; with no visible trigger the popover anchors to a
+ * zero-size span in its own grid slot, exactly like PriorityPicker's
+ * menu-only entry.
+ *
+ * Value contract:
+ *   - A due date is a calendar day in `settings.timezone` (resolved by
+ *     `loadUserTimezone`, as the reminder picker does). It is stored as the
+ *     instant of 00:00 on that day in that zone.
+ *   - On open, an existing `dueAt` is shown as its day in that zone, so a
+ *     due date imported with a time of day still opens on the right day.
+ *
+ * Until the zone resolves the input and Save are disabled; when it differs
+ * from the device's zone a `Dates in <zone>` line says so. Clear shows only
+ * when the task already has a due date.
+ */
+
+export type SetDuePopoverProps = {
+  open: boolean
+  onOpenChange: (open: boolean) => void
+  /** Existing due date as an ISO string, or null if none set. */
+  dueAt: string | null
+  onSave: (isoTimestamp: string) => void | Promise<void>
+  onClear: () => void | Promise<void>
+}
+
+/** ISO → "YYYY-MM-DD", its calendar day in `tz` (the date-input format). */
+// eslint-disable-next-line react-refresh/only-export-components -- exported for the unit tests (chunk 66)
+export function toDueInputValue(iso: string | null, tz: string): string {
+  if (!iso) return ''
+  if (Number.isNaN(new Date(iso).getTime())) return ''
+  return formatInTimeZone(iso, tz, 'yyyy-MM-dd')
+}
+
+/** "YYYY-MM-DD" → ISO of 00:00 on that day in `tz`. Null on invalid input. */
+// eslint-disable-next-line react-refresh/only-export-components -- exported for the unit tests (chunk 66)
+export function fromDueInputValue(s: string, tz: string): string | null {
+  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
+  const d = fromZonedTime(`${s}T00:00:00.000`, tz)
+  if (Number.isNaN(d.getTime())) return null
+  return d.toISOString()
+}
+
+export default function SetDuePopover({
+  open,
+  onOpenChange,
+  dueAt,
+  onSave,
+  onClear,
+}: SetDuePopoverProps) {
+  const [value, setValue] = useState<string>('')
+  // `settings.timezone` for this open; null until `loadUserTimezone` resolves.
+  const [tz, setTz] = useState<string | null>(null)
+  // Reset-on-open: the same prevOpen pattern as SetReminderPopover.
+  const [prevOpen, setPrevOpen] = useState(open)
+  if (prevOpen !== open) {
+    setPrevOpen(open)
+    setValue('')
+    setTz(null)
+  }
+
+  const dueAtRef = useRef(dueAt)
+  useEffect(() => {
+    dueAtRef.current = dueAt
+  }, [dueAt])
+
+  // Bumped on every open/close so a resolution from an earlier open is dropped.
+  const openSeq = useRef(0)
+  useEffect(() => {
+    const seq = ++openSeq.current
+    if (!open) return
+    void loadUserTimezone().then((resolved) => {
+      if (openSeq.current !== seq) return
+      setTz(resolved)
+      setValue(toDueInputValue(dueAtRef.current, resolved))
+    })
+  }, [open])
+
+  const iso = tz ? fromDueInputValue(value, tz) : null
+  const showZone = tz !== null && tz !== browserTimezone()
+
+  async function handleSave() {
+    if (!iso) return
+    await onSave(iso)
+    onOpenChange(false)
+  }
+
+  async function handleClear() {
+    await onClear()
+    onOpenChange(false)
+  }
+
+  return (
+    <Popover open={open} onOpenChange={onOpenChange}>
+      {/* Menu-only entry: anchor to a zero-size span in the due slot. -ml-3
+          cancels the grid gap the extra column adds while the popover is
+          open (PriorityPicker's idiom). */}
+      <PopoverAnchor asChild>
+        <span aria-hidden className="-ml-3 w-0" />
+      </PopoverAnchor>
+      <PopoverContent className="w-64 space-y-3" align="end">
+        <div className="label">Due date</div>
+        {showZone && (
+          <div className="text-[11px] text-ink-3">Dates in {tz}</div>
+        )}
+        <input
+          type="date"
+          value={value}
+          disabled={tz === null}
+          aria-busy={tz === null ? true : undefined}
+          onChange={(e) => setValue(e.target.value)}
+          aria-label="Due date"
+          aria-invalid={value.length > 0 && !iso ? true : undefined}
+          className={cn(
+            'w-full rounded-sm border border-border bg-background px-2 py-1 text-base sm:text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
+            value.length > 0 &&
+              !iso &&
+              'border-destructive focus-visible:ring-destructive',
+          )}
+        />
+        <div className="flex items-center justify-end gap-2">
+          {dueAt && (
+            <Button
+              type="button"
+              variant="ghost"
+              size="sm"
+              onClick={() => void handleClear()}
+              className="mr-auto"
+            >
+              Clear
+            </Button>
+          )}
+          <Button
+            type="button"
+            variant="outline"
+            size="sm"
+            onClick={() => onOpenChange(false)}
+          >
+            Cancel
+          </Button>
+          <Button
+            type="button"
+            size="sm"
+            disabled={!iso}
+            onClick={() => void handleSave()}
+          >
+            Save
+          </Button>
+        </div>
+      </PopoverContent>
+    </Popover>
+  )
+}
diff --git a/src/components/SubcategorySection.test.tsx b/src/components/SubcategorySection.test.tsx
index 39cae65..7851c22 100644
--- a/src/components/SubcategorySection.test.tsx
+++ b/src/components/SubcategorySection.test.tsx
@@ -69,6 +69,7 @@ const baseProps = (tasks: Task[]) => ({
   onDeleteTask: vi.fn(),
   onMoveTaskToSubcategory: vi.fn(),
   onSetTaskReminder: vi.fn(),
+  onSetTaskDue: vi.fn(),
   onSetTaskPriority: vi.fn(),
   sortKey: 'priority' as const,
   onRenameSubcategory: vi.fn(),
diff --git a/src/components/SubcategorySection.tsx b/src/components/SubcategorySection.tsx
index 4b4ed4a..f6a06c6 100644
--- a/src/components/SubcategorySection.tsx
+++ b/src/components/SubcategorySection.tsx
@@ -56,6 +56,10 @@ export type SubcategorySectionProps = {
     id: string,
     remindAt: string | null,
   ) => void | Promise<void>
+  onSetTaskDue: (
+    id: string,
+    dueAt: string | null,
+  ) => void | Promise<void>
   onSetTaskPriority: (
     id: string,
     priority: 1 | 2 | 3 | null,
@@ -98,6 +102,7 @@ export default function SubcategorySection({
   onDeleteTask,
   onMoveTaskToSubcategory,
   onSetTaskReminder,
+  onSetTaskDue,
   onSetTaskPriority,
   sortKey,
   onRenameSubcategory,
@@ -239,6 +244,7 @@ export default function SubcategorySection({
               onDelete={onDeleteTask}
               onMoveToSubcategory={onMoveTaskToSubcategory}
               onSetReminder={onSetTaskReminder}
+              onSetDue={onSetTaskDue}
               onSetPriority={onSetTaskPriority}
               inToday={todaySet?.has(t.id)}
               onToggleToday={onToggleToday}
@@ -276,6 +282,7 @@ export default function SubcategorySection({
                   onDelete={onDeleteTask}
                   onMoveToSubcategory={onMoveTaskToSubcategory}
                   onSetReminder={onSetTaskReminder}
+                  onSetDue={onSetTaskDue}
                   onSetPriority={onSetTaskPriority}
                   inToday={todaySet?.has(t.id)}
                   onToggleToday={onToggleToday}
diff --git a/src/components/TaskMenu.tsx b/src/components/TaskMenu.tsx
index 6decb97..9a85af4 100644
--- a/src/components/TaskMenu.tsx
+++ b/src/components/TaskMenu.tsx
@@ -1,6 +1,7 @@
 import { useState } from 'react'
 import {
   Bell,
+  CalendarCheck,
   CalendarClock,
   ListFilter,
   MoreHorizontal,
@@ -50,6 +51,8 @@ export type TaskMenuProps = {
   onOpenReminder: () => void
   /** Opens the priority picker that lives in TaskRow (chip + this item). */
   onOpenPriority: () => void
+  /** Opens the due-date picker that lives in TaskRow (this item only, chunk 66). */
+  onOpenDue: () => void
   /** The task's notes, newest first — picks the item's label and right side. */
   notes: Note[]
   onOpenNotes: () => void
@@ -63,6 +66,7 @@ export default function TaskMenu({
   onMoveToSubcategoryId,
   onOpenReminder,
   onOpenPriority,
+  onOpenDue,
   notes,
   onOpenNotes,
   onDelete,
@@ -101,6 +105,10 @@ export default function TaskMenu({
               </span>
             )}
           </DropdownMenuItem>
+          <DropdownMenuItem onSelect={() => onOpenDue()}>
+            <CalendarCheck className="size-3.5" aria-hidden />
+            {task.dueAt ? 'Edit due date' : 'Set due date…'}
+          </DropdownMenuItem>
           <DropdownMenuItem onSelect={() => onOpenReminder()}>
             <Bell className="size-3.5" aria-hidden />
             {task.remindAt ? 'Edit reminder' : 'Set reminder…'}
diff --git a/src/components/TaskRow.tsx b/src/components/TaskRow.tsx
index 2b20e39..f4eccb4 100644
--- a/src/components/TaskRow.tsx
+++ b/src/components/TaskRow.tsx
@@ -11,6 +11,7 @@ import {
 } from '@/components/notebook/notesContext'
 import PriorityChip from '@/components/PriorityChip'
 import PriorityPicker from '@/components/PriorityPicker'
+import SetDuePopover from '@/components/SetDuePopover'
 import SetReminderPopover from '@/components/SetReminderPopover'
 import TaskMenu from '@/components/TaskMenu'
 import { Checkbox } from '@/components/ui/checkbox'
@@ -90,6 +91,10 @@ export type TaskRowProps = {
     id: string,
     remindAt: string | null,
   ) => void | Promise<void>
+  onSetDue: (
+    id: string,
+    dueAt: string | null,
+  ) => void | Promise<void>
   onSetPriority: (
     id: string,
     priority: 1 | 2 | 3 | null,
@@ -137,6 +142,7 @@ export default function TaskRow({
   onDelete,
   onMoveToSubcategory,
   onSetReminder,
+  onSetDue,
   onSetPriority,
   selectable = false,
   selected = false,
@@ -153,6 +159,9 @@ export default function TaskRow({
   // Priority picker open state lives here (two entry points: the chip
   // and TaskMenu → "Set priority…"), mirroring the reminder popover.
   const [priorityOpen, setPriorityOpen] = useState(false)
+  // Due-date picker (chunk 66): TaskMenu → "Set due date…" is its only
+  // entry, so its grid slot exists only while it is open.
+  const [dueOpen, setDueOpen] = useState(false)
   const notes = useTaskNotes(task.id)
   const openTaskNotes = useOpenTaskNotes()
   const noteSlot = isTouch ? 44 : 24
@@ -216,6 +225,7 @@ export default function TaskRow({
     canDrag ? '14px' : null,    // grip
     '1fr',                      // title
     prioritySlot ? 'auto' : null, // priority chip / picker anchor
+    dueOpen ? 'auto' : null,      // due-date picker anchor (chunk 66)
     `${noteSlot}px`,            // note indicator — reserved even when empty
     'auto',                     // minutes
     onToggleToday ? 'auto' : null, // Today sun toggle (dashboard rows only)
@@ -310,6 +320,15 @@ export default function TaskRow({
           onPick={(p) => onSetPriority(task.id, p)}
         />
       )}
+      {dueOpen && (
+        <SetDuePopover
+          open={dueOpen}
+          onOpenChange={setDueOpen}
+          dueAt={task.dueAt}
+          onSave={(iso) => onSetDue(task.id, iso)}
+          onClear={() => onSetDue(task.id, null)}
+        />
+      )}
       {notes.length > 0 ? (
         <button
           type="button"
@@ -408,6 +427,7 @@ export default function TaskRow({
         }
         onOpenReminder={() => setReminderOpen(true)}
         onOpenPriority={() => setPriorityOpen(true)}
+        onOpenDue={() => setDueOpen(true)}
         notes={notes}
         onOpenNotes={() => openTaskNotes(task.id)}
         onDelete={() => onDelete(task.id)}
diff --git a/src/components/TodayPanel.tsx b/src/components/TodayPanel.tsx
index cac4b24..83458b9 100644
--- a/src/components/TodayPanel.tsx
+++ b/src/components/TodayPanel.tsx
@@ -39,6 +39,8 @@ export type TodayPanelProps = {
     tasks: Task[]
   }
   todaySet: Set<string>
+  /** The Settings time zone: Today's day frame and the header date (chunk 66). */
+  timeZone: string
   /** Drives Today membership only (remove = force off). */
   onToggleToday: (id: string, force?: boolean) => void
   /** The app's real task-completion action, wired from the dashboard. */
@@ -48,11 +50,12 @@ export type TodayPanelProps = {
   mobile?: boolean
 }

-function todayDateLabel(): string {
+function todayDateLabel(timeZone: string): string {
   return new Date().toLocaleDateString(undefined, {
     weekday: 'long',
     month: 'short',
     day: 'numeric',
+    timeZone,
   })
 }

@@ -250,6 +253,7 @@ function TodayChip({
 export default function TodayPanel({
   data,
   todaySet,
+  timeZone,
   onToggleToday,
   onCompleteTask,
   variant,
@@ -369,7 +373,7 @@ export default function TodayPanel({

   if (variant === 'off') return null

-  const all = resolveToday(data, todaySet)
+  const all = resolveToday(data, todaySet, timeZone)
   const open = all.filter((r) => !r.task.completedAt)
   const visible = all.filter((r) => !r.task.completedAt || linger.has(r.task.id))
   const doneCount = all.length - open.length
@@ -417,7 +421,7 @@ export default function TodayPanel({
             Today
           </h2>
           <span className="label" style={{ fontSize: 9.5 }}>
-            {todayDateLabel()}
+            {todayDateLabel(timeZone)}
           </span>
         </div>
         {!banner && (
diff --git a/src/components/notebook/TaskSide.test.tsx b/src/components/notebook/TaskSide.test.tsx
index bc80d69..aecd1d5 100644
--- a/src/components/notebook/TaskSide.test.tsx
+++ b/src/components/notebook/TaskSide.test.tsx
@@ -113,6 +113,7 @@ const row = (notes: Note[]) =>
       onDelete={vi.fn()}
       onMoveToSubcategory={vi.fn()}
       onSetReminder={vi.fn()}
+      onSetDue={vi.fn()}
       onSetPriority={vi.fn()}
     />,
     notes,
diff --git a/src/lib/clock.ts b/src/lib/clock.ts
index 0af5b5a..37ca671 100644
--- a/src/lib/clock.ts
+++ b/src/lib/clock.ts
@@ -60,6 +60,16 @@ export function today(timezone: string = DEFAULT_TZ): string {
   return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
 }

+/**
+ * `YYYY-MM-DD` calendar day of the instant `at` in `timezone` (chunk 66).
+ * Unlike `today()`, `at` is injectable and the DEV override is not read —
+ * this is the pure building block for Today's day frame (`lib/today`,
+ * `state/todayPlan`).
+ */
+export function dateKeyIn(at: Date | number | string, timezone: string): string {
+  return formatInTimeZone(at, timezone, 'yyyy-MM-dd')
+}
+
 /**
  * Returns the ISO timestamp (UTC) for 00:00:00 on `dateKey` in
  * `timezone`. Used for the `createdAt < startOfDay(date)` comparison
diff --git a/src/lib/today.test.ts b/src/lib/today.test.ts
index de605af..fd22cf3 100644
--- a/src/lib/today.test.ts
+++ b/src/lib/today.test.ts
@@ -17,6 +17,10 @@ import {
 // below is derived from the same local frame, so comparisons hold in UTC CI or
 // a local machine alike.
 const NOW = new Date(2026, 6, 1, 12, 0, 0) // Wed Jul 1 2026, 12:00 local
+// These fixtures are built in the runner's local frame, so they pass the
+// runner's own zone as the Settings zone (chunk 66). The zone-specific
+// behaviour is covered by the "Settings time zone" block at the end.
+const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

 /** ISO for a local wall-clock time on an offset of days from NOW's date. */
 function localIso(
@@ -65,40 +69,40 @@ describe('todayReason', () => {
   it('returns Overdue when remindAt is before now (highest precedence)', () => {
     // Earlier today AND priority-1: Overdue still wins the ladder.
     const t = task({ id: 't', remindAt: localIso(0, 9), priority: 1 })
-    expect(todayReason(t, NOW)).toMatchObject({ key: 'overdue', rank: 0 })
+    expect(todayReason(t, LOCAL_TZ, NOW)).toMatchObject({ key: 'overdue', rank: 0 })
   })

   it('treats a reminder from a previous day as Overdue', () => {
     const t = task({ id: 't', remindAt: localIso(-1, 15) })
-    expect(todayReason(t, NOW)?.key).toBe('overdue')
+    expect(todayReason(t, LOCAL_TZ, NOW)?.key).toBe('overdue')
   })

   it('returns Due today when remindAt is later today within local-midnight bounds', () => {
     const t = task({ id: 't', remindAt: localIso(0, 15), priority: 1 })
     // Due beats Priority; not overdue because it's still in the future.
-    expect(todayReason(t, NOW)).toMatchObject({ key: 'due', rank: 1 })
+    expect(todayReason(t, LOCAL_TZ, NOW)).toMatchObject({ key: 'due', rank: 1 })
   })

   it('includes the exact end-of-day boundary as Due today', () => {
     const endOfDay = new Date(2026, 6, 1, 23, 59, 59, 999).toISOString()
-    expect(todayReason(task({ id: 't', remindAt: endOfDay }), NOW)?.key).toBe(
+    expect(todayReason(task({ id: 't', remindAt: endOfDay }), LOCAL_TZ, NOW)?.key).toBe(
       'due',
     )
   })

   it('returns Priority when a future (beyond today) reminder exists but priority===1', () => {
     const t = task({ id: 't', remindAt: localIso(1, 9), priority: 1 })
-    expect(todayReason(t, NOW)).toMatchObject({ key: 'priority', rank: 2 })
+    expect(todayReason(t, LOCAL_TZ, NOW)).toMatchObject({ key: 'priority', rank: 2 })
   })

   it('returns Priority when priority===1 and no reminder', () => {
-    expect(todayReason(task({ id: 't', priority: 1 }), NOW)?.key).toBe(
+    expect(todayReason(task({ id: 't', priority: 1 }), LOCAL_TZ, NOW)?.key).toBe(
       'priority',
     )
   })

   it('returns null for a tomorrow-only reminder with no priority', () => {
-    expect(todayReason(task({ id: 't', remindAt: localIso(1, 9) }), NOW)).toBeNull()
+    expect(todayReason(task({ id: 't', remindAt: localIso(1, 9) }), LOCAL_TZ, NOW)).toBeNull()
   })

   it('returns null for completed tasks even with an overdue reminder', () => {
@@ -108,16 +112,16 @@ describe('todayReason', () => {
       priority: 1,
       completedAt: '2026-07-01T08:00:00.000Z',
     })
-    expect(todayReason(t, NOW)).toBeNull()
+    expect(todayReason(t, LOCAL_TZ, NOW)).toBeNull()
   })

   it('returns null for a bare task (no signal)', () => {
-    expect(todayReason(task({ id: 't' }), NOW)).toBeNull()
+    expect(todayReason(task({ id: 't' }), LOCAL_TZ, NOW)).toBeNull()
   })

   it('ignores priority values other than 1', () => {
-    expect(todayReason(task({ id: 't', priority: 2 }), NOW)).toBeNull()
-    expect(todayReason(task({ id: 't', priority: 3 }), NOW)).toBeNull()
+    expect(todayReason(task({ id: 't', priority: 2 }), LOCAL_TZ, NOW)).toBeNull()
+    expect(todayReason(task({ id: 't', priority: 3 }), LOCAL_TZ, NOW)).toBeNull()
   })
 })

@@ -134,14 +138,14 @@ describe('autoTodayIds', () => {
       task({ id: 'none' }),
       task({ id: 'done', priority: 1, completedAt: '2026-07-01T08:00:00.000Z' }),
     ]
-    expect(autoTodayIds(tasks, NOW)).toEqual(
+    expect(autoTodayIds(tasks, LOCAL_TZ, NOW)).toEqual(
       new Set(['overdue', 'due', 'prio']),
     )
   })

   it('is empty for an empty / nullish list', () => {
-    expect(autoTodayIds([], NOW).size).toBe(0)
-    expect(autoTodayIds(undefined, NOW).size).toBe(0)
+    expect(autoTodayIds([], LOCAL_TZ, NOW).size).toBe(0)
+    expect(autoTodayIds(undefined, LOCAL_TZ, NOW).size).toBe(0)
   })
 })

@@ -161,6 +165,7 @@ describe('resolveToday', () => {
     const rows = resolveToday(
       { ...data, tasks: [t] },
       new Set(['pin']),
+      LOCAL_TZ,
       NOW,
     )
     expect(rows).toHaveLength(1)
@@ -172,7 +177,7 @@ describe('resolveToday', () => {

   it('only includes tasks in the membership set', () => {
     const tasks = [task({ id: 'a', priority: 1 }), task({ id: 'b', priority: 1 })]
-    const rows = resolveToday({ ...data, tasks }, new Set(['a']), NOW)
+    const rows = resolveToday({ ...data, tasks }, new Set(['a']), LOCAL_TZ, NOW)
     expect(rows.map((r) => r.task.id)).toEqual(['a'])
   })

@@ -185,7 +190,7 @@ describe('resolveToday', () => {
       task({ id: 'due', remindAt: localIso(0, 18), estimateMinutes: 45 }),
     ]
     const set = new Set(['done', 'prio-long', 'prio-short', 'overdue', 'due'])
-    const rows = resolveToday({ ...data, tasks }, set, NOW)
+    const rows = resolveToday({ ...data, tasks }, set, LOCAL_TZ, NOW)
     expect(rows.map((r) => r.task.id)).toEqual([
       'overdue', // rank 0
       'due', // rank 1
@@ -197,7 +202,7 @@ describe('resolveToday', () => {

   it('keeps a completed task in the resolved rows (for done/total + linger)', () => {
     const t = task({ id: 'x', priority: 1, completedAt: '2026-07-01T09:00:00.000Z' })
-    const rows = resolveToday({ ...data, tasks: [t] }, new Set(['x']), NOW)
+    const rows = resolveToday({ ...data, tasks: [t] }, new Set(['x']), LOCAL_TZ, NOW)
     expect(rows).toHaveLength(1)
     expect(rows[0].reason).toEqual(PINNED) // reason null → Pinned fallback once done
   })
@@ -213,7 +218,7 @@ describe('reconcileTodayMembership', () => {
     const prevIds = new Set(['a', 'b'])
     const membership = new Set(['a', 'b']) // 'b' was a manual pin
     // Same ids, one field changed → membership preserved verbatim.
-    const next = reconcileTodayMembership(membership, prevIds, tasks, NOW)
+    const next = reconcileTodayMembership(membership, prevIds, tasks, LOCAL_TZ, NOW)
     expect(next).toEqual(new Set(['a', 'b']))
   })

@@ -223,6 +228,7 @@ describe('reconcileTodayMembership', () => {
       new Set(['a', 'gone']),
       new Set(['a', 'gone']),
       tasks,
+      LOCAL_TZ,
       NOW,
     )
     expect(next).toEqual(new Set(['a']))
@@ -238,6 +244,7 @@ describe('reconcileTodayMembership', () => {
       new Set(['a']),
       new Set(['a']),
       tasks,
+      LOCAL_TZ,
       NOW,
     )
     expect(next).toEqual(new Set(['a', 'new-prio']))
@@ -255,8 +262,104 @@ describe('reconcileTodayMembership', () => {
       new Set([]), // x removed, y never pinned
       new Set(['x', 'y']),
       tasks,
+      LOCAL_TZ,
       NOW,
     )
     expect(next).toEqual(new Set(['new']))
   })
 })
+
+// ============================================================
+// Settings time zone + due dates (chunk 66, Day-7 #11)
+// ============================================================
+
+describe('todayReason in the Settings time zone (chunk 66)', () => {
+  const NY = 'America/New_York'
+  // Oct 13 2026, 10:00 in New York.
+  const MORNING = new Date('2026-10-13T14:00:00.000Z')
+  // Oct 13 2026, 22:30 in New York — already Oct 14 in UTC.
+  const LATE = new Date('2026-10-14T02:30:00.000Z')
+  // Due dates are stored as midnight of the picked day in the Settings zone.
+  const DUE_OCT_12 = '2026-10-12T04:00:00.000Z'
+  const DUE_OCT_13 = '2026-10-13T04:00:00.000Z'
+  const DUE_OCT_14 = '2026-10-14T04:00:00.000Z'
+
+  it('a due date of today is Due today', () => {
+    expect(todayReason(task({ id: 't', dueAt: DUE_OCT_13 }), NY, MORNING)?.key).toBe('due')
+  })
+
+  it('a due date before today is Overdue', () => {
+    expect(todayReason(task({ id: 't', dueAt: DUE_OCT_12 }), NY, MORNING)?.key).toBe(
+      'overdue',
+    )
+  })
+
+  it('a due date after today is no signal on its own', () => {
+    expect(todayReason(task({ id: 't', dueAt: DUE_OCT_14 }), NY, MORNING)).toBeNull()
+  })
+
+  it('a due date never turns Overdue during its own day, whatever its time', () => {
+    // An imported due date carrying a time (21:00 New York) is still due
+    // today once that time has passed.
+    const t = task({ id: 't', dueAt: '2026-10-14T01:00:00.000Z' })
+    expect(todayReason(t, NY, LATE)?.key).toBe('due')
+  })
+
+  it('the day boundary is the Settings zone’s midnight, not UTC’s', () => {
+    const t = task({ id: 't', dueAt: DUE_OCT_13 })
+    // 22:30 Oct 13 in New York: still due today there…
+    expect(todayReason(t, NY, LATE)?.key).toBe('due')
+    // …but in UTC it is already Oct 14, so the same due date is Overdue.
+    expect(todayReason(t, 'UTC', LATE)?.key).toBe('overdue')
+  })
+
+  it('a reminder later today in the Settings zone still counts as Due today', () => {
+    // 21:00 New York on Oct 13 — Oct 14 in UTC.
+    const t = task({ id: 't', remindAt: '2026-10-14T01:00:00.000Z' })
+    expect(todayReason(t, NY, MORNING)?.key).toBe('due')
+    expect(todayReason(t, 'UTC', MORNING)).toBeNull()
+  })
+
+  it('either signal places the task: due tomorrow + reminder today is Due today', () => {
+    const t = task({
+      id: 't',
+      dueAt: DUE_OCT_14,
+      remindAt: '2026-10-13T20:00:00.000Z',
+    })
+    expect(todayReason(t, NY, MORNING)?.key).toBe('due')
+  })
+
+  it('Overdue from the due date beats a reminder later today', () => {
+    const t = task({
+      id: 't',
+      dueAt: DUE_OCT_12,
+      remindAt: '2026-10-13T20:00:00.000Z',
+    })
+    expect(todayReason(t, NY, MORNING)?.key).toBe('overdue')
+  })
+
+  it('an unparseable due date is ignored', () => {
+    expect(todayReason(task({ id: 't', dueAt: 'not a date' }), NY, MORNING)).toBeNull()
+  })
+
+  it('a completed task with a past due date has no reason', () => {
+    const t = task({
+      id: 't',
+      dueAt: DUE_OCT_12,
+      completedAt: '2026-10-12T15:00:00.000Z',
+    })
+    expect(todayReason(t, NY, MORNING)).toBeNull()
+  })
+
+  it('autoTodayIds and resolveToday use the zone they are given', () => {
+    const tasks = [task({ id: 'd', dueAt: DUE_OCT_13 }), task({ id: 'n', dueAt: DUE_OCT_14 })]
+    expect(autoTodayIds(tasks, NY, MORNING)).toEqual(new Set(['d']))
+    const rows = resolveToday(
+      { categories: [WORK], subcategories: [SUB_WORK], tasks },
+      new Set(['d']),
+      NY,
+      MORNING,
+    )
+    expect(rows.map((r) => [r.task.id, r.reason.key])).toEqual([['d', 'due']])
+  })
+})
diff --git a/src/lib/today.ts b/src/lib/today.ts
index 1c9dc72..3f9b6a1 100644
--- a/src/lib/today.ts
+++ b/src/lib/today.ts
@@ -6,25 +6,29 @@
  * dependency-free, and unit-tested (`today.test.ts`). No React, no I/O — the
  * membership Set and rendering live one layer up (`state/todayPlan`, `TodayPanel`).
  *
- * A task lands in Today when it is overdue, has a reminder due today, is flagged
- * Priority 1, OR the user pins it (the sun toggle → the synthetic `Pinned`
- * reason). Highest-precedence reason wins per task.
+ * A task lands in Today when it is overdue, due today, flagged Priority 1, OR
+ * the user pins it (the sun toggle → the synthetic `Pinned` reason). Highest-
+ * precedence reason wins per task.
+ *
+ * Day frame (chunk 66, Day-7 #11): "today" is the calendar day in the user's
+ * Settings time zone (`timeZone`, passed by every caller), not the browser's.
+ *   - Overdue: the due date's day (in `timeZone`) is before today, OR the
+ *     reminder instant has passed.
+ *   - Due today: the due date's day is today, OR the reminder falls later
+ *     today. A due date is a calendar day: its time of day never matters.
+ *   - Priority: `priority === 1`.
  *
  * Reconciliations honored from the build brief:
  *   - ONE color per row = the category color, applied by the view. The reason
  *     object carries only `key` / `label` / `rank` — the prototype's `color`
  *     field (which referenced the superseded `--jewel-rose`) is dropped here so
  *     nothing keys a hue off status.
- *   - Derivation depends only on model fields the schema already has:
- *     `remindAt`, `priority`, `completedAt`, `estimateMinutes`, `subcategoryId`.
  *
  * `now` is injectable on every entry point (defaults to `new Date()`) so the
- * local-midnight bounds are deterministic under test. Bounds use the browser's
- * local timezone via `setHours`, exactly like the prototype. (Whether "today"
- * should instead honor `settings.timezone`, and whether `Due today` should key
- * off `dueAt` once real due dates exist, are deferred decisions — see the PR.)
+ * day frame is deterministic under test.
  */
 import type { Category, Subcategory, Task } from '@/db/types'
+import { dateKeyIn } from '@/lib/clock'

 export type TodayReasonKey = 'overdue' | 'due' | 'priority' | 'pinned'

@@ -57,31 +61,39 @@ const PRIORITY: TodayReason = { key: 'priority', label: 'Priority', rank: 2 }
 /** Synthetic reason for a user-pinned task with no auto signal. */
 export const PINNED: TodayReason = { key: 'pinned', label: 'Pinned', rank: 3 }

-/** [start, end] epoch-ms for local midnight..end-of-day around `now`. */
-function todayBounds(now: Date): [number, number] {
-  const s = new Date(now.getTime())
-  s.setHours(0, 0, 0, 0)
-  const e = new Date(now.getTime())
-  e.setHours(23, 59, 59, 999)
-  return [s.getTime(), e.getTime()]
+/** Epoch ms of an ISO timestamp, or null when absent or unparseable. */
+function instant(iso: string | null): number | null {
+  if (!iso) return null
+  const ms = new Date(iso).getTime()
+  return Number.isNaN(ms) ? null : ms
 }

 /**
  * The single highest-precedence reason a task belongs in Today, or `null`.
  * Completed tasks always return `null`. Precedence: Overdue → Due today →
- * Priority.
+ * Priority. Days are calendar days in `timeZone`.
  */
 export function todayReason(
   task: Task | null | undefined,
+  timeZone: string,
   now: Date = new Date(),
 ): TodayReason | null {
   if (!task || task.completedAt) return null
-  const [start, end] = todayBounds(now)
-  const nowMs = now.getTime()
-  const r = task.remindAt ? new Date(task.remindAt).getTime() : null
-  if (r != null && !Number.isNaN(r)) {
-    if (r < nowMs) return OVERDUE
-    if (r >= start && r <= end) return DUE_TODAY
+  const todayKey = dateKeyIn(now, timeZone)
+  const due = instant(task.dueAt)
+  const dueKey = due === null ? null : dateKeyIn(due, timeZone)
+  const remind = instant(task.remindAt)
+  if (
+    (dueKey !== null && dueKey < todayKey) ||
+    (remind !== null && remind < now.getTime())
+  ) {
+    return OVERDUE
+  }
+  if (
+    dueKey === todayKey ||
+    (remind !== null && dateKeyIn(remind, timeZone) === todayKey)
+  ) {
+    return DUE_TODAY
   }
   if (task.priority === 1) return PRIORITY
   return null
@@ -93,11 +105,12 @@ export function todayReason(
  */
 export function autoTodayIds(
   tasks: Task[] | null | undefined,
+  timeZone: string,
   now: Date = new Date(),
 ): Set<string> {
   const ids = new Set<string>()
   for (const t of tasks ?? []) {
-    if (todayReason(t, now)) ids.add(t.id)
+    if (todayReason(t, timeZone, now)) ids.add(t.id)
   }
   return ids
 }
@@ -113,6 +126,7 @@ export function autoTodayIds(
 export function resolveToday(
   data: TodayData,
   todaySet: Set<string>,
+  timeZone: string,
   now: Date = new Date(),
 ): TodayRow[] {
   const subName: Record<string, string> = {}
@@ -127,7 +141,7 @@ export function resolveToday(
     .filter((t) => todaySet.has(t.id))
     .map((t) => ({
       task: t,
-      reason: todayReason(t, now) ?? PINNED,
+      reason: todayReason(t, timeZone, now) ?? PINNED,
       subName: subName[t.subcategoryId] ?? '',
       catName: catOfSub[t.subcategoryId] ?? '',
     }))
@@ -161,6 +175,7 @@ export function reconcileTodayMembership(
   prev: Set<string>,
   prevIds: Set<string>,
   tasks: Task[],
+  timeZone: string,
   now: Date = new Date(),
 ): Set<string> {
   const curIds = new Set(tasks.map((t) => t.id))
@@ -169,7 +184,7 @@ export function reconcileTodayMembership(
     if (curIds.has(id)) next.add(id)
   }
   for (const t of tasks) {
-    if (!prevIds.has(t.id) && todayReason(t, now)) next.add(t.id)
+    if (!prevIds.has(t.id) && todayReason(t, timeZone, now)) next.add(t.id)
   }
   return next
 }
diff --git a/src/screens/CategoryView.tsx b/src/screens/CategoryView.tsx
index a696da7..81ad302 100644
--- a/src/screens/CategoryView.tsx
+++ b/src/screens/CategoryView.tsx
@@ -316,6 +316,20 @@ export default function CategoryView() {
     [upsertTask],
   )

+  const onSetTaskDue = useCallback(
+    async (id: string, dueAt: string | null) => {
+      try {
+        const updated = await repo.tasks.update(id, { dueAt })
+        upsertTask(updated)
+        toast(dueAt ? 'Due date set' : 'Due date cleared')
+      } catch (e) {
+        console.error('Set due date failed', e)
+        toast.error(SAVE_ERROR)
+      }
+    },
+    [upsertTask],
+  )
+
   const onSetTaskPriority = useCallback(
     async (id: string, priority: 1 | 2 | 3 | null) => {
       try {
@@ -602,6 +616,7 @@ export default function CategoryView() {
                   onDeleteTask={onDeleteTask}
                   onMoveTaskToSubcategory={onMoveTaskToSubcategory}
                   onSetTaskReminder={onSetTaskReminder}
+                  onSetTaskDue={onSetTaskDue}
                   onSetTaskPriority={onSetTaskPriority}
                   sortKey={sortKey}
                   onRenameSubcategory={onRenameSubcategory}
@@ -656,6 +671,10 @@ type SortableSubSectionProps = {
     id: string,
     remindAt: string | null,
   ) => void | Promise<void>
+  onSetTaskDue: (
+    id: string,
+    dueAt: string | null,
+  ) => void | Promise<void>
   onSetTaskPriority: (
     id: string,
     priority: 1 | 2 | 3 | null,
diff --git a/src/screens/Dashboard.tsx b/src/screens/Dashboard.tsx
index 0696577..61f08ad 100644
--- a/src/screens/Dashboard.tsx
+++ b/src/screens/Dashboard.tsx
@@ -73,6 +73,9 @@ function useDashboardData(userId: string | null) {
   // The user's Today marks (chunk 64) — `null` until the first load completes,
   // which is how `useTodayPlan` tells "no marks" from "not loaded yet".
   const [todayMarks, setTodayMarks] = useState<TodayMark[] | null>(null)
+  // The Settings time zone Today's day frame runs in (chunk 66) — the same
+  // value the streak uses, resolved in `load`. The default matches `tz`'s.
+  const [timeZone, setTimeZone] = useState('America/New_York')
   const [loading, setLoading] = useState(true)
   const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)

@@ -108,6 +111,7 @@ function useDashboardData(userId: string | null) {
       setData({ categories, subcategories, tasks })
       setStreak(heroStreak)
       setTodayMarks(marks)
+      setTimeZone(tz)
       setLoading(false)
     }
     load().catch((e) => {
@@ -119,13 +123,13 @@ function useDashboardData(userId: string | null) {
     }
   }, [dashboardRefreshKey, userId])

-  return { data, setData, loading, streak, todayMarks }
+  return { data, setData, loading, streak, todayMarks, timeZone }
 }

 export default function Dashboard() {
   const { user } = useSession()
   const userId = user?.id ?? null
-  const { data, setData, loading, streak, todayMarks } =
+  const { data, setData, loading, streak, todayMarks, timeZone } =
     useDashboardData(userId)
   const navigate = useNavigate()

@@ -193,6 +197,7 @@ export default function Dashboard() {
     liveTasks,
     todayMarks,
     writeTodayMark,
+    timeZone,
   )

   // "On a roll ×N" combo (chunk 27). A render-diff over the live tasks: when
@@ -369,6 +374,20 @@ export default function Dashboard() {
     [upsertTask],
   )

+  const onSetTaskDue = useCallback(
+    async (id: string, dueAt: string | null) => {
+      try {
+        const updated = await repo.tasks.update(id, { dueAt })
+        upsertTask(updated)
+        toast(dueAt ? 'Due date set' : 'Due date cleared')
+      } catch (e) {
+        console.error('Set due date failed', e)
+        toast.error(SAVE_ERROR)
+      }
+    },
+    [upsertTask],
+  )
+
   const onSetTaskPriority = useCallback(
     async (id: string, priority: 1 | 2 | 3 | null) => {
       try {
@@ -649,6 +668,7 @@ export default function Dashboard() {
           onDeleteTask={onDeleteTask}
           onMoveTaskToSubcategory={onMoveTaskToSubcategory}
           onSetTaskReminder={onSetTaskReminder}
+          onSetTaskDue={onSetTaskDue}
           onSetTaskPriority={onSetTaskPriority}
           sortKey={sortKey}
           onChangeSortKey={onChangeSortKey}
@@ -691,6 +711,7 @@ export default function Dashboard() {
             variant={todayVariant}
             data={todayData}
             todaySet={todaySet}
+            timeZone={timeZone}
             onToggleToday={toggleToday}
             onCompleteTask={onCompleteTask}
             mobile={isTouch}
@@ -703,6 +724,7 @@ export default function Dashboard() {
             variant="rail"
             data={todayData}
             todaySet={todaySet}
+            timeZone={timeZone}
             onToggleToday={toggleToday}
             onCompleteTask={onCompleteTask}
             mobile={isTouch}
diff --git a/src/screens/SubcategoryView.tsx b/src/screens/SubcategoryView.tsx
index ae3da72..9d1d3ac 100644
--- a/src/screens/SubcategoryView.tsx
+++ b/src/screens/SubcategoryView.tsx
@@ -352,6 +352,20 @@ export default function SubcategoryView() {
     [upsertTask],
   )

+  const onSetTaskDue = useCallback(
+    async (id: string, dueAt: string | null) => {
+      try {
+        const updated = await repo.tasks.update(id, { dueAt })
+        upsertTask(updated)
+        toast(dueAt ? 'Due date set' : 'Due date cleared')
+      } catch (e) {
+        console.error('Set due date failed', e)
+        toast.error(SAVE_ERROR)
+      }
+    },
+    [upsertTask],
+  )
+
   const onSetTaskPriority = useCallback(
     async (id: string, priority: 1 | 2 | 3 | null) => {
       try {
@@ -558,6 +572,7 @@ export default function SubcategoryView() {
                   onDelete={onDeleteTask}
                   onMoveToSubcategory={onMoveTaskToSubcategory}
                   onSetReminder={onSetTaskReminder}
+                  onSetDue={onSetTaskDue}
                   onSetPriority={onSetTaskPriority}
                 />
               </div>
diff --git a/src/state/todayPlan.test.ts b/src/state/todayPlan.test.ts
index fc30775..9b2a3a7 100644
--- a/src/state/todayPlan.test.ts
+++ b/src/state/todayPlan.test.ts
@@ -59,16 +59,24 @@ function mark(
   }
 }

-type Props = { tasks: Task[]; marks: TodayMark[] | null }
+type Props = { tasks: Task[]; marks: TodayMark[] | null; timeZone?: string }
+
+// The runner's own zone: the fixtures above are built in its local frame.
+const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

 const writeMark = vi.fn<
   (taskId: string, kind: TodayMark['kind'], day: string) => Promise<unknown>
 >(() => Promise.resolve())

-function renderPlan(tasks: Task[], marks: TodayMark[] | null = []) {
+function renderPlan(
+  tasks: Task[],
+  marks: TodayMark[] | null = [],
+  timeZone?: string,
+) {
   return renderHook(
-    ({ tasks, marks }: Props) => useTodayPlan(tasks, marks, writeMark),
-    { initialProps: { tasks, marks } },
+    ({ tasks, marks, timeZone }: Props) =>
+      useTodayPlan(tasks, marks, writeMark, timeZone ?? LOCAL_TZ),
+    { initialProps: { tasks, marks, timeZone } as Props },
   )
 }

@@ -345,3 +353,53 @@ describe('useTodayPlan day rollover with the tab open (chunk 44)', () => {
     expect(result.current.todaySet.has('b')).toBe(true)
   })
 })
+
+describe('useTodayPlan in the Settings time zone (chunk 66)', () => {
+  // 2026-10-14T02:30Z is Oct 13, 22:30 in New York and Oct 14 in UTC.
+  const LATE_NY = new Date('2026-10-14T02:30:00.000Z')
+  // Midnight Oct 14 in New York, as a due date is stored.
+  const DUE_OCT_14_NY = '2026-10-14T04:00:00.000Z'
+
+  beforeEach(() => {
+    vi.useFakeTimers()
+    vi.setSystemTime(LATE_NY)
+  })
+
+  afterEach(() => {
+    vi.useRealTimers()
+  })
+
+  it('stamps a toggle with the day in the Settings zone, not the device’s', () => {
+    const tasks = [task({ id: 'a' })]
+    const ny = renderPlan(tasks, [], 'America/New_York')
+    act(() => ny.result.current.toggleToday('a'))
+    expect(writeMark).toHaveBeenLastCalledWith('a', 'pin', '2026-10-13')
+    ny.unmount()
+
+    const utc = renderPlan(tasks, [], 'UTC')
+    act(() => utc.result.current.toggleToday('a'))
+    expect(writeMark).toHaveBeenLastCalledWith('a', 'pin', '2026-10-14')
+  })
+
+  it('counts only marks dated today in the Settings zone', () => {
+    const tasks = [task({ id: 'a' })]
+    const marks = [mark('a', 'pin', { day: '2026-10-13' })]
+    expect(
+      renderPlan(tasks, marks, 'America/New_York').result.current.todaySet.has('a'),
+    ).toBe(true)
+    expect(renderPlan(tasks, marks, 'UTC').result.current.todaySet.has('a')).toBe(
+      false,
+    )
+  })
+
+  it('re-derives the auto plan when the Settings zone changes', () => {
+    const tasks = [task({ id: 'd', dueAt: DUE_OCT_14_NY })]
+    const { result, rerender } = renderPlan(tasks, [], 'America/New_York')
+    // Still Oct 13 in New York: due tomorrow, not on today's plan.
+    expect(result.current.todaySet.has('d')).toBe(false)
+    // Oct 14 in UTC, and the due date falls on Oct 14 there: due today.
+    rerender({ tasks, marks: [], timeZone: 'UTC' })
+    expect(result.current.todaySet.has('d')).toBe(true)
+    expect(writeMark).not.toHaveBeenCalled()
+  })
+})
diff --git a/src/state/todayPlan.ts b/src/state/todayPlan.ts
index 9edf430..515ce68 100644
--- a/src/state/todayPlan.ts
+++ b/src/state/todayPlan.ts
@@ -10,8 +10,9 @@
  * user's marks and a writer; it keeps the ones dated today and ignores the
  * rest, so yesterday's plan never resurfaces and nothing has to be cleaned
  * up. Only the deltas are stored, never the resolved set, so auto signals
- * keep flowing as tasks change. The day frame is the browser-local midnight
- * `lib/today` uses.
+ * keep flowing as tasks change. The day frame is the calendar day in the
+ * user's Settings time zone (`timeZone`, chunk 66) — the same frame
+ * `lib/today` derives from — so `today_marks.day` is stamped in that zone.
  *
  * A toggle on another device arrives as a changed `marks` array (realtime →
  * dashboard refresh) and is applied with the same operation a local toggle
@@ -37,6 +38,7 @@ import { useCallback, useEffect, useRef, useState } from 'react'
 import { toast } from 'sonner'

 import type { Task, TodayMark } from '@/db/types'
+import { dateKeyIn } from '@/lib/clock'
 import { autoTodayIds, reconcileTodayMembership } from '@/lib/today'

 export type TodayPlan = {
@@ -65,8 +67,11 @@ export type WriteTodayMark = (

 const STORAGE_KEY = 'hup:todayPlan'

-/** Local-calendar day key (YYYY-MM-DD) — the `lib/today` local-midnight frame. */
-function dayKey(now: Date): string {
+/**
+ * Browser-local day key (YYYY-MM-DD). Used ONLY to read the legacy
+ * `hup:todayPlan` entry, which pre-chunk-64 builds dated in this frame.
+ */
+function localDayKey(now: Date): string {
   const p = (n: number) => String(n).padStart(2, '0')
   return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
 }
@@ -88,7 +93,7 @@ export function readTodayDeltas(now: Date = new Date()): TodayDeltas {
     const parsed: unknown = JSON.parse(raw)
     if (typeof parsed !== 'object' || parsed === null) return emptyDeltas()
     const { date, pinned, removed } = parsed as Record<string, unknown>
-    if (date !== dayKey(now)) {
+    if (date !== localDayKey(now)) {
       // Yesterday's plan is over — drop the entry rather than leaving the
       // string on disk for a device that is opened, untouched and closed
       // (chunk 46, D7). Only the stale-date branch prunes; a parse failure
@@ -163,19 +168,22 @@ export function useTodayPlan(
   tasks: Task[],
   marks: TodayMark[] | null,
   writeMark: WriteTodayMark,
+  timeZone: string,
 ): TodayPlan {
-  // `day` is the local day the plan is being resolved for. Every write stamps
+  // `day` is the day (in `timeZone`) the plan is being resolved for. Every write stamps
   // THIS key, not the wall clock, and only marks carrying it count — so a tab
   // open across midnight keeps one consistent frame until `rollIfNewDay`
   // observes the change.
   const [initial] = useState(() => {
-    const day = dayKey(new Date())
+    const day = dateKeyIn(new Date(), timeZone)
     const deltas = resolveTodayDeltas(marks, tasks, day, new Map())
     return { day, deltas, signature: deltasSignature(deltas) }
   })
   const dayRef = useRef(initial.day)
+  // The zone membership was last derived in; a change re-seeds (see effect).
+  const zoneRef = useRef(timeZone)
   const [membership, setMembership] = useState<Set<string>>(() =>
-    applyTodayDeltas(autoTodayIds(tasks), initial.deltas),
+    applyTodayDeltas(autoTodayIds(tasks, timeZone), initial.deltas),
   )
   // The task-id set from the render that last seeded/reconciled membership.
   const idsRef = useRef<Set<string>>(new Set(tasks.map((t) => t.id)))
@@ -197,10 +205,12 @@ export function useTodayPlan(
   const tasksRef = useRef(tasks)
   const marksRef = useRef(marks)
   const writeMarkRef = useRef(writeMark)
+  const timeZoneRef = useRef(timeZone)
   useEffect(() => {
     tasksRef.current = tasks
     marksRef.current = marks
     writeMarkRef.current = writeMark
+    timeZoneRef.current = timeZone
   })

   // Send one mark. Offline is not a failure — the repo queues the write — so
@@ -218,12 +228,12 @@ export function useTodayPlan(

   // Day rollover, observed lazily on the next interaction or task refresh —
   // deliberately no timer/interval/visibility listener (the app has no
-  // day-tick). When the local day has changed, yesterday's plan is over:
+  // day-tick). When the day (in the Settings zone) has changed, yesterday's plan is over:
   // its marks no longer match `dayRef` and this session's toggles are
   // dropped. Nothing is written — a stale mark is overwritten by the next
   // toggle of its task.
   const rollIfNewDay = useCallback((now: Date): boolean => {
-    const key = dayKey(now)
+    const key = dateKeyIn(now, timeZoneRef.current)
     if (key === dayRef.current) return false
     localWritesRef.current.clear()
     dayRef.current = key
@@ -239,6 +249,10 @@ export function useTodayPlan(
   // setState mirrors the SubcategorySection linger idiom.
   useEffect(() => {
     const rolled = rollIfNewDay(new Date())
+    // A Settings-zone change moves the day frame: re-derive the auto signals
+    // in the new zone (this session's toggles for the day are kept).
+    const rezoned = zoneRef.current !== timeZone
+    zoneRef.current = timeZone
     const day = dayRef.current
     const curIds = tasks.map((t) => t.id)
     const prevIds = idsRef.current
@@ -277,24 +291,28 @@ export function useTodayPlan(
     const deltas = resolveTodayDeltas(marks, tasks, day, localWritesRef.current)
     const signature = deltasSignature(deltas)
     const deltasChanged = signature !== signatureRef.current
-    if (!changed && !rolled && !deltasChanged) return
+    if (!changed && !rolled && !rezoned && !deltasChanged) return
     idsRef.current = new Set(curIds)
     signatureRef.current = signature
     // After a roll the previous membership is yesterday's resolved set —
     // re-seed from the auto signals rather than layering the deltas over it.
     setMembership((cur) => {
-      if (rolled) return applyTodayDeltas(autoTodayIds(tasks), deltas)
-      const base = changed ? reconcileTodayMembership(cur, prevIds, tasks) : cur
+      if (rolled || rezoned) {
+        return applyTodayDeltas(autoTodayIds(tasks, timeZone), deltas)
+      }
+      const base = changed
+        ? reconcileTodayMembership(cur, prevIds, tasks, timeZone)
+        : cur
       return applyTodayDeltas(base, deltas)
     })
-  }, [tasks, marks, rollIfNewDay, sendMark])
+  }, [tasks, marks, timeZone, rollIfNewDay, sendMark])

   const toggleToday = useCallback(
     (id: string, force?: boolean) => {
       const rolled = rollIfNewDay(new Date())
       const cur = rolled
         ? applyTodayDeltas(
-            autoTodayIds(tasksRef.current),
+            autoTodayIds(tasksRef.current, timeZoneRef.current),
             resolveTodayDeltas(
               marksRef.current,
               tasksRef.current,
```
