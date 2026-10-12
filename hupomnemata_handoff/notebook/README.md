# Handoff: Notebook

## Overview
**Notebook** is the sixth primary tab of Hupomnemata: Dashboard · Planner · Routines · Insights ·
**Notebook** · Settings. One model: a note has an optional title, a body, `pinned`,
`created_at` / `updated_at`, and zero or one attachment (a task or a subcategory). Unattached
= freeform. The existing per-task notes field (`EditNotesDialog`) becomes a note attached to
the task; a task may hold several notes (operator decision, 2026-10-12). One place to write,
reachable from the Notebook, the task row, and the planner block.

**Operator decisions applied (2026-10-12):** title optional · many notes per task (no conflict
case) · notes on completed tasks follow the existing hide-completed preference.

```
notebook/
├── README.md          ← you are here — the authoritative spec
├── DESIGN_NOTES.md    ← geometry, the six-tab nav, formatting-entry choice, pushbacks
├── PROMPT.md          ← stub; written by the orchestrator after review
└── prototype/         ← runnable reference: open "Notebook.html"
    ├── Notebook.html             tokens + shell (4 screen tabs, Tweaks: device / data / save state)
    ├── notebook/                 notebook-data (mock + helpers), NoteList, NoteEditor, AttachPicker,
    │                             NotebookScreen (+ six-tab chrome), EntitySide (task rows, sheet, drill-down, block sheet)
    └── src/, tweaks-panel.jsx    app primitives/icons the shell reuses (unchanged copies)
```

## About the design files
Design references in HTML/React-via-Babel, not production code. Recreate in the app
(React + TypeScript + Tailwind + shadcn/ui) with its own primitives: `Sheet`, `Dialog`,
`AlertDialog`, `DropdownMenu`, `nav-tabs`, `.label`/`.num`, `catColor`. The pure helpers in
`notebook/notebook-data.jsx` (`nbExcerpt`, `nbFirstLine`, `nbRel`, the D4 renderer) describe
intended behavior; port them idiomatically.

## Fidelity
High. Colors, type, spacing, radii and copy are final. Every string in §Copy ships as written.

## Design tokens
Daylight only, emerald category palette (`--work #059669`, `--personal #f43f5e`). The feature
uses `--bg / --bg-alt / --surface / --surface-2`, `--line / --line-strong`, the ink scale,
`--accent` + `--accent-soft` + `--accent-ink`, `--destructive`, `--good / --warn / --offline`
(save-state dot), radii 4/7/11/16, `--shadow-sm/md/lg`, Newsreader `.title`, Inter, Plex Mono
`.label`/`.num`. Subcategory dots use the existing `subColor(id)` jewel hue.

