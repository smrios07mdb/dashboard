# Chunk 65: Every text field is 16px on touch, so iOS never focus-zooms (Day-7 #9)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). App code only: no SQL, no migration, no proxy.

**Bases:**
- App `smrios07mdb/dashboard` @ `d904cb3` (docs). Last code commit `66b5f71` (chunk 64), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md`, ARCHITECTURE §13 (the line "Inline inputs render at ≥16px font-size on touch…"), PROGRESS row 19, the PROGRESS decisions-log row "(chunk 19, UX-03)", and Day-7 backlog item 9 first.

**Scope:** PROGRESS Revisions → Day-7 backlog item **9** (focus-zoom outliers), widened to every field with the same defect (D1).

---

## The defect, as committed at `d904cb3`

iOS Safari zooms the viewport when a text-entry field under 16px takes focus, and leaves it zoomed. Chunk 19 (UX-03) fixed three inputs with `text-base sm:text-[Npx]` (16px on mobile, compact at `sm:`+). Item 9 recorded two outliers it missed (`SubcategoryHeader` rename, What's-Next minutes), both confirmed zooming on Sergio's iPhone on 2026-05-31.

The orchestrator scanned every `<input>`, `<textarea>`, `<select>`, `<Input>` and `<Textarea>` in `src/` (excluding `src/components/ui/`, tests, and checkbox/radio/range/color/file/hidden inputs). **Twelve** fields render under 16px on a phone, not two. The other ten were added after chunk 19 or were never in its list:

| # | File (line at `d904cb3`) | Field | Mobile size now |
|---|---|---|---|
| 1 | `src/components/SubcategoryHeader.tsx:192` | Subcategory rename | `text-[14px]` |
| 2 | `src/components/WhatsNextSheet.tsx:210` | What's-Next "I have __ minutes" | `text-[13px]` |
| 3 | `src/components/AddSubcategoryInline.tsx:108` | New subcategory name (`<Input>`) | `text-[13px]` (overrides the primitive's `text-base` via `cn`) |
| 4 | `src/components/RoutinePanel.tsx:335` | Routine item rename | `text-[14px]` |
| 5 | `src/components/RoutinePanel.tsx:491` | New routine item (`<Input>`) | `text-[14px]` |
| 6 | `src/components/DeleteSubcategoryDialog.tsx:130` | Target subcategory `<select>` | `text-[13px]` |
| 7 | `src/components/MergeSubcategoryDialog.tsx:83` | Target subcategory `<select>` | `text-[13px]` |
| 8 | `src/components/SetReminderPopover.tsx:130` | Reminder `datetime-local` | `text-[13px]` |
| 9 | `src/components/planner/ScheduleSheet.tsx:195` | Custom start `time` | `text-[13px]` |
| 10 | `src/screens/Settings.tsx:870` | "Planner writes to" `<select>` | `text-[13px]` |
| 11 | `src/screens/Settings.tsx:1116` | Outlook ICS link (`<Input>`) | `text-[12px]` |
| 12 | `src/components/gamify/DailyHero.tsx:313` | Today hero "I have __ min" | inline `fontSize: 15` |

Already correct and left alone: `TaskRow` title and minutes, `AddTaskInline` (both), Notebook title (22–30px), Notebook body and search (`touch ? 'text-[16px]' : …`), `Login`, and every `Settings` `<Input>` that keeps the primitive's `text-base md:text-sm`.

The orchestrator applied the D2 edits and the D3 test to a fresh clone of `d904cb3` (Node 22, clean `npm ci`, placeholder env except the real `VITE_CALDAV_PROXY_URL`):
- Before: `vitest run` **835 / 835** (74 files), build green, eager JS **1,028,463 B**.
- D3 test against the unedited components: fails at `src/lib/iosFocusZoom.test.ts:78:25` listing exactly the twelve `file:line` entries above.
- After: `tsc -b` clean, `eslint .` 0 problems, `vitest run` **837 / 837** (75 files), build green, eager JS **1,028,606 B** (+143 B).

---

## Locked decisions

### D1 Fix all twelve, not only the two in item 9

Same bug, same one-token fix, same PR. Item 9's text names two; the backlog row is closed with a note that the sweep found ten more.

### D2 The edit: mirror chunk-19 UX-03 exactly

Prefix each field's compact size with `text-base` and move the compact size behind `sm:`. Each `old` string occurs exactly once in its file.

| # | File | Replace | With |
|---|---|---|---|
| 1 | `SubcategoryHeader.tsx` | `'min-w-0 flex-1 rounded-sm bg-background px-2 py-1 text-[14px] font-medium` | `'min-w-0 flex-1 rounded-sm bg-background px-2 py-1 text-base sm:text-[14px] font-medium` |
| 2 | `WhatsNextSheet.tsx` | `px-2 py-1 text-right font-mono text-[13px] text-ink` | `px-2 py-1 text-right font-mono text-base sm:text-[13px] text-ink` |
| 3 | `AddSubcategoryInline.tsx` | `'h-8 bg-background px-2 py-1 text-[13px]'` | `'h-8 bg-background px-2 py-1 text-base sm:text-[13px]'` |
| 4 | `RoutinePanel.tsx` | `'min-w-0 rounded-sm bg-bg-alt px-2 py-1 text-[14px] text-ink` | `'min-w-0 rounded-sm bg-bg-alt px-2 py-1 text-base sm:text-[14px] text-ink` |
| 5 | `RoutinePanel.tsx` | `'h-9 bg-bg-alt text-[14px]'` | `'h-9 bg-bg-alt text-base sm:text-[14px]'` |
| 6 | `DeleteSubcategoryDialog.tsx` | `px-2 py-1 text-[13px] text-foreground` | `px-2 py-1 text-base sm:text-[13px] text-foreground` |
| 7 | `MergeSubcategoryDialog.tsx` | `px-2 py-1 text-[13px] text-foreground` | `px-2 py-1 text-base sm:text-[13px] text-foreground` |
| 8 | `SetReminderPopover.tsx` | `px-2 py-1 text-[13px] text-foreground` | `px-2 py-1 text-base sm:text-[13px] text-foreground` |
| 9 | `planner/ScheduleSheet.tsx` | `"mono h-[38px] rounded px-2.5 text-[13px] text-ink"` | `"mono h-[38px] rounded px-2.5 text-base sm:text-[13px] text-ink"` |
| 10 | `screens/Settings.tsx` | `bg-surface px-2 text-[13px] text-ink focus-visible` | `bg-surface px-2 text-base sm:text-[13px] text-ink focus-visible` |
| 11 | `screens/Settings.tsx` | `className="mono text-[12px]"` | `className="mono text-base sm:text-[12px]"` |
| 12 | `gamify/DailyHero.tsx` | on the "Available minutes" `<input>`: `className="num"` | `className="num text-base sm:text-[15px]"`, and delete the `fontSize: 15,` line from that input's `style` object (and only that one; the sibling `min` span keeps its `fontSize: 11`) |

- No other class, layout, width or behaviour change. The DailyHero input stays `width: 42` (three 16px mono digits fit).
- At `sm:` and up every field renders exactly as today. For the three `<Input>` fields (3, 5, 11), the primitive's `md:text-sm` still applies at `md:`+, as it already does at `d904cb3`.
- No new hook, no `useIsTouchDevice` gating, no global CSS rule, no viewport-meta change (`maximum-scale` would also block pinch-zoom on Android). The rule stays the one ARCH §13 already states.

### D3 Regression guard: `src/lib/iosFocusZoom.test.ts` (new), verbatim

```ts
import { describe, expect, it } from 'vitest'

