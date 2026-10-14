# Claude Code prompt — Chunk 80: deep routes survive a hard reload (SPA 404 fallback)

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `5e1c966` (code = `b9fe318`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

Build tooling only: no `src/` change, no SQL, no migration, no proxy, no new dependency. `vite.config.ts` and `src/sw.ts` are **not touched**, because the PWA config is a locked subsystem.

This prompt runs end to end: implement, ship, gate, smoke, docs. On any failure, stop at that point and report.

## Why (chunk-79 smoke, 2026-10-14)

- A hard reload on `/dashboard/settings` or `/dashboard/planner` returns GitHub Pages' own 404 page.
- Cause: GitHub Pages serves static files only, and `dist/` has no file at those paths.
  - The service worker's `NavigationRoute` (`src/sw.ts`) hides this for clients it controls.
  - A hard reload bypasses the worker.
  - So do a first visit, a fresh device, a cleared site, and any deep link opened outside the PWA.
- The same applies to every route under `BrowserRouter basename="/dashboard/"`, including `/dashboard/auth/callback`, `/dashboard/notebook/:id`, `/dashboard/category/:id` and `/dashboard/subcategory/:id`.

## How it works

1. GitHub Pages serves a project site's `404.html` for any unknown path under it, with HTTP status 404.
2. The built `dist/index.html` references every asset by an absolute `/dashboard/...` URL (`base: '/dashboard/'`), so the same file boots correctly at any depth.
3. Once booted, `BrowserRouter` reads the real path and renders the right route.
4. Unknown paths still fall through to the existing `path="*"` → `/` redirect.

## Decisions (locked)

- **D1 — Post-build copy, not a Vite plugin.** Add `scripts/spa-fallback.mjs` and change `package.json`:
  ```
  "build": "tsc -b && vite build && node scripts/spa-fallback.mjs"
  ```
  - The script runs after `vite build` has fully finished, so the injectManifest service worker is already generated and `404.html` can't enter the precache.
  - This keeps `vite.config.ts` and the PWA glob untouched.
  - `deploy.yml` already runs `npm run build`; no workflow change.
- **D2 — Script shape.** Plain Node ESM, zero deps, in the style of `scripts/gen-icons.mjs`. Header comment: what it does, why (link this chunk), and why it runs post-build (D1).
  - It exports `writeSpaFallback(distDir)`, which:
    - copies `<distDir>/index.html` to `<distDir>/404.html` byte for byte;
    - throws if `index.html` is missing;
    - returns the written path.
  - When run as a CLI (`import.meta.url` equals the argv path; resolve both with `fileURLToPath`/`resolve`), it calls `writeSpaFallback` on `dist/` next to `scripts/`, logs one line, and exits 1 on error.
- **D3 — Precache stays clean.** `404.html` must not appear in the built `dist/sw.js`. The navigation fallback stays `/dashboard/index.html`.
- **D4 — Tests, red-first against `5e1c966`.** Add `scripts/spa-fallback.test.ts`. Vitest's default include picks it up; ESLint lints it, as it does every `**/*.ts`.
  1. In a temp dir (`fs.mkdtempSync(os.tmpdir())`), write an `index.html`, call `writeSpaFallback`, and assert that `404.html` exists and is byte-identical to it.
  2. With no `index.html`, `writeSpaFallback` throws and writes nothing.
  3. `package.json`'s `scripts.build` ends with `&& node scripts/spa-fallback.mjs`.
  - **Red-first:** run the new file at base, with `package.json` restored from `5e1c966` and the script absent. Report the fail/pass counts. Every case must fail at base.
  - If the `.ts` test importing `.mjs` needs a type shim, add a sibling `scripts/spa-fallback.d.mts` declaring the export. No `@ts-ignore`, no tsconfig change.
- **D5 — Budget.** Eager JS delta is exactly **0 B**: app code doesn't change. Measure it the chunk-79 way (sum the script + modulepreload files referenced by `dist/index.html`). Base on the Mac is expected at 1,051,696 B, 7 files.
- **D6 — Docs scope** (Step 9 only, after the gate and smoke):
  - `ARCHITECTURE.md` §3 (hosting / `/dashboard/` base): one line. `npm run build` copies `dist/index.html` to `dist/404.html` post-build, so deep routes boot without the service worker. Pages answers them with status 404; this is expected. `404.html` is not precached.
  - `PROGRESS.md`:
    - row 80;
    - the decisions log (D1, D3);
    - Last-updated;
    - known gaps: remove the deep-route hard-reload 404 if row 79 or the gaps list records it;
    - row 79's docs column: replace "(this commit)" with `5e1c966`.
  - `CLAUDE.md` smoke-harness notes: one line saying a hard reload on a deep route now loads the app with document status 404, and that this is expected.
  - Commit this prompt to `prompts/`.

## Steps

1. **Sync.**
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   find .git -name '*.lock' -print
   git fetch origin && git checkout main && git pull --ff-only
   git rev-parse --short HEAD
   git status --short
   ```
   Expect:
   - no `.lock` files (delete any and re-run);
   - HEAD at `5e1c966`;
   - only `?? prompts/chunk-80-spa-404-fallback.md` untracked.
2. **Base build on the Mac.**
   ```bash
   npm ci && npm run build
   ls dist/404.html
   ```
   Expect: the build is green and `404.html` is absent. Record base eager JS.
3. **Tests red-first** (D4).
4. **Implement** D1–D2.
5. **Gates** (Mac):
   ```bash
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && npm run build
   cmp dist/index.html dist/404.html && echo IDENTICAL
   grep -c '404.html' dist/sw.js
   grep -o '[A-Za-z0-9_./-]*\.html' dist/sw.js | sort -u
   ```
   Expect:
   - all gates green, with 103 files / 1,197 tests in both TZ runs (102/1,194 plus the new file's 3 cases; report the actual numbers);
   - `IDENTICAL`;
   - a `404.html` count of `0`;
   - only `index.html` in the precache html list;
   - an eager JS delta of 0 B.

   If the `sw.js` manifest format differs from the grep, inspect it and report what you checked.
6. **Ship the code alone.** Push without `[skip ci]`:
   ```bash
   git add package.json scripts/spa-fallback.mjs scripts/spa-fallback.test.ts
   git status --short
   git commit -m "fix(build): emit 404.html SPA fallback so deep routes survive a hard reload (chunk 80)" -m "Post-build copy of dist/index.html to dist/404.html; runs after the SW is generated, so it is not precached. vite.config.ts and src/sw.ts untouched." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   ```
   - Also `git add` the `.d.mts` shim if D4 needed it.
   - Wait for the run to finish green.
   - One `gh run rerun --failed` is allowed only if it failed on a GitHub-side 5xx while pushing to `gh-pages` (chunk 78 rule). Anything else, stop.
7. **Gate from a clean archive.**
   ```bash
   NEW=$(git rev-parse --short HEAD)
   rm -rf /tmp/c80 && mkdir -p /tmp/c80/base /tmp/c80/head
   git archive 5e1c966 | tar -x -C /tmp/c80/base
   git archive $NEW | tar -x -C /tmp/c80/head
   diff -rq /tmp/c80/base /tmp/c80/head
   cp .env.local /tmp/c80/head/
   cd /tmp/c80/head
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && npm run build
   cmp dist/index.html dist/404.html && echo IDENTICAL
   grep -c '404.html' dist/sw.js
   ```
   Expect:
   - `diff -rq` lists exactly `package.json` and the new `scripts/` files, with no `src/`, `vite.config.ts` or `.github/` changes;
   - all gates green;
   - `IDENTICAL`;
   - a `404.html` count of `0`.

   The `.env.local` needs the real `VITE_CALDAV_PROXY_URL` (CLAUDE.md, chunk 77).
8. **Live checks.**
   ```bash
   B=https://smrios07mdb.github.io/dashboard
   TS=$(date +%s)
   curl -s "$B/version.json?cb=$TS"
   for p in "" settings planner insights notebook auth/callback category/x nope; do
     printf '%-14s ' "/$p"; curl -s -o /tmp/c80/body -w '%{http_code} ' "$B/$p?cb=$TS"; shasum -a 256 /tmp/c80/body | cut -c1-16
   done
   curl -s "$B/404.html?cb=$TS" | shasum -a 256 | cut -c1-16
   shasum -a 256 /tmp/c80/head/dist/index.html | cut -c1-16
   ```
   Expect:
   - `version.json` shows `$NEW`;
   - `/` returns 200 and every other path returns 404;
   - every body hash, plus `404.html`'s, equals the local `dist/index.html` hash.

   Pages' CDN can lag a few minutes. If `version.json` is stale, re-check after 2 minutes, up to 10.

   **Smoke** with **Claude in Chrome** (Sergio's Chrome + extension), live site, read-only:
   1. Load the tools in one ToolSearch call.
   2. Open a new tab and bring it to the foreground. If `visibilityState` is `hidden`, ask Sergio to bring the window forward. Expect the first click after that to be swallowed.
   3. Load `/dashboard/`, then reload until `document.scripts` serves the same `index-*.js` as the live HTML (CLAUDE.md, chunk 77c).
   4. Navigate to `/dashboard/settings`, then **hard reload** (`cmd+shift+r`). Expect the Settings screen with its `01` Account kicker, the four tabs, and no Pages 404 text.
   5. Repeat step 4 for `/dashboard/planner` and `/dashboard/notebook`.
   6. Hard reload `/dashboard/nope`. Expect a redirect to `/dashboard/` and the Tasks screen.
   7. Normal reload of `/dashboard/settings` (service worker path). Expect the same Settings screen.
   8. Console: arm `read_console_messages` right after the first load. The only allowed entries are each hard reload's document-level `404` for its own URL. Report every entry verbatim.

   Report pass/fail per item, with the selector or text checked.
9. **Docs** (D6), only if Steps 5–8 are all green:
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   git add ARCHITECTURE.md PROGRESS.md CLAUDE.md prompts/chunk-80-spa-404-fallback.md
   git diff --cached --stat
   git commit -m "docs(chunk-80): SPA 404 fallback; close chunk 80 [skip ci]" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   rm -rf /tmp/c80
   find .git -name '*.lock' -print
   git status --short
   ```
   Expect:
   - no `src/` or `package.json` change in the docs commit;
   - no new deploy run;
   - `version.json` still `$NEW`;
   - a clean tree and no locks.

## Out of scope

- Any change to `vite.config.ts`, `src/sw.ts`, `deploy.yml`, routes, or `App.tsx`.
- Making deep routes answer 200; GitHub Pages can't without a different host.
- The background-tab menu `data-state="closed"` observation from chunk 79.
- #19.

## Report

Include:
- files changed + stat;
- red-first counts;
- the gate table on the Mac and from the clean archive (both TZ test counts);
- eager JS base, head and delta;
- the `cmp`/`sw.js` checks;
- the deploy run ID and `version.json`;
- the Step 8 curl table;
- smoke results per item, plus every console entry;
- the docs commit SHA and stat;
- any deviations, with a reason each;
- the final `git status --short`.
