# Dashboard

A single-user personal productivity PWA that unifies Work and Personal tasks across iPhone, iPad, and Mac. Tracks daily morning and night routines with streaks, integrates Apple Calendar via a CalDAV proxy, runs AI triage to recommend what to do next, and syncs across devices through Supabase.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the canonical system reference (stack, data model, sync, calendar, security). Process rules live in [`CLAUDE.md`](./CLAUDE.md) and current state in [`PROGRESS.md`](./PROGRESS.md); [`ORCHESTRATION.md`](./ORCHESTRATION.md) is kept for history and the Design → Code handoff pattern.

## Local development

```sh
cp .env.example .env.local   # fill in Supabase + proxy + VAPID keys
npm install
npm run dev                  # http://localhost:5173/dashboard/
npm test                     # run Vitest once
npm run build                # production bundle into dist/
```

## Menu bar app (macOS)

A Tauri v2 companion that shows the Today list from the Mac menu bar. It is built from this repo and uses the same `.env.local`. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §16.

Once per machine: the Xcode command line tools and Rust.

```sh
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
```

Once per machine, before the first `menubar:build`: make the local signing identity (chunk 95). The app is signed with a self-signed certificate so macOS remembers its permission to control Spotify across rebuilds.

```sh
bash menubar/scripts/make-signing-cert.sh    # prints "exists" if it is already there
```

It causes two macOS dialogs, each once:

1. **Now:** a password dialog, "You are making changes to your Certificate Trust Settings" — it trusts the new certificate for code signing.
2. **On the first build:** a keychain dialog, "codesign wants to sign using key…" — click **Always Allow**, or it returns on every build.

The first time the app controls Spotify, macOS asks "Hupomnemata wants access to control Spotify" — click **OK**. That first control does nothing (it times out behind the prompt); the next one works.

Build and install:

```sh
npm install
npm run menubar:build        # → menubar/src-tauri/target/release/bundle/macos/Hupomnemata.app
cp -R menubar/src-tauri/target/release/bundle/macos/Hupomnemata.app ~/Applications/
open ~/Applications/Hupomnemata.app
```

Click the `h.` icon in the menu bar, enter your email, then the 6-digit code from the sign-in email. To replace a running copy, choose Quit in the popover first.

Develop:

```sh
npm run menubar:dev          # the popover in a browser, http://localhost:1421/ (no tray, Tauri calls are no-ops)
npm run menubar:app          # in a second terminal: the real app against that dev server
npm run menubar:typecheck    # tsc for menubar/ (npm run build does not cover it)
npm test                     # includes menubar/src/*.test.ts(x)
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --manifest-path menubar/src-tauri/Cargo.toml   # the shell: pomodoro timer (chunk 94), Spotify control (chunk 95)
node menubar/src-tauri/icons/make-tray-icon.mjs   # regenerate the tray icon from the mark
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with `VITE_*` repository secrets and publishes `dist/` to the `gh-pages` branch. Each build also emits a `version.json` (git short SHA + timestamp) surfaced in **Settings → About**.

## Tech stack

React + Vite + TypeScript, Tailwind CSS + shadcn/ui, Supabase (Postgres + Auth + Realtime + Edge Functions), Dexie (offline cache + replay outbox), recharts (Insights), `vite-plugin-pwa` (installable PWA + Web Push). Deployed to GitHub Pages under `/dashboard/`.

## Related repositories

- [`dashboard-caldav-proxy`](https://github.com/smrios07mdb/dashboard-caldav-proxy) — brokers Apple Calendar over CalDAV: stores the app-specific password AES-GCM-encrypted, returns busy ranges, and creates events. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §7.