/*
 * iOS focus-zoom guard (chunk 65, Day-7 #9; ARCH §13).
 *
 * iOS Safari zooms the viewport when a text-entry field under 16px takes
 * focus. Every <input>, <textarea> and <select> (and the shadcn <Input> /
 * <Textarea>) in src/ must therefore render at >= 16px on touch.
 *
 * Source scan, not a render: the size lives in Tailwind classes, which jsdom
 * cannot compute. For each field's opening tag:
 *   - an UNPREFIXED font-size token under 16px (`text-xs`, `text-sm`,
 *     `text-[Npx]` with N < 16) passes only if the same tag also carries an
 *     unprefixed >= 16px token (`text-base`, `text-[Npx]` with N >= 16).
 *     That covers `text-base sm:text-[13px]` (the prefixed compact size is
 *     ignored) and `touch ? 'text-[16px]' : 'text-[13px]'`.
 *   - an inline `fontSize: N` with N < 16 fails.
 * Checkbox / radio / range / color / file / hidden inputs are exempt.
 * Sources come in through Vite's raw glob, so no Node types are needed.
 */

const SOURCES = import.meta.glob<string>(
  ['/src/**/*.tsx', '!/src/**/*.test.tsx', '!/src/components/ui/**'],
  { query: '?raw', import: 'default', eager: true },
)
const EXEMPT_TYPES = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'hidden'])
const FIELD = /<(input|textarea|select|Input|Textarea)\b/g

