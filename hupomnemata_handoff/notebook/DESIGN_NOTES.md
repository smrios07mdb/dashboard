# Notebook — design notes

Reference prototype for the Notebook tab, the attach picker, the task-side note sheet, the
subcategory Notes section and the planner block preview. Entry point: `prototype/Notebook.html`.

## Geometry (exact values)

| Element | Desktop ≥1024 | iPad 744 | Phone 375 |
|---|---|---|---|
| List pane | 340px, 1px `--line` right rule | 300px | full width |
| List header | `.title` 26 · `New note` 32px | same | `.title` 32 + `.label` count · 44px round + |
| Search input | 36px, 13px text | 44px, 16px | 44px, 16px |
| Segment | 26px pills | 32px | 32px |
| Row padding | 11 14 | 13 16 | 13 16 |
| Row active | `--accent-soft` + 3px `--accent` edge | same | n/a (push) |
| Editor header | 14 18, controls 28 | controls 40 | 8 10, back 44, controls 40 |
| Title input | 30px `.title` | 30 | 26 |
| Body column | max 720, 36px sides, 15px/1.6 | 36px, 16px | 20px, 16px |
| Sheet | right, 480px | bottom, 88vh | bottom, 88vh |
| Picker rows | 44px | 44 | 44 |
| Bottom nav | — | — | 6 × 62.5px, 60px + safe area |

Save-state dot: 7px, label 11.5px `--ink-3`. Note glyph in rows: 14px in a 24px slot (44px on
touch). Chips: 999 radius, 1px `--line`, 12px (11px `sm` in list rows), 7px category dot.

## D6 — six tabs at 375px

Six items fit without changing the primitive. Each cell is 62.5px wide and 60px tall (10px top
padding, 20px icon, 4px gap, 10px label, 12px bottom), both over 44pt. The longest labels
(Routines, Notebook, Settings) measure ~48px at 10px Inter 500, inside the 62.5px cell with no
truncation. Desktop top tabs take the sixth item without wrapping down to 744px (compact 9px
horizontal padding on iPad, 14px on desktop). Icon: an open-book glyph in the app's 1.6px
stroke style. If a seventh tab ever arrives, the fallback is a "More" cell, not dropping
Notebook; it is not needed now.

## Formatting entry — Markdown-as-you-type, no toolbar

Chosen over a minimal toolbar because:
- D4 allows exactly four things (headings, lists, links, paragraphs). Four shortcuts are
  learnable in one line of placeholder copy; a toolbar is persistent chrome for four buttons.
- On a phone a toolbar sits above the keyboard and takes 44px from an already short viewport
  during the longest notes. The brief asks for the long-note case specifically.
- The product's voice is quiet; the editor should look like a page, not an app.
- No checkboxes means the one shortcut people most expect from a toolbar is not offered anyway.

Production: a live editor (Tiptap/ProseMirror with markdown input rules, or CodeMirror in
markdown mode) with `#`, `##`, `-`, and link autolinking on paste. Rendered inline as typed;
no preview/source toggle. The prototype's source-on-focus / rendered-on-blur is an
approximation only. Keep raw Markdown as the stored body.

## Task side — a sheet, not a jump

Opening a task's note from the row or ⋯ menu opens a Sheet holding the same editor, with
"Open in Notebook" in its menu. Reasons: the row lives in a drill-down that a tab switch would
lose; the sheet is the app's existing pattern for task-adjacent work (Block time, Schedule); and
`EditNotesDialog` was already an overlay, so the mental model carries. The Notebook is for
reading across notes; the sheet is for writing beside the task.

## Attach picker — a stepped Dialog, not nested submenus

"Move to…" is a DropdownMenuSub cascade, which fails on touch (hover-opened submenus, 32px
rows). The picker keeps the same Work → list → task order but as one Dialog with 44px rows and a
tappable breadcrumb. Recommend the same shell for Move to… on touch later; out of scope here.

## Detach vs delete (D3)

Deleting a task or list never deletes notes. The note keeps a memo of what it was attached to
(name, category, date) so the strip can say where it came from; this is display-only and can be
dropped after the user re-attaches or edits the note. User-initiated detach from the editor
header is immediate with a toast, since the note loses nothing.

## Pushbacks and departures

1. **D5 at ~200 notes.** Pinned + recency + search + the attachment filter hold up to roughly
   100–150 notes; beyond that, the Attached filter is too coarse (it mixes every list). The
   cheapest fix that is not tags: let the attachment chip in the list be a filter (tap a chip →
   "Notes on Atlas launch"). The subcategory drill-down already gives this view, so the
   Notebook can defer it. Flagging, not designing.
2. **Many notes per task** (operator, 2026-10-12; departs from D2's "at most one"). The
   conflict dialog is gone; the row glyph gains a count; the task sheet opens as a list when
   there is more than one note; the planner preview shows the latest. `tasks.notes` migrates to
   one note per task that had text.
3. **Completed tasks' notes follow hide-completed** (operator, 2026-10-12). The Notebook list
   omits them while the preference is on and offers a `+N ON COMPLETED TASKS` reveal; the
   subcategory drill-down and the task sheet always show them.
4. **Phone editor hides the bottom nav.** The brief did not ask for it; done for keyboard room
   and because the back chevron is the way out. Reverse if the nav must be omnipresent.
5. **Subcategory Notes section includes task notes.** The brief says "its notes"; the section
   shows notes on the list and on its tasks, labelled per row, because a list page that omitted
   task notes would under-count what the user wrote there.
6. **No "Edit notes" in the task menu.** Replaced by `Notes` / `Add a note`. The Block time
   sheet's "Include notes in calendar event" option should read the attached note's body.

## Handoff guardrails

- Tokens only; zero new values. Light only. No XP, streaks or celebration on notes.
- Reuses `Button`, `IconBtn`, `Input`, `Check`, `Menu`, `Sheet`, `Dialog`, `SyncBadge`, `Toast`,
  `TopTabs`, icons, `.label`, `.num`, `catColor`, `fmtMin`. New glyphs: note, pin, book, unlink.
- Screens are self-contained; the shell passes `device`, `saveState`, `notes/setNotes` and a
  toast callback.