### New values
None. Derived only: search highlight = `--accent-soft` fill + `--accent-ink` text; detached chip
= `1px dashed --line-strong` outline, `--ink-4` dot, `--ink-3` text; sheet/dialog veils use
`rgba(34,31,40,.30/.38)`, which is the existing `--ink` at the existing veil alphas (the
prototype's legacy warm veil was neutralized, as the app README allows).

## Data shape (prototype mock; schema is written after review)
```
Note { id, title: string ('' allowed), body: string, pinned: bool,
       createdAt, updatedAt, attachment: { kind: 'task'|'subcategory', id } | null }
```
Invariants the UI assumes: a task or subcategory may have many notes; deleting a task or
subcategory sets `attachment = null` on its notes (D3) and nothing else; a note attached to a
completed task is "on a completed task" for the hide-completed preference.

## Screens

### 1. Notebook — list + editor (`NotebookScreen.jsx`, `NoteList.jsx`, `NoteEditor.jsx`)
- **Desktop ≥1024 / iPad 744:** two panes. List 340px (300px on iPad) with a 1px `--line`
  right rule on a 55% `--surface` wash; editor on `--surface`. App header carries the six tabs.
- **Phone 375:** list full-screen under a 32px `.title` "Notebook" + `.label` count line and a
  44px round `--accent` "+" button; tapping a row pushes a full-screen editor (back chevron,
  44px). The bottom nav hides inside the editor to give the keyboard room.
- **List header:** `.title` "Notebook" 26px + `New note` primary button.
- **Search:** `Input` with search glyph, 36px (44px on touch, 16px text), placeholder
  "Search notes"; searches title and body; a clear "×" appears when non-empty.
- **Filter segment:** pill track on `--bg-alt`, selected = `--surface` + `--shadow-sm`, 600:
  **All · Freeform · Attached**.
- **Row:** `[title-or-first-line 14/600] [updated, Plex Mono 11 --ink-3]` over a two-line
  excerpt (12.5, `--ink-2`, lines joined with " · "), then the attachment chip when attached
  (category dot + task or subcategory name; `TASK` micro-label on task chips at md size).
  Untitled notes show their first line in italic `--ink-2`. Active row = `--accent-soft` fill +
  3px `--accent` left edge; hover `--bg-alt`. Min height 44.
- **Grouping:** `.label PINNED` → pinned notes by recency, `.label RECENT` → the rest.
- **Hide completed:** when the existing preference is on, notes attached to completed tasks are
  left out of the list; a `.label` reveal row at the bottom reads `+N ON COMPLETED TASKS`
  (session-scoped, like the dashboard's `+N COMPLETED`). Search still finds them once revealed.
  Freeform and subcategory notes are never hidden.
- **Search results:** the matched substring is highlighted (`<mark>`, `--accent-soft` /
  `--accent-ink`, 600) in title and excerpt; the excerpt swaps to the body line containing
  the first match, trimmed to ~40 characters before it.

### 2. Editor (`NoteEditor.jsx`)
- **Header row** (14/18px padding, 1px rule): `[attachment control] … [save state] [pin] [delete]`.
  Controls are 28px on pointer, 40px on touch.
  - Attachment control: when attached, the chip (tap → picker, pre-navigated to the current
    location) + an unlink icon that detaches immediately with a toast. When freeform, a
    ghost `Attach` button with the link glyph.
  - Save state reuses the SyncBadge dot vocabulary at caption scale (7px dot, 11.5px
    `--ink-3`): `● Saved` (`--good`), `● Syncing` (`--warn`, pulse), `● Offline · saved on
    this device` (`--offline`), `● Offline · 1 change queued` (`--offline`). Tweaks →
    "Play offline edit → synced" runs queued → syncing → saved.
  - Pin: outline glyph, filled + `--accent` when pinned. Delete: trash → AlertDialog.
- **Body:** title is a borderless `.title` input (30px desktop / 26 phone / 22 in the sheet,
  placeholder "Untitled"), then the note. Content column max 720px, 36px side padding
  (20 on phone). Footer `.label CREATED OCT 3 · UPDATED 42M AGO`.
- **Formatting (D4):** paragraphs, `#` → 22px `.title`, `##` → 15/600, `-` → bulleted list,
  `[text](url)` and bare URLs → links in `--accent-ink`. No checkboxes, images or attachments.
  **Entry = Markdown-as-you-type** (see DESIGN_NOTES). The prototype approximates it as
  source-on-focus / rendered-on-blur; the hint "Write. `#` for a heading, `-` for a list, paste
  a link to link it." is the empty-body placeholder and the footer hint while editing.
- **Autosave:** no Save button anywhere. Edits debounce into the outbox; the save-state dot is
  the only feedback.
- **Detached note (D3):** a `--bg-alt` strip above the title: unlink glyph + "Detached from
  **Q3 planning**, which was deleted on Oct 9. The note was kept." The list row shows a hollow
  dashed chip with the old name struck through. The note is otherwise a normal freeform note.

### 3. Attach picker (`AttachPicker.jsx`)
A `Dialog` with a stepped list (44px rows), mirroring the "Move to…" cascade:
`Attach to › Work › Atlas launch`. Breadcrumb in the title; earlier crumbs are tappable.
- Step 1: Work / Personal with category dots.
- Step 2: the category's subcategories with jewel dots; a check marks the current attachment.
- Step 3: **Attach to this list** (600) first, then `.label OR A TASK IN ATLAS LAUNCH` and the
  tasks. Completed tasks render struck and muted but remain pickable. Tasks that already hold
  notes show an `N NOTES` micro-label.
- Footer when the note is already attached: "Detaching keeps the note as freeform." + `Detach`.
- **No conflict case.** A task may hold many notes, so picking a task always attaches.

### 4. Entity side (`EntitySide.jsx`)
- **Task row indicator:** a 14px note glyph in `--ink-3` in a dedicated grid column between
  title and estimate, on Dashboard, Category and Subcategory rows; a Plex Mono count follows it
  when the task has more than one note. Column is reserved so rows never shift; empty when no
  note. Tapping it opens the notes. The ⋯ menu item reads **Notes** (with the relative updated
  time, or the count, at right) or **Add a note** when none exists; it replaces "Edit notes" /
  `EditNotesDialog`.
- **Opening = a Sheet** (right on pointer, bottom on touch, 480px), titled with the category
  dot + task title. One note → the embedded `NoteEditor` directly. Several → a list of the
  task's notes (first line · updated · two-line excerpt) with `New note` and `Open in Notebook`
  below; tapping a row shows the editor with a back chevron in the sheet title. The editor's ⋯
  menu holds **Open in Notebook**, **New note on this task** and **Delete note**. Rationale in
  DESIGN_NOTES.
- **Subcategory header (dashboard card):** lists with notes show `glyph + count` in `--ink-3`
  beside the open-count figure.
- **Subcategory drill-down:** after the task list, a `.label NOTES · N` section with a
  `New note here` ghost button and a card of rows (first line · updated · "On this list" or
  glyph + task title). It includes notes attached to the list *and* to its tasks. Rows open
  the sheet (task notes) or the Notebook (list notes). `New note here` creates a note attached
  to the list and opens it in the Notebook. Empty: "No notes on this list yet."

### 5. Planner block sheet (`PlannerBlockSide`)
Inside the existing block action sheet, between the range line and the actions: a
`--surface-2` card with `.label NOTE` (or `NOTES · N`) · `updated 42m` (or `latest 42m`) ·
`Open →`, then the most recent note's title (13/600) and a three-line clamped excerpt in
`--ink-2`. Read-only. Blocks whose task has a note carry the
14px glyph after the title (only when the block is tall enough to show the range). Phone and
desktop; the block itself is the planner's existing white card with the 3px category edge.

### 6. States
| State | Where | Treatment |
|---|---|---|
| Empty notebook | Tweaks → Notes: empty | Dashed card (2px `--line-strong`), `.title` "Nothing written yet." + body + `New note` primary. Search/filter hidden. Editor pane blank. |
| Empty search | type a non-matching query | Dashed card, "No notes match “xyz”." + "Search looks at titles and bodies. Try another word, or clear the filter." |
| Empty filter | Attached/Freeform with no results | same card, copy per filter (see Copy). |
| Detached note | Tweaks → Jump to: Detached note (`n6`) | §2 strip + hollow chip. |
| Offline edit | Tweaks → Play offline edit → synced | `Offline · 1 change queued` → `Syncing` (pulse) → `Saved`. Header SyncBadge follows. |
| Long note on phone | Device: iPhone 375, note `n1` | Header stays fixed; body scrolls; bottom nav hidden; 16px body text. |
| Hidden completed | Tweaks → Completed tasks: hide (default) | list omits notes on completed tasks; `+1 ON COMPLETED TASKS` reveal row. |
| Many notes on a task | Task side → "Ship the pricing page" (2 notes) | glyph + count; sheet opens as a list. |

## Copy (ships as written)
- Tab: **Notebook**. Phone label: **Notebook**.
- Buttons: `New note` · `New note here` · `Attach` · `Attach to this list` · `Detach` ·
  `Open in Notebook` · `Open` · `Delete` · `Cancel`.
- Menu items (task ⋯): `Notes` / `Add a note`. Sheet menu: `Open in Notebook`, `New note on this task`, `Delete note`.
- Placeholders: title `Untitled`; body `Write. # for a heading, - for a list, paste a link to link it.`; search `Search notes`.
- Labels: `PINNED`, `RECENT`, `NOTES · N`, `NOTE`, `OR A TASK IN {list}`, `N NOTES`, `TASK`, `+N ON COMPLETED TASKS`, `HIDE COMPLETED TASKS’ NOTES`.
- Save state: `Saved` · `Syncing` · `Offline · saved on this device` · `Offline · 1 change queued` (pluralize `changes`).
- Empty notebook: **Nothing written yet.** — Notes can stand alone or sit beside a task or list. Start one here, or from any task's menu.
- Empty search: **No notes match “{q}”.** — Search looks at titles and bodies. Try another word, or clear the filter.
- Empty Attached filter: **No notes here.** — Attach a note to a task or list from its header, or from a task's menu.
- Empty Freeform filter: **No notes here.** — Every note is attached to a task or list. Start a freeform one with New note.
- Empty list notes: No notes on this list yet.
- Detached strip: Detached from **{name}**, which was deleted on {date}. The note was kept.
- Picker footer: Detaching keeps the note as freeform.
- Delete confirm (AlertDialog): **Delete this note?** — This cannot be undone. (attached:) The task/list **{name}** is not affected. Actions `Cancel` · `Delete` (destructive).
- Toasts: `Attached to {name}.` · `Detached from {name}.` · `Detached from {task}. It is now a freeform note.` · `Note moved.` · `Note deleted.`

## Interactions
- Pinned first, then recency; search and the All/Freeform/Attached segment compose.
- Selecting a row never navigates away from the Notebook; opening from a task opens the sheet.
- Attach/detach/pin/delete are available in the editor header everywhere the editor appears.
- Detach from the header is immediate (toast, no confirm). Delete always confirms.
- Completing or archiving a task or list changes nothing about its notes (D3); the Notebook
  list only hides completed tasks' notes while the hide-completed preference is on.
- Touch targets ≥44pt, inputs 16px on touch, chevron drill-down, no long-press (§13).

## Files
Open `prototype/Notebook.html`. Top tabs: Notebook · Task side · Dashboard · Task side ·
Subcategory · Planner block. Tweaks: Device (Desktop / iPad 744 / iPhone 375), Notes
(populated / empty), Save state, Completed tasks (hide / show), the offline playback, and
jump-tos for search, the detached note and the long note.