/** Index of the `>` closing a JSX opening tag, skipping `{…}` and strings. */
function tagEnd(s: string, i: number): number {
  let depth = 0
  let quote: string | null = null
  for (; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return s.length
}

function px(token: string): number {
  if (token === 'text-xs') return 12
  if (token === 'text-sm') return 14
  if (token === 'text-base') return 16
  return Number(token.slice('text-['.length, -'px]'.length))
}

function offenders(): string[] {
  const out: string[] = []
  for (const [file, s] of Object.entries(SOURCES)) {
    for (const m of s.matchAll(FIELD)) {
      const start = m.index ?? 0
      // Skip matches inside comments (e.g. "Native `<input type=…>`").
      const lead = s.slice(s.lastIndexOf('\n', start) + 1, start).trimStart()
      if (lead.startsWith('*') || lead.startsWith('//') || lead.endsWith('`')) continue
      const tag = s.slice(start, tagEnd(s, start + m[0].length))
      const type = /\btype=["'](\w[\w-]*)/.exec(tag)?.[1]
      if (type && EXEMPT_TYPES.has(type)) continue
      const sizes = [...tag.matchAll(/(?<![\w:-])text-(?:xs|sm|base|\[\d+px\])(?![\w-])/g)].map(
        (x) => px(x[0]),
      )
      const inline = [...tag.matchAll(/\bfontSize:\s*(\d+)/g)].map((x) => Number(x[1]))
      const small = sizes.some((n) => n < 16) && !sizes.some((n) => n >= 16)
      if (small || inline.some((n) => n < 16)) {
        out.push(`${file}:${s.slice(0, start).split('\n').length}`)
      }
    }
  }
  return out.sort()
}

describe('iOS focus-zoom guard', () => {
  it('every text-entry field renders at >= 16px on touch', () => {
    expect(offenders()).toEqual([])
  })

  it('the scan finds the fields (sanity)', () => {
    const withFields = Object.values(SOURCES).filter((s) =>
      /<(input|textarea|select|Input|Textarea)\b/.test(s),
    )
    expect(withFields.length).toBeGreaterThan(10)
  })
})
```

- If `tsc -b`, `eslint .` or Prettier on your machine want a formatting change, make it and list it as a deviation. Do not change the rule.
- No existing test changes.

**Red-first:** with the new test in place and the D2 edits stashed (`git stash push -- src/components src/screens`), run `npx vitest run src/lib/iosFocusZoom.test.ts` and report the failing line and the list of `file:line` offenders. It must be exactly the twelve in the table. Then `git stash pop`.

### D4 What does not change

- `src/components/ui/input.tsx` and every other `ui/` primitive.
- `TaskRow`, `AddTaskInline`, the Notebook fields, `Login`.
- `index.html` viewport meta.
- No new dependency; `package.json` / `package-lock.json` unchanged. No Dexie, repo, realtime or migration change.

### D5 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`** (`dist/` changes): the ten component/screen files in D2 plus `src/lib/iosFocusZoom.test.ts`. Subject: `Chunk 65: every text field is 16px on touch, no iOS focus-zoom (Day-7 #9)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green (835 + 2 = 837 tests, 75 files expected); `npm run build` green.
- Eager JS before (at `d904cb3`) and after, on your machine. Limit **+2 kB** (expect about +150 B of class strings).
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

Expect `d904cb3`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record that eager-JS figure as the base. Make the D2 edits and add the D3 test. Run red-first (D3). Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat d904cb3 -- package.json package-lock.json
grep -n "fontSize: 15" src/components/gamify/DailyHero.tsx
git add src/components/SubcategoryHeader.tsx src/components/WhatsNextSheet.tsx src/components/AddSubcategoryInline.tsx src/components/RoutinePanel.tsx src/components/DeleteSubcategoryDialog.tsx src/components/MergeSubcategoryDialog.tsx src/components/SetReminderPopover.tsx src/components/planner/ScheduleSheet.tsx src/screens/Settings.tsx src/components/gamify/DailyHero.tsx src/lib/iosFocusZoom.test.ts
git status --short
git commit
git push origin main
```

`grep -n "fontSize: 15" src/components/gamify/DailyHero.tsx` must return nothing. The commit body lists D1–D2 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`. `git status --short` must show nothing else staged; anything unexpected, stop and report.

**Stop after the push and report.** Do not start step 3.

### 2. Verify (not you)

- **Orchestrator:** independent gate at your SHA (fresh clone, D3 red/green, test count, eager JS), and the deployed CSS bundle carries `sm:text-[12px]`, `sm:text-[13px]`, `sm:text-[14px]` and `sm:text-[15px]` inside the `@media (min-width: 640px)` block.
- **Sergio, on his iPhone (deployed PWA, portrait):** tap each field once; none may zoom the page. Subcategory rename; What's-Next minutes; Today hero minutes; + subcategory; a routine item rename and + routine item; Delete-subcategory and Merge-subcategory target pickers; a task's reminder; Planner custom start time; Settings → "Planner writes to" and the Outlook ICS link.

### 3. Docs (`[skip ci]`, after step 2 passes)

**`ARCHITECTURE.md` §13:** replace the line "Inline inputs render at ≥16px font-size on touch (compact only at `sm:` and up) so iOS Safari does not zoom the viewport on focus." with:
- Every text-entry field (inputs, textareas, selects, date/time pickers) renders at ≥16px font-size on touch, compact only at `sm:` and up, so iOS Safari does not zoom the viewport on focus. `src/lib/iosFocusZoom.test.ts` fails the build on any field that does not (chunk 65).

**`PROGRESS.md`**
- Row 65 ☑: the step-1 SHA, gates, red-first line and offender list, test count and file count, eager JS before/after, deploy run, live `version.json`, the step-2 results (orchestrator gate, CSS bundle markers, Sergio's on-device pass), deviations numbered.
- Day-7 backlog: item 9 → ☑ with `(done: chunk 65, <SHA> — both outliers fixed, plus ten more sub-16px fields found by the sweep; guarded by src/lib/iosFocusZoom.test.ts.)`; the status line becomes **9 done (☑), 1 moot, 1 open (☐)** with the chunk-65 date and SHA.
- Decisions log: D1 and D2 (2026-10-13, chunk 65), one row each; D2's row notes it extends the chunk-19 UX-03 row.
- Last-updated paragraph per the chunk-54 convention; the current chunk-64 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-65-ios-focus-zoom.md` in the same commit. A commit cannot carry its own SHA: if row 65 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- iPhone **landscape** (viewport ≥ 640px, so `sm:` applies and fields are compact): the chunk-19 fields behave the same way today. Not changed here.
- Day-7 item 11.
- Any font-size change outside the twelve fields, and any `ui/` primitive change.
- Touch targets, safe-area insets (done in chunk 19).

## Report back

- **Step 1:** commit SHA; `git diff --stat d904cb3 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count, build); red-first failing line and the twelve offenders; the empty `fontSize: 15` grep; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Every deviation, numbered.
