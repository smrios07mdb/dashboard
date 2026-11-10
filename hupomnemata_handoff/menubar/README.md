# Menu bar companion — design handoff

Unwired reference for the macOS menu bar app (chunks 91–98). Never imported by `src/` or `menubar/`.

- `prototype/hupomnemata-menu-bar.html` — open in a browser. One page, light and dark side by side:
  popover (focus header, Today, sound), scratchpad tab, meditation reminder panels, full-screen
  breathing session, settings (schedule + hotkeys), and the six menu bar states.
- Tasks, track names and times in it are examples.

Tokens: light is Daylight (`src/index.css`). Dark is new and menubar-only — the values live in the
prototype's `.mac[data-mode="dark"]` block. `--calm` (violet) is the meditation colour; the lime ring
gradient is the focus timer; blue is break.

Decisions from Sergio (2026-11-10):
- Scratchpad: each line becomes a task (Work / General), sorted later with Sort General.
- Meditation: both schedule modes (every N minutes in a window, or set times). A session never starts
  on its own — he presses Start. Heads-up uses the app's own drop-down panel. Esc always ends it.
  Spotify pauses during a session.
- Hotkeys are all rebindable.
