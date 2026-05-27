# Chunk prompts — substitutions, corrections, and conventions

This file captures the corrections and conventions that apply across **every** chunk prompt in this directory. When running any chunk, **apply the substitutions and conventions below to the prompt's wording** — they override anything in a chunk prompt that contradicts them.

The chunk prompts were written before chunks 3, 5, 6, 7, and 8 settled the project's UI library choices, state patterns, and conventions. Rather than churning all 16 prompt files, the chunks shipped so far layered corrections via per-chunk briefs. This README extracts those corrections into one place so future chunk briefs can reference it instead of re-inlining them.

## Authority hierarchy

`ARCHITECTURE.md` wins over this file. This file wins over individual chunk prompts. A chunk-specific brief wins over this file for that one chunk (but should explain why it's deviating).

---

## Library substitutions

| Where a chunk prompt says | Use instead |
|---|---|
| "shadcn Toast" | **Sonner** — mounted at app root in `App.tsx` since chunk 3. No `<Toaster>` mount needed in new components; just `import { toast } from 'sonner'`. |
| "Confirm dialog" / shadcn `Dialog` for a destructive confirmation | shadcn **`AlertDialog`** — via the chunk-7 `DeleteConfirm.tsx` wrapper for plain confirms, or a fresh `AlertDialog`-based component when the dialog needs internal state (chunk 8's `DeleteSubcategoryDialog` and `MergeSubcategoryDialog` are the templates). |
| shadcn `Dialog` for content authoring (notes, settings forms, etc.) | shadcn `Dialog` — correct, no substitution. |

`AlertDialog` is reserved for destructive confirms. `Dialog` is for content authoring. Don't mix.

---

## State patterns

**Inline editing uses the draft-or-null pattern.** `useState<string | null>(null)` where `null` means "not editing." Render from prop when not editing; render from draft when editing. No `useEffect` syncing draft ← prop. This sidesteps both the realtime-during-edit clobber and the React 19 `react-hooks/set-state-in-effect` lint. Examples: `TaskRow.tsx` (chunk 7), `SubcategoryHeader.tsx` (chunk 8).

**Dialog reset-on-open uses the React-19 "adjust state during render" pattern.** Compare `prevOpen` vs `open` prop and call `setState` during render — NOT `useEffect`. The effect form trips the same lint. Examples: `DeleteSubcategoryDialog.tsx`, `MergeSubcategoryDialog.tsx` (chunk 8).

**Mutation optimism is component-level.** Handlers `await repo.<op>(...)` and update local `setState` with the returned value on success; on caught error, toast and don't update local state. No client-side UUID generation, no manual rollback. Offline optimism (writes hit Dexie + outbox even when Supabase is unreachable) lives inside `src/db/repo.ts` per the chunk-5-revised contract — components don't need to know about offline paths.

**Bulk operations enqueue per-row outbox entries offline**, not single batched entries. Keeps chunk-15's drain shape uniform. `tasks.bulkUpdate` / `tasks.bulkDelete` (chunk 8) follow this; future bulk ops should too.

**Render-layer filters live at the screen closest to the rendering need.** Not in the repo. The repo stays unopinionated and returns everything. Examples: archived subcategories filtered at `Dashboard.tsx`'s memos (chunk 8); completed tasks filtered at `SubcategorySection.tsx` (chunks 6/7).

---

## Validation UX (silent across all editors)

- Empty / invalid input → `aria-invalid` + red shadow (`shadow-[inset_0_0_0_1px_hsl(var(--destructive))]`).
- Enter is a no-op on invalid input.
- Escape reverts (rename) or stays open with cleared draft (add).
- Blur commits valid input or reverts invalid.
- **Toasts only for completed operations** — "Task added", "Subcategory deleted", "Tasks moved", "Merged into X", etc. Never toast on rejected input.
- **Errors get the normalized "Could not save — retry" pattern** — don't leak Supabase error text into the UI.

---

## Detection and platform

**Touch / no-hover detection: `useIsTouchDevice`** in `src/lib/useIsTouchDevice.ts` (chunk 8). Calls `matchMedia('(hover: none)').matches` once at mount per ARCH §13. **Reuse this hook** even if a chunk prompt suggests a different media query (e.g., `(hover: hover) and (pointer: fine)`). The hook returns `true` for touch; invert (`!useIsTouchDevice()`) where a prompt says "desktop only."

Do not introduce parallel `useIsDesktop` / `useHasHover` / similar hooks.

---

## Design canon paths

Chunk prompts sometimes reference design files using TSX shorthand (e.g., `design/Dashboard.tsx`). The actual files are JSX under `design/src/screens/`:

| Prompt shorthand | Actual path |
|---|---|
| `design/Login.tsx` | `design/src/screens/login.jsx` |
| `design/Dashboard.tsx` | `design/src/screens/dashboard.jsx` |
| `design/CategoryView.tsx` | `design/src/screens/category.jsx` |
| `design/SubcategoryView.tsx` | `design/src/screens/subcategory.jsx` |
| `design/Routines.tsx` | `design/src/screens/routines.jsx` |
| `design/Insights.tsx` | `design/src/screens/insights.jsx` |
| `design/Settings.tsx` | `design/src/screens/settings.jsx` |

If a prompt mentions a design file not in this table, check `design/src/screens/`, `design/src/sheets/`, or `design/src/` first before assuming it's missing.

---

## Locked subsystems (do not modify without an explicit Revisions chunk)

Verified end-to-end during chunk-7 and chunk-8 smokes (2026-05-26). Modifying any of these inside an unrelated chunk is a regression risk. If a chunk needs to touch one, treat it as a Revisions chunk-N pass with its own SHA — pattern: Bug A (chunk 2, `b0085a1`), Bug B (chunk 5, `c26bc23`), dev-gate (chunk 6, `9c3029d`).

- **`src/db/realtime.ts`** — postgres_changes subscription + 200 ms debounce. Coalesces bulk-burst events from move-to, cascade-delete, and merge operations.
- **`vite.config.ts` workbox config** — Supabase REST + GraphQL handlers are `NetworkOnly`; the offline contract holds end-to-end.
- **`src/db/repo.ts` offline paths** — Dexie + outbox on Supabase failure. Online path mirrors to Dexie. Any new repo method should follow the same shape.
- **`supabase/migrations/05_realtime.sql`** — all 7 user-scoped tables in the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. Any new user-scoped table requires both `alter publication supabase_realtime add table public.<name>;` and `alter table public.<name> replica identity full;` in its migration.
- **Chunk-3 `ProtectedLayout` + `AppShell` + `Tabs` route structure** — new authed screens are children of `ProtectedLayout`, not sibling routes. `AppShell`'s `headerEnd` and `topBanner` slots are the established extension points.

---

## Reuse existing infrastructure

When a chunk asks for something that overlaps with existing code, reuse rather than reinvent:

| Need | Use |
|---|---|
| Plain destructive confirm dialog | `DeleteConfirm` (chunk 7) |
| Destructive confirm with internal selection state | Fresh `AlertDialog`-based component; see `DeleteSubcategoryDialog` / `MergeSubcategoryDialog` (chunk 8) for shape |
| Touch / no-hover detection | `useIsTouchDevice` (chunk 8) |
| Toast | `toast` from `'sonner'` (chunk 3 mounts `<Toaster>` at app root) |
| Bulk update of N task rows | `repo.tasks.bulkUpdate` (chunk 8) |
| Bulk delete of N task rows | `repo.tasks.bulkDelete` (chunk 8) |
| Subcategory soft-delete | `repo.subcategories.archive` (chunk 8) |
| Subcategory reorder | `repo.subcategories.reorder` (chunk 8) |
| Triggering a Dashboard / drill-down refetch from outside the screen | Bump `uiStore.dashboardRefreshKey` via `forceDashboardRefresh()` — every screen that reads user content subscribes to this key (chunk 6 + chunk 9). |
| Sample-data seeding on deployed PWA (smoke testing) | Append `?dev=1` to the URL → Settings → Developer panel (chunk 6 + chunk-6 Revisions). |

---

## PROGRESS.md and Cowork ownership

`PROGRESS.md` is Cowork's lane. Claude Code passes do NOT touch it — even if a chunk prompt's acceptance criteria mention "update PROGRESS.md." Hand that to a follow-up Cowork pass after the implementation SHA is in hand. See `CLAUDE.md` → "Routine doc edits" for the full rule.

---

## How chunk briefs reference this file

Future chunk briefs (chunks 10–16) should open with:

> Run chunk N per `prompts/chunk-NN-...md`, referencing `ARCHITECTURE.md` §X and `prompts/README.md` for cross-chunk substitutions and conventions. Apply the README to the chunk prompt before anything else.

…followed by the chunk-specific pre-flight (decisions to flag, new infrastructure, out-of-scope items). This keeps briefs focused on what's actually unique to the chunk.

Chunk-9's brief inlined the substitutions in full because this file didn't exist yet. That's fine — chunk 9 is in flight. Chunks 10+ use the lighter shape.
