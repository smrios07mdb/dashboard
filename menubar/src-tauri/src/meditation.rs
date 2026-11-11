//! Meditation (chunk 96): breathing breaks on a schedule. Rust owns the
//! reminder clock and the session, for the pomodoro's reason — a hidden web
//! view is throttled or suspended, so nothing here may depend on JS running.
//!
//! The web view owns the schedule's arithmetic: it turns the settings into
//! due times in the Mac's local time and sends them with
//! `meditation_configure`. The shell has no time-zone code; it receives epoch
//! milliseconds, and one number (`utc_offset`, minutes) only so the tray can
//! print a due time as `h:mm`.
//!
//! Top half: pure state and transitions, tested with injected times. Bottom
//! half: the Tauri glue — the managed state, the commands, the one
//! `meditation` thread, the overlay windows.
//!
//! Time is wall-clock (`SystemTime`, carried as epoch ms), never `Instant`,
//! which stops while the Mac sleeps. Nothing is counted: every state is
//! derived from the due times and `now`.

use std::collections::BTreeSet;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::sessions::{Kind, Outcome, Record};

const MINUTE_MS: u64 = 60_000;
const DAY_MS: u64 = 24 * 60 * MINUTE_MS;
/// A due reminder nobody answered becomes missed after this long.
pub const MISSED_AFTER_MS: u64 = 30 * MINUTE_MS;
/// Handled occurrences are remembered this long.
pub const HANDLED_KEEP_MS: u64 = DAY_MS;
/// `meditation_configure` accepts at most this many due times.
pub const MAX_DUE: usize = 400;
/// An unfocused panel hides by itself after this long.
pub const HIDE_HEADS_UP_MS: u64 = 60_000;
pub const HIDE_DUE_MS: u64 = 120_000;
/// Every wait of the thread is capped, so a Mac waking from sleep is caught.
const MAX_WAIT_MS: u64 = 30_000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    None,
    HeadsUp,
    Due,
    Running,
}

impl Status {
    fn name(self) -> &'static str {
        match self {
            Status::None => "none",
            Status::HeadsUp => "heads_up",
            Status::Due => "due",
            Status::Running => "running",
        }
    }
}

/// Minutes, minutes, a flag, and the Mac's offset from UTC in minutes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Config {
    pub heads_up: u32,
    pub length: u32,
    pub pause_spotify: bool,
    pub utc_offset: i32,
}

impl Config {
    pub const DEFAULT: Config = Config {
        heads_up: 5,
        length: 5,
        pause_spotify: true,
        utc_offset: 0,
    };
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Session {
    pub started_at: u64,
    pub ends_at: u64,
}

/// Everything is epoch ms.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct MedState {
    /// Sorted, from the last configure.
    pub due: Vec<u64>,
    /// Occurrences started, skipped, snoozed or missed, keyed by due time.
    pub handled: BTreeSet<u64>,
    /// A snoozed reminder: due at this time, with no heads-up.
    pub snooze: Option<u64>,
    pub session: Option<Session>,
    pub config: Config,
}

impl Default for MedState {
    fn default() -> Self {
        MedState {
            due: Vec::new(),
            handled: BTreeSet::new(),
            snooze: None,
            session: None,
            config: Config::DEFAULT,
        }
    }
}

/// The one reminder that is waiting: a scheduled occurrence or the snooze.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Pending {
    pub at: u64,
    pub snoozed: bool,
}

pub fn epoch_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn unhandled(state: &MedState, due: u64) -> bool {
    !state.handled.contains(&due)
}

/// Not handled and not yet missed.
fn live(state: &MedState, due: u64, now: u64) -> bool {
    unhandled(state, due) && due + MISSED_AFTER_MS > now
}

/// The due list and settings from the web view. Anything out of range is
/// rejected, not clamped. An empty list (signed out, or reminders off) clears
/// the snooze and any waiting reminder; otherwise an occurrence that is
/// already due stays, because the web view no longer sends a time once it is
/// past and it reconfigures every time the panel is shown.
pub fn configure(
    state: &MedState,
    mut due: Vec<u64>,
    heads_up: u32,
    length: u32,
    pause_spotify: bool,
    utc_offset: i32,
    now: u64,
) -> Result<MedState, String> {
    if due.len() > MAX_DUE {
        return Err(format!("due must hold at most {MAX_DUE} times"));
    }
    let (earliest, latest) = (now.saturating_sub(DAY_MS), now + 15 * DAY_MS);
    if due.iter().any(|d| !(earliest..=latest).contains(d)) {
        return Err("a due time is out of range".into());
    }
    if heads_up > 30 {
        return Err("headsUp must be 0–30".into());
    }
    if !(1..=60).contains(&length) {
        return Err("length must be 1–60".into());
    }
    // UTC−12:00 to UTC+14:00.
    if !(-720..=840).contains(&utc_offset) {
        return Err("utcOffset must be −720–840".into());
    }
    let mut s = state.clone();
    if due.is_empty() {
        s.snooze = None;
    } else {
        due.extend(
            state
                .due
                .iter()
                .copied()
                .filter(|&d| d <= now && live(state, d, now)),
        );
    }
    due.sort_unstable();
    due.dedup();
    s.due = due;
    s.config = Config {
        heads_up,
        length,
        pause_spotify,
        utc_offset,
    };
    Ok(s)
}

/// The earliest reminder still waiting, if any. A scheduled occurrence at or
/// before the snooze comes first.
pub fn pending(state: &MedState, now: u64) -> Option<Pending> {
    next_reminder(state, now, None)
}

/// The earliest waiting reminder other than `skip`.
fn next_reminder(state: &MedState, now: u64, skip: Option<Pending>) -> Option<Pending> {
    let scheduled = state
        .due
        .iter()
        .copied()
        .find(|&d| live(state, d, now) && skip != Some(Pending { at: d, snoozed: false }));
    let snoozed = state.snooze.filter(|&at| {
        at + MISSED_AFTER_MS > now && skip != Some(Pending { at, snoozed: true })
    });
    match (scheduled, snoozed) {
        (Some(d), Some(z)) if z < d => Some(Pending { at: z, snoozed: true }),
        (Some(d), _) => Some(Pending { at: d, snoozed: false }),
        (None, Some(z)) => Some(Pending { at: z, snoozed: true }),
        (None, None) => None,
    }
}

fn running(state: &MedState, now: u64) -> Option<Session> {
    state.session.filter(|s| s.ends_at > now)
}

pub fn status(state: &MedState, now: u64) -> Status {
    if running(state, now).is_some() {
        return Status::Running;
    }
    let heads_up = state.config.heads_up as u64 * MINUTE_MS;
    match pending(state, now) {
        Some(p) if now >= p.at => Status::Due,
        // A snooze has no second heads-up.
        Some(p) if !p.snoozed && heads_up > 0 && now + heads_up >= p.at => Status::HeadsUp,
        _ => Status::None,
    }
}

/// Every reminder whose time has come is handled: by the session that just
/// started or ended, or by the answer to the one that was showing.
fn handle_arrived(s: &mut MedState, now: u64) {
    let arrived: Vec<u64> = s.due.iter().copied().filter(|&d| d <= now).collect();
    s.handled.extend(arrived);
    if s.snooze.is_some_and(|at| at <= now) {
        s.snooze = None;
    }
}

/// A scheduled occurrence at or before the snoozed time replaces the snooze.
fn settle_snooze(s: &mut MedState, now: u64) {
    if let Some(at) = s.snooze {
        let replaced = s.due.iter().any(|&d| d <= at && live(s, d, now));
        if replaced || at + MISSED_AFTER_MS <= now {
            s.snooze = None;
        }
    }
}

/// Everything time alone causes: a session reaching its end, a due reminder
/// going missed after 30 minutes, a snooze replaced by a scheduled occurrence
/// at or before it, and the pruning of what was handled over a day ago.
pub fn tick(state: &MedState, now: u64) -> MedState {
    let mut s = state.clone();
    if s.session.is_some_and(|x| x.ends_at <= now) {
        s.session = None;
        handle_arrived(&mut s, now);
    }
    s.due.retain(|&d| d + HANDLED_KEEP_MS > now);
    s.handled.retain(|&d| d + HANDLED_KEEP_MS > now);
    let missed: Vec<u64> = s
        .due
        .iter()
        .copied()
        .filter(|&d| d + MISSED_AFTER_MS <= now)
        .collect();
    s.handled.extend(missed);
    settle_snooze(&mut s, now);
    s
}

/// Handle the reminder that is showing (heads-up or due), and with it any
/// other whose time has come.
fn answer(s: &mut MedState, now: u64) -> Result<(), String> {
    let showing = matches!(status(s, now), Status::HeadsUp | Status::Due);
    match pending(s, now) {
        Some(p) if showing => {
            if p.snoozed {
                s.snooze = None;
            } else {
                s.handled.insert(p.at);
            }
            handle_arrived(s, now);
            Ok(())
        }
        _ => Err("no reminder".into()),
    }
}

/// A session of `config.length` minutes from now, due or not. Rejected while
/// one is running.
pub fn start(state: &MedState, now: u64) -> Result<MedState, String> {
    if running(state, now).is_some() {
        return Err("a session is already running".into());
    }
    let mut s = state.clone();
    // A reminder that is showing is answered by starting; without one this
    // is the hotkey, and there is nothing to answer.
    if answer(&mut s, now).is_err() {
        handle_arrived(&mut s, now);
    }
    s.session = Some(Session {
        started_at: now,
        ends_at: now + s.config.length as u64 * MINUTE_MS,
    });
    Ok(s)
}

/// The waiting reminder becomes due at `now + minutes`, with no second
/// heads-up. Only 5 or 15.
pub fn snooze(state: &MedState, minutes: u32, now: u64) -> Result<MedState, String> {
    if minutes != 5 && minutes != 15 {
        return Err("minutes must be 5 or 15".into());
    }
    let mut s = state.clone();
    answer(&mut s, now)?;
    s.snooze = Some(now + minutes as u64 * MINUTE_MS);
    settle_snooze(&mut s, now);
    Ok(s)
}

/// The waiting reminder is handled; nothing starts.
pub fn skip(state: &MedState, now: u64) -> Result<MedState, String> {
    let mut s = state.clone();
    answer(&mut s, now)?;
    Ok(s)
}

/// End the session now. Without one, nothing changes.
pub fn end(state: &MedState, now: u64) -> MedState {
    let mut s = state.clone();
    if s.session.take().is_some() {
        handle_arrived(&mut s, now);
    }
    s
}

/// The breathing session a state change ended, for the ledger (chunk 98,
/// D3/D8). `prev` is the state before time was applied, `next` the final one:
/// `Some` when `prev` held a session and `next` holds none, or another. One
/// that reached its end is `completed` and ends there — also when the Mac
/// slept through it; otherwise it was `ended` at `now`.
pub fn ended_session(prev: &MedState, next: &MedState, now: u64) -> Option<Record> {
    let s = prev.session?;
    if next.session.is_some_and(|n| n.started_at == s.started_at) {
        return None;
    }
    let (ended_at, outcome) = if now >= s.ends_at {
        (s.ends_at, Outcome::Completed)
    } else {
        (now, Outcome::Ended)
    };
    Some(Record {
        kind: Kind::Meditation,
        started_at: s.started_at,
        ended_at,
        planned_ms: s.ends_at.saturating_sub(s.started_at),
        active_ms: ended_at.saturating_sub(s.started_at),
        outcome,
        task: None,
    })
}

/// The snapshot the web view reads, written by hand like the pomodoro's.
/// `dueAt` is the reminder that is showing; `nextDueAt` the one after it, or
/// the next one when none is showing.
pub fn snapshot_json(state: &MedState, now: u64) -> String {
    let status = status(state, now);
    let showing = match status {
        Status::HeadsUp | Status::Due => pending(state, now),
        Status::None | Status::Running => None,
    };
    let session = running(state, now);
    let num = |v: Option<u64>| v.map_or("null".to_string(), |n| n.to_string());
    format!(
        "{{\"status\":\"{}\",\"dueAt\":{},\"startedAt\":{},\"endsAt\":{},\"length\":{},\
         \"pauseSpotify\":{},\"nextDueAt\":{}}}",
        status.name(),
        num(showing.map(|p| p.at)),
        num(session.map(|s| s.started_at)),
        num(session.map(|s| s.ends_at)),
        state.config.length,
        state.config.pause_spotify,
        num(next_reminder(state, now, showing).map(|p| p.at)),
    )
}

/// What the tray shows for meditation; the pomodoro loop draws it.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum MedTray {
    /// A session: the time left.
    Running { ends_at: u64 },
    /// The time until the reminder is due.
    HeadsUp { due_at: u64 },
    /// The due time, `h:mm`.
    Due { label: String },
}

pub fn tray_hint(state: &MedState, now: SystemTime) -> Option<MedTray> {
    let now = epoch_ms(now);
    let due_at = || pending(state, now).map(|p| p.at);
    match status(state, now) {
        Status::None => None,
        Status::Running => running(state, now).map(|s| MedTray::Running { ends_at: s.ends_at }),
        Status::HeadsUp => due_at().map(|due_at| MedTray::HeadsUp { due_at }),
        Status::Due => due_at().map(|at| MedTray::Due {
            label: clock_label(at, state.config.utc_offset),
        }),
    }
}

/// `m:ss`, seconds rounded up: `4:59`, `0:07`.
pub fn countdown(left_ms: u64) -> String {
    let s = left_ms.div_ceil(1000);
    format!("{}:{:02}", s / 60, s % 60)
}

/// A due time on a 12-hour clock, `h:mm`, in the zone `utc_offset` minutes
/// from UTC. The offset comes from the web view; nothing here knows a zone.
pub fn clock_label(at: u64, utc_offset: i32) -> String {
    let minutes = ((at / MINUTE_MS) as i64 + utc_offset as i64).rem_euclid(24 * 60);
    let hour = match minutes / 60 % 12 {
        0 => 12,
        h => h,
    };
    format!("{hour}:{:02}", minutes % 60)
}

/// The next moment the thread has something to do, if any: a session's end,
/// a reminder's heads-up, due time or missed time, or the panel's auto-hide.
pub fn next_event(state: &MedState, hide_at: Option<u64>, now: u64) -> Option<u64> {
    let mut times: Vec<u64> = Vec::new();
    times.extend(running(state, now).map(|s| s.ends_at));
    if let Some(p) = pending(state, now) {
        let heads_up = state.config.heads_up as u64 * MINUTE_MS;
        if !p.snoozed && heads_up > 0 {
            times.push(p.at.saturating_sub(heads_up));
        }
        times.push(p.at);
        times.push(p.at + MISSED_AFTER_MS);
    }
    times.extend(hide_at);
    times.into_iter().filter(|&at| at > now).min()
}

/// What the thread has already shown: the panel drops once when a reminder
/// reaches heads-up and once when it comes due, and hides by itself later.
#[derive(Default, Debug)]
pub struct Presenter {
    announced: Option<(u64, Status)>,
    pub hide_at: Option<u64>,
}

#[derive(Default, PartialEq, Eq, Debug)]
pub struct Present {
    /// Drop the panel now.
    pub show: bool,
    /// Hide it now if it is still unfocused.
    pub hide: bool,
}

impl Presenter {
    pub fn observe(&mut self, state: &MedState, now: u64) -> Present {
        let mut out = Present::default();
        let stage = status(state, now);
        if let (Status::HeadsUp | Status::Due, Some(p)) = (stage, pending(state, now)) {
            if self.announced != Some((p.at, stage)) {
                self.announced = Some((p.at, stage));
                let stay = if stage == Status::Due {
                    HIDE_DUE_MS
                } else {
                    HIDE_HEADS_UP_MS
                };
                self.hide_at = Some(now + stay);
                out.show = true;
            }
        }
        if self.hide_at.is_some_and(|at| now >= at) {
            self.hide_at = None;
            out.hide = true;
        }
        out
    }
}

/// A display's frame in points: x, y, width, height.
pub type Frame = (f64, f64, f64, f64);

/// The display holding the point, in the same coordinates.
pub fn monitor_under(frames: &[Frame], x: f64, y: f64) -> Option<usize> {
    frames
        .iter()
        .position(|f| x >= f.0 && x < f.0 + f.2 && y >= f.1 && y < f.1 + f.3)
}

// ---------------------------------------------------------------------------
// Tauri glue
// ---------------------------------------------------------------------------

const OVERLAY_PREFIX: &str = "breathe-";
const OVERLAY_URL: &str = "index.html#breathe";
const ESCAPE: &str = "Escape";

struct Inner {
    state: MedState,
    /// Bumped on every change, so the thread never sleeps through one.
    generation: u64,
    /// The last snapshot sent, to emit only on a change.
    last_json: String,
}

/// The managed reminder clock and session. The lock is never held across a
/// window operation, an emit, a tray write or a call into `sound` /
/// `pomodoro`.
pub struct Meditation {
    inner: Mutex<Inner>,
    wake: Condvar,
}

impl Default for Meditation {
    fn default() -> Self {
        Meditation {
            inner: Mutex::new(Inner {
                state: MedState::default(),
                generation: 0,
                last_json: String::new(),
            }),
            wake: Condvar::new(),
        }
    }
}

impl Meditation {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// For the pomodoro loop, the only tray writer.
    pub fn tray_hint(&self, now: SystemTime) -> Option<MedTray> {
        tray_hint(&self.lock().state, now)
    }

    /// Run one change: bring the state up to now, apply `f`, then — with the
    /// lock gone — do what a session edge asks of the pomodoro and of Spotify,
    /// and emit one `meditation` event if the snapshot changed. A rejected
    /// change still keeps what time alone changed.
    fn apply(
        &self,
        app: &AppHandle,
        f: impl FnOnce(&MedState, u64) -> Result<MedState, String>,
    ) -> Result<Response, String> {
        let now = epoch_ms(SystemTime::now());
        let (json, changed, rejected, started, ended, pause_spotify, record) = {
            let mut g = self.lock();
            let base = tick(&g.state, now);
            let mut ended = g.state.session.is_some() && base.session.is_none();
            let (next, rejected) = match f(&base, now) {
                Ok(next) => (next, None),
                Err(e) => (base.clone(), Some(e)),
            };
            ended |= base.session.is_some() && next.session.is_none();
            let started = base.session.is_none() && next.session.is_some();
            // From the state before `tick` (chunk 98, D8).
            let record = ended_session(&g.state, &next, now);
            let json = snapshot_json(&next, now);
            let changed = json != g.last_json;
            if changed || next != g.state {
                g.generation += 1;
            }
            let pause_spotify = next.config.pause_spotify;
            g.state = next;
            if changed {
                g.last_json = json.clone();
            }
            (json, changed, rejected, started, ended, pause_spotify, record)
        };
        // The ledger's lock is never taken under this one.
        crate::sessions::record(app, record);
        let sound = app.try_state::<crate::sound::Sound>();
        if ended {
            // Resumes Spotify only if this session paused it (D14).
            if let Some(sound) = sound.as_ref() {
                sound.meditation_end();
            }
        }
        if started {
            // A running focus is paused, and stays paused afterwards (D10).
            let paused_focus = app
                .try_state::<crate::pomodoro::Pomodoro>()
                .is_some_and(|pomo| pomo.pause_focus(app));
            if pause_spotify {
                if let Some(sound) = sound.as_ref() {
                    sound.meditation_start(paused_focus);
                }
            }
        }
        self.wake.notify_all();
        if changed {
            let _ = app.emit_str("meditation", json.clone());
            // The tray is the pomodoro loop's to write (D9).
            if let Some(pomo) = app.try_state::<crate::pomodoro::Pomodoro>() {
                pomo.poke();
            }
        }
        match rejected {
            Some(e) => Err(e),
            None => Ok(Response::new(json)),
        }
    }
}

#[tauri::command]
pub fn meditation_state(app: AppHandle) -> Result<Response, String> {
    app.state::<Meditation>().apply(&app, |s, _| Ok(s.clone()))
}

/// `due` is epoch ms; `utc_offset` is the Mac's offset from UTC in minutes,
/// used only for the tray's `h:mm`.
#[tauri::command]
pub fn meditation_configure(
    app: AppHandle,
    due: Vec<u64>,
    heads_up: u32,
    length: u32,
    pause_spotify: bool,
    utc_offset: i32,
) -> Result<Response, String> {
    app.state::<Meditation>().apply(&app, |s, now| {
        configure(s, due, heads_up, length, pause_spotify, utc_offset, now)
    })
}

#[tauri::command]
pub fn meditation_start(app: AppHandle) -> Result<Response, String> {
    app.state::<Meditation>().apply(&app, start)
}

#[tauri::command]
pub fn meditation_snooze(app: AppHandle, minutes: u32) -> Result<Response, String> {
    app.state::<Meditation>()
        .apply(&app, |s, now| snooze(s, minutes, now))
}

#[tauri::command]
pub fn meditation_skip(app: AppHandle) -> Result<Response, String> {
    app.state::<Meditation>().apply(&app, skip)
}

#[tauri::command]
pub fn meditation_end(app: AppHandle) -> Result<Response, String> {
    app.state::<Meditation>()
        .apply(&app, |s, now| Ok(end(s, now)))
}

/// Above full-screen spaces, the menu bar and the Dock (D11). The window
/// level and collection behaviour are the only AppKit calls in the shell.
#[cfg(target_os = "macos")]
fn raise(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSScreenSaverWindowLevel, NSWindow, NSWindowCollectionBehavior};

    let on_main = window.clone();
    let queued = window.run_on_main_thread(move || {
        let Ok(ptr) = on_main.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        // SAFETY: Tauri hands out its own live NSWindow, and this closure
        // runs on the main thread, where AppKit windows may be used.
        let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        ns.setLevel(NSScreenSaverWindowLevel);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    });
    if let Err(e) = queued {
        eprintln!("menubar: overlay not raised: {e}");
    }
}

#[cfg(not(target_os = "macos"))]
fn raise(_window: &tauri::WebviewWindow) {}

/// One overlay per display, each the size of its display's whole frame. The
/// one under the mouse takes focus. Displays that come or go during a session
/// are not followed.
fn open_overlays(app: &AppHandle) {
    let monitors = match app.available_monitors() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("menubar: displays not read: {e}");
            return;
        }
    };
    let frames: Vec<Frame> = monitors
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let at = m.position().to_logical::<f64>(scale);
            let size = m.size().to_logical::<f64>(scale);
            (at.x, at.y, size.width, size.height)
        })
        .collect();
    // The cursor arrives scaled by the main display's factor.
    let main_scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let under = app
        .cursor_position()
        .ok()
        .and_then(|c| monitor_under(&frames, c.x / main_scale, c.y / main_scale))
        .unwrap_or(0);

    let mut focus = None;
    for (n, frame) in frames.iter().enumerate() {
        let label = format!("{OVERLAY_PREFIX}{n}");
        let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(OVERLAY_URL.into()))
            .title(&label)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .accept_first_mouse(true)
            .visible(false)
            .focused(false)
            .position(frame.0, frame.1)
            .inner_size(frame.2, frame.3)
            .build();
        match built {
            Ok(w) => {
                raise(&w);
                let _ = w.show();
                if n == under {
                    focus = Some(w);
                }
            }
            Err(e) => eprintln!("menubar: overlay {label} not opened: {e}"),
        }
    }
    if let Some(w) = focus {
        let _ = w.set_focus();
    }
}

fn close_overlays(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with(OVERLAY_PREFIX) {
            let _ = w.destroy();
        }
    }
}

/// Esc ends the session from any app (D12). If the system refuses the
/// shortcut, the overlay's own key handler still ends it.
fn register_escape(app: &AppHandle) {
    let registered = app
        .global_shortcut()
        .on_shortcut(ESCAPE, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app
                    .state::<Meditation>()
                    .apply(app, |s, now| Ok(end(s, now)));
            }
        });
    if let Err(e) = registered {
        eprintln!("menubar: Esc not registered for the session: {e}");
    }
}

fn unregister_escape(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().unregister(ESCAPE) {
        eprintln!("menubar: Esc not unregistered: {e}");
    }
}

/// The one meditation thread (std only). It parks on the condvar until its
/// next event — heads-up, due, missed, auto-hide, session end — never longer
/// than 30 s, and does what the state asks of the windows.
pub fn spawn_loop(app: AppHandle) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("meditation".into())
        .spawn(move || {
            let med = app.state::<Meditation>();
            let mut presenter = Presenter::default();
            // The session the overlays on screen belong to.
            let mut overlays: Option<u64> = None;
            loop {
                // What time alone changed, with its event and its edges.
                let _ = med.apply(&app, |s, _| Ok(s.clone()));
                let (state, generation) = {
                    let g = med.lock();
                    (g.state.clone(), g.generation)
                };
                let now = epoch_ms(SystemTime::now());

                let wanted = state.session.map(|s| s.started_at);
                if wanted != overlays {
                    if overlays.is_some() {
                        close_overlays(&app);
                        unregister_escape(&app);
                    }
                    if wanted.is_some() {
                        crate::hide(&app);
                        open_overlays(&app);
                        register_escape(&app);
                    }
                    overlays = wanted;
                }

                let present = presenter.observe(&state, now);
                if present.show {
                    crate::show_passive(&app);
                }
                if present.hide {
                    crate::hide_unfocused(&app);
                }

                let g = med.lock();
                if g.generation != generation {
                    continue; // a command landed meanwhile
                }
                let now = epoch_ms(SystemTime::now());
                let wait = next_event(&g.state, presenter.hide_at, now)
                    .map_or(MAX_WAIT_MS, |at| at.saturating_sub(now).min(MAX_WAIT_MS));
                drop(
                    med.wake
                        .wait_timeout(g, Duration::from_millis(wait.max(1))),
                );
            }
        })
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u64 = MINUTE_MS;
    const SEC: u64 = 1000;
    const T0: u64 = 1_800_000_000_000;

    /// `T0` plus this many ms.
    fn t(ms: u64) -> u64 {
        T0 + ms
    }

    fn sys(ms: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_millis(ms)
    }

    /// Due times (minutes after `T0`) with the default settings.
    fn with_due(minutes: &[u64]) -> MedState {
        let due = minutes.iter().map(|m| t(m * MIN)).collect();
        configure(&MedState::default(), due, 5, 5, true, 0, T0).unwrap()
    }

    fn heads_up(state: &MedState, minutes: u32) -> MedState {
        let mut s = state.clone();
        s.config.heads_up = minutes;
        s
    }

    // ---- ended_session (chunk 98, D3/D8) ----

    fn running_session() -> MedState {
        start(&MedState::default(), T0).unwrap()
    }

    #[test]
    fn a_session_that_reaches_its_end_is_completed() {
        let s = running_session();
        // Noticed 300 ms late: the record still ends at the scheduled time.
        let now = t(5 * MIN + 300);
        let next = tick(&s, now);
        assert_eq!(
            ended_session(&s, &next, now),
            Some(Record {
                kind: Kind::Meditation,
                started_at: T0,
                ended_at: t(5 * MIN),
                planned_ms: 5 * MIN,
                active_ms: 5 * MIN,
                outcome: Outcome::Completed,
                task: None,
            })
        );
        // Not a moment before.
        let early = t(5 * MIN - 1);
        assert_eq!(ended_session(&s, &tick(&s, early), early), None);
    }

    #[test]
    fn ending_early_is_ended_with_the_time_spent() {
        let s = running_session();
        let now = t(70 * SEC);
        let r = ended_session(&s, &end(&s, now), now).unwrap();
        assert_eq!(r.outcome, Outcome::Ended);
        assert_eq!(r.ended_at, now);
        assert_eq!(r.active_ms, 70 * SEC);
        assert_eq!(r.planned_ms, 5 * MIN);
        assert_eq!(r.task, None);
    }

    #[test]
    fn a_session_that_ended_while_the_mac_slept_is_completed_at_its_end() {
        let s = running_session();
        let now = t(3 * 60 * MIN);
        let r = ended_session(&s, &tick(&s, now), now).unwrap();
        assert_eq!(r.outcome, Outcome::Completed);
        assert_eq!(r.ended_at, t(5 * MIN));
        assert_eq!(r.active_ms, 5 * MIN);
        // Also when the first thing after the sleep is Esc, or a new start.
        let ended = end(&tick(&s, now), now);
        assert_eq!(ended_session(&s, &ended, now).unwrap().outcome, Outcome::Completed);
        let again = start(&tick(&s, now), now).unwrap();
        let r = ended_session(&s, &again, now).unwrap();
        assert_eq!((r.started_at, r.ended_at), (T0, t(5 * MIN)));
    }

    #[test]
    fn nothing_is_recorded_when_no_session_ended() {
        // Nothing ran.
        let idle = with_due(&[60]);
        let now = t(60 * MIN);
        assert_eq!(ended_session(&idle, &tick(&idle, now), now), None);
        assert_eq!(ended_session(&idle, &end(&idle, now), now), None);
        // `start`, `snooze` and `skip` end nothing.
        assert_eq!(ended_session(&idle, &start(&idle, now).unwrap(), now), None);
        assert_eq!(ended_session(&idle, &snooze(&idle, 5, now).unwrap(), now), None);
        assert_eq!(ended_session(&idle, &skip(&idle, now).unwrap(), now), None);
        // A session still running, and a reconfigure during it.
        let s = running_session();
        assert_eq!(ended_session(&s, &tick(&s, t(MIN)), t(MIN)), None);
        let cfg = configure(&s, vec![t(60 * MIN)], 5, 10, true, 0, t(MIN)).unwrap();
        assert_eq!(ended_session(&s, &cfg, t(MIN)), None);
    }

    // ---- heads-up and due ----

    #[test]
    fn heads_up_starts_five_minutes_before_and_due_at_the_time() {
        let s = with_due(&[60]);
        assert_eq!(status(&s, t(55 * MIN - 1)), Status::None);
        assert_eq!(status(&s, t(55 * MIN)), Status::HeadsUp);
        assert_eq!(status(&s, t(60 * MIN - 1)), Status::HeadsUp);
        assert_eq!(status(&s, t(60 * MIN)), Status::Due);
        assert_eq!(
            pending(&s, t(60 * MIN)),
            Some(Pending { at: t(60 * MIN), snoozed: false })
        );
    }

    #[test]
    fn heads_up_zero_goes_straight_to_due() {
        let s = heads_up(&with_due(&[60]), 0);
        assert_eq!(status(&s, t(55 * MIN)), Status::None);
        assert_eq!(status(&s, t(60 * MIN - 1)), Status::None);
        assert_eq!(status(&s, t(60 * MIN)), Status::Due);
    }

    #[test]
    fn a_due_reminder_is_missed_and_handled_after_thirty_minutes() {
        let s = with_due(&[60]);
        let before = tick(&s, t(90 * MIN - 1));
        assert_eq!(status(&before, t(90 * MIN - 1)), Status::Due);
        assert!(before.handled.is_empty());
        let after = tick(&before, t(90 * MIN));
        assert_eq!(status(&after, t(90 * MIN)), Status::None);
        assert!(after.handled.contains(&t(60 * MIN)));
    }

    #[test]
    fn waking_past_the_window_drops_the_occurrence_silently() {
        let s = with_due(&[60, 300]);
        // Asleep from before the heads-up until 31 minutes after due.
        let woke = tick(&s, t(91 * MIN));
        assert_eq!(status(&woke, t(91 * MIN)), Status::None);
        assert!(woke.handled.contains(&t(60 * MIN)));
        // Even before the thread ticks, nothing reads as due.
        assert_eq!(status(&s, t(91 * MIN)), Status::None);
        // The presenter never drops the panel for it.
        let mut p = Presenter::default();
        assert_eq!(p.observe(&woke, t(91 * MIN)), Present::default());
    }

    #[test]
    fn waking_inside_the_window_goes_straight_to_due() {
        let s = with_due(&[60]);
        let woke = tick(&s, t(70 * MIN));
        assert_eq!(status(&woke, t(70 * MIN)), Status::Due);
        let mut p = Presenter::default();
        assert!(p.observe(&woke, t(70 * MIN)).show);
    }

    // ---- snooze ----

    #[test]
    fn snooze_five_and_fifteen_come_due_with_no_second_heads_up() {
        for minutes in [5u64, 15] {
            let s = with_due(&[60]);
            let now = t(60 * MIN + 10 * SEC);
            let z = snooze(&s, minutes as u32, now).unwrap();
            let at = now + minutes * MIN;
            assert_eq!(z.snooze, Some(at));
            assert!(z.handled.contains(&t(60 * MIN)));
            assert_eq!(status(&z, now), Status::None);
            // Inside what would be a heads-up window: still nothing.
            assert_eq!(status(&z, at - 1), Status::None);
            assert_eq!(status(&z, at), Status::Due);
            assert_eq!(pending(&z, at), Some(Pending { at, snoozed: true }));
        }
    }

    #[test]
    fn snooze_works_from_the_heads_up_too() {
        let s = with_due(&[60]);
        let now = t(56 * MIN);
        let z = snooze(&s, 15, now).unwrap();
        assert_eq!(z.snooze, Some(now + 15 * MIN));
        assert_eq!(status(&z, t(60 * MIN)), Status::None);
        assert_eq!(status(&z, now + 15 * MIN), Status::Due);
    }

    #[test]
    fn snooze_takes_only_five_or_fifteen_and_needs_a_reminder() {
        let s = with_due(&[60]);
        for bad in [0, 1, 4, 6, 10, 14, 16, 30] {
            assert!(snooze(&s, bad, t(60 * MIN)).is_err(), "{bad}");
        }
        assert!(snooze(&s, 5, t(10 * MIN)).is_err());
        assert!(skip(&s, t(10 * MIN)).is_err());
    }

    #[test]
    fn a_scheduled_occurrence_at_or_before_the_snooze_replaces_it() {
        let s = with_due(&[60, 63]);
        let z = snooze(&s, 5, t(60 * MIN)).unwrap();
        assert_eq!(z.snooze, None);
        assert_eq!(
            pending(&z, t(60 * MIN)),
            Some(Pending { at: t(63 * MIN), snoozed: false })
        );
        // The scheduled one keeps its own heads-up.
        assert_eq!(status(&z, t(60 * MIN)), Status::HeadsUp);

        // Exactly at the snoozed time counts as "at or before".
        let s = with_due(&[60, 65]);
        assert_eq!(snooze(&s, 5, t(60 * MIN)).unwrap().snooze, None);

        // A later one leaves the snooze alone.
        let s = with_due(&[60, 70]);
        let z = snooze(&s, 5, t(60 * MIN)).unwrap();
        assert_eq!(z.snooze, Some(t(65 * MIN)));
        assert_eq!(status(&z, t(65 * MIN)), Status::Due);

        // One that a reconfigure adds later replaces it at the next tick.
        let added = configure(&z, vec![t(64 * MIN), t(70 * MIN)], 5, 5, true, 0, t(61 * MIN));
        assert_eq!(tick(&added.unwrap(), t(61 * MIN)).snooze, None);
    }

    #[test]
    fn a_snooze_nobody_answers_is_dropped_after_thirty_minutes() {
        let z = snooze(&with_due(&[60]), 5, t(60 * MIN)).unwrap();
        assert_eq!(tick(&z, t(95 * MIN - 1)).snooze, Some(t(65 * MIN)));
        assert_eq!(tick(&z, t(95 * MIN)).snooze, None);
    }

    // ---- skip, handled, pruning ----

    #[test]
    fn skip_handles_the_occurrence_and_starts_nothing() {
        let s = with_due(&[60]);
        let k = skip(&s, t(60 * MIN)).unwrap();
        assert_eq!(status(&k, t(60 * MIN)), Status::None);
        assert!(k.handled.contains(&t(60 * MIN)));
        assert_eq!(k.session, None);
        // From the heads-up as well.
        let k = skip(&s, t(57 * MIN)).unwrap();
        assert_eq!(status(&k, t(60 * MIN)), Status::None);
    }

    #[test]
    fn a_reconfigure_does_not_bring_back_a_handled_occurrence() {
        let s = with_due(&[60, 300]);
        let k = skip(&s, t(57 * MIN)).unwrap();
        let again = configure(
            &k,
            vec![t(60 * MIN), t(300 * MIN)],
            5,
            5,
            true,
            0,
            t(58 * MIN),
        )
        .unwrap();
        assert_eq!(status(&again, t(58 * MIN)), Status::None);
        assert_eq!(status(&again, t(60 * MIN)), Status::None);
        assert_eq!(
            pending(&again, t(60 * MIN)),
            Some(Pending { at: t(300 * MIN), snoozed: false })
        );
    }

    #[test]
    fn handled_occurrences_are_pruned_after_a_day() {
        let k = skip(&with_due(&[60]), t(60 * MIN)).unwrap();
        let day = 24 * 60 * MIN;
        let kept = tick(&k, t(60 * MIN + day - 1));
        assert!(kept.handled.contains(&t(60 * MIN)));
        let pruned = tick(&k, t(60 * MIN + day));
        assert!(pruned.handled.is_empty());
        // The stale due time goes with it, so it is not marked again.
        assert!(pruned.due.is_empty());
        assert_eq!(tick(&pruned, t(60 * MIN + day + 1)), pruned);
    }

    // ---- configure ----

    #[test]
    fn configure_sorts_and_drops_duplicates() {
        let s = configure(
            &MedState::default(),
            vec![t(90 * MIN), t(30 * MIN), t(90 * MIN), t(60 * MIN)],
            10,
            3,
            false,
            -300,
            T0,
        )
        .unwrap();
        assert_eq!(s.due, [t(30 * MIN), t(60 * MIN), t(90 * MIN)]);
        assert_eq!(
            s.config,
            Config { heads_up: 10, length: 3, pause_spotify: false, utc_offset: -300 }
        );
    }

    #[test]
    fn configure_rejects_what_is_out_of_range() {
        let ok = |due: Vec<u64>, hu: u32, len: u32, off: i32| {
            configure(&MedState::default(), due, hu, len, true, off, T0).is_ok()
        };
        let day = 24 * 60 * MIN;
        // Count.
        assert!(ok((0..400).map(|i| t(i * MIN)).collect(), 5, 5, 0));
        assert!(!ok((0..401).map(|i| t(i * MIN)).collect(), 5, 5, 0));
        // Each time within [now − 1 day, now + 15 days].
        assert!(ok(vec![T0 - day, t(15 * day)], 5, 5, 0));
        assert!(!ok(vec![T0 - day - 1], 5, 5, 0));
        assert!(!ok(vec![t(15 * day + 1)], 5, 5, 0));
        assert!(!ok(vec![0], 5, 5, 0));
        // Heads-up 0–30.
        assert!(ok(vec![], 0, 5, 0));
        assert!(ok(vec![], 30, 5, 0));
        assert!(!ok(vec![], 31, 5, 0));
        // Length 1–60.
        assert!(ok(vec![], 5, 1, 0));
        assert!(ok(vec![], 5, 60, 0));
        assert!(!ok(vec![], 5, 0, 0));
        assert!(!ok(vec![], 5, 61, 0));
        // The offset is a real zone's.
        assert!(ok(vec![], 5, 5, -720));
        assert!(ok(vec![], 5, 5, 840));
        assert!(!ok(vec![], 5, 5, -721));
        assert!(!ok(vec![], 5, 5, 841));
    }

    #[test]
    fn a_rejected_configure_changes_nothing() {
        let s = with_due(&[60]);
        assert!(configure(&s, vec![t(70 * MIN)], 31, 5, true, 0, T0).is_err());
        assert_eq!(s.due, [t(60 * MIN)]);
    }

    #[test]
    fn a_reconfigure_keeps_a_reminder_that_is_already_due() {
        // The web view stops sending a time once it is past, and it
        // reconfigures when the panel drops at that very time.
        let s = with_due(&[60, 300]);
        let now = t(60 * MIN + 2 * SEC);
        let again = configure(&s, vec![t(300 * MIN)], 5, 5, true, 0, now).unwrap();
        assert_eq!(status(&again, now), Status::Due);
        assert_eq!(again.due, [t(60 * MIN), t(300 * MIN)]);
        // A heads-up that the new list no longer holds does go.
        let early = configure(&s, vec![t(300 * MIN)], 5, 5, true, 0, t(57 * MIN)).unwrap();
        assert_eq!(status(&early, t(57 * MIN)), Status::None);
    }

    #[test]
    fn an_empty_configure_clears_the_reminder_and_the_snooze() {
        let s = with_due(&[60, 300]);
        let cleared = configure(&s, vec![], 5, 5, true, 0, t(61 * MIN)).unwrap();
        assert_eq!(status(&cleared, t(61 * MIN)), Status::None);
        assert!(cleared.due.is_empty());
        let z = snooze(&s, 15, t(60 * MIN)).unwrap();
        let cleared = configure(&z, vec![], 5, 5, true, 0, t(61 * MIN)).unwrap();
        assert_eq!(cleared.snooze, None);
        assert_eq!(pending(&cleared, t(75 * MIN)), None);
    }

    // ---- the session ----

    #[test]
    fn start_runs_for_the_length_from_none_heads_up_and_due() {
        let s = with_due(&[60, 300]);
        for (now, handled) in [
            (t(10 * MIN), false),
            (t(57 * MIN), true),
            (t(60 * MIN + 3 * SEC), true),
        ] {
            let r = start(&s, now).unwrap();
            assert_eq!(status(&r, now), Status::Running);
            assert_eq!(
                r.session,
                Some(Session { started_at: now, ends_at: now + 5 * MIN })
            );
            assert_eq!(r.handled.contains(&t(60 * MIN)), handled, "{now}");
        }
        let mut three = s.clone();
        three.config.length = 3;
        let r = start(&three, T0).unwrap();
        assert_eq!(r.session.unwrap().ends_at, t(3 * MIN));
    }

    #[test]
    fn start_is_rejected_while_a_session_runs() {
        let r = start(&MedState::default(), T0).unwrap();
        assert!(start(&r, t(MIN)).is_err());
        // Once it has ended, another may start.
        assert!(start(&tick(&r, t(5 * MIN)), t(5 * MIN)).is_ok());
    }

    #[test]
    fn start_from_a_snoozed_reminder_clears_the_snooze() {
        let z = snooze(&with_due(&[60]), 5, t(60 * MIN)).unwrap();
        let r = start(&z, t(65 * MIN)).unwrap();
        assert_eq!(r.snooze, None);
        // A snooze still ahead is left for later.
        let r = start(&z, t(62 * MIN)).unwrap();
        assert_eq!(r.snooze, Some(t(65 * MIN)));
    }

    #[test]
    fn the_session_ends_by_itself_at_its_end() {
        let r = start(&MedState::default(), T0).unwrap();
        let running = tick(&r, t(5 * MIN - 1));
        assert_eq!(status(&running, t(5 * MIN - 1)), Status::Running);
        let over = tick(&r, t(5 * MIN));
        assert_eq!(over.session, None);
        assert_eq!(status(&over, t(5 * MIN)), Status::None);
        // Read before the thread ticks, it is already not running.
        assert_eq!(status(&r, t(5 * MIN)), Status::None);
    }

    #[test]
    fn end_stops_the_session_at_any_point() {
        let r = start(&MedState::default(), T0).unwrap();
        let e = end(&r, t(MIN));
        assert_eq!(e.session, None);
        assert_eq!(status(&e, t(MIN)), Status::None);
        // Without a session nothing changes.
        let s = with_due(&[60]);
        assert_eq!(end(&s, t(60 * MIN)), s);
    }

    #[test]
    fn a_reminder_that_comes_due_during_a_session_is_handled_by_it() {
        let s = with_due(&[62, 300]);
        let r = start(&s, t(60 * MIN)).unwrap();
        // Running, the reminder does not show.
        assert_eq!(status(&r, t(63 * MIN)), Status::Running);
        let over = tick(&r, t(65 * MIN));
        assert_eq!(status(&over, t(65 * MIN)), Status::None);
        assert!(over.handled.contains(&t(62 * MIN)));
        let ended = end(&r, t(63 * MIN));
        assert_eq!(status(&ended, t(63 * MIN)), Status::None);
    }

    // ---- snapshot ----

    #[test]
    fn the_snapshot_reads_none_with_the_next_due_time() {
        assert_eq!(
            snapshot_json(&MedState::default(), T0),
            "{\"status\":\"none\",\"dueAt\":null,\"startedAt\":null,\"endsAt\":null,\
             \"length\":5,\"pauseSpotify\":true,\"nextDueAt\":null}"
        );
        assert_eq!(
            snapshot_json(&with_due(&[60, 150]), T0),
            "{\"status\":\"none\",\"dueAt\":null,\"startedAt\":null,\"endsAt\":null,\
             \"length\":5,\"pauseSpotify\":true,\"nextDueAt\":1800003600000}"
        );
    }

    #[test]
    fn the_snapshot_reads_heads_up_and_due() {
        let s = with_due(&[60, 150]);
        assert_eq!(
            snapshot_json(&s, t(56 * MIN)),
            "{\"status\":\"heads_up\",\"dueAt\":1800003600000,\"startedAt\":null,\
             \"endsAt\":null,\"length\":5,\"pauseSpotify\":true,\"nextDueAt\":1800009000000}"
        );
        assert_eq!(
            snapshot_json(&s, t(61 * MIN)),
            "{\"status\":\"due\",\"dueAt\":1800003600000,\"startedAt\":null,\
             \"endsAt\":null,\"length\":5,\"pauseSpotify\":true,\"nextDueAt\":1800009000000}"
        );
        // A snoozed reminder that is due reads the same way.
        let z = snooze(&with_due(&[60]), 5, t(60 * MIN)).unwrap();
        assert_eq!(
            snapshot_json(&z, t(65 * MIN)),
            "{\"status\":\"due\",\"dueAt\":1800003900000,\"startedAt\":null,\
             \"endsAt\":null,\"length\":5,\"pauseSpotify\":true,\"nextDueAt\":null}"
        );
        // Waiting, it is the next due time.
        let waiting = snapshot_json(&z, t(61 * MIN));
        assert!(waiting.starts_with("{\"status\":\"none\",\"dueAt\":null,"));
        assert!(waiting.ends_with("\"nextDueAt\":1800003900000}"));
    }

    #[test]
    fn the_snapshot_reads_running() {
        let mut s = with_due(&[150]);
        s.config.length = 3;
        s.config.pause_spotify = false;
        let r = start(&s, t(MIN)).unwrap();
        assert_eq!(
            snapshot_json(&r, t(2 * MIN)),
            "{\"status\":\"running\",\"dueAt\":null,\"startedAt\":1800000060000,\
             \"endsAt\":1800000240000,\"length\":3,\"pauseSpotify\":false,\
             \"nextDueAt\":1800009000000}"
        );
    }

    // ---- tray ----

    #[test]
    fn the_tray_hint_follows_the_state() {
        let s = with_due(&[60]);
        assert_eq!(tray_hint(&s, sys(t(10 * MIN))), None);
        assert_eq!(
            tray_hint(&s, sys(t(56 * MIN))),
            Some(MedTray::HeadsUp { due_at: t(60 * MIN) })
        );
        // T0 + 60 min is 09:00 UTC.
        assert_eq!(
            tray_hint(&s, sys(t(61 * MIN))),
            Some(MedTray::Due { label: "9:00".into() })
        );
        let r = start(&s, t(61 * MIN)).unwrap();
        assert_eq!(
            tray_hint(&r, sys(t(62 * MIN))),
            Some(MedTray::Running { ends_at: t(66 * MIN) })
        );
        assert_eq!(tray_hint(&tick(&r, t(66 * MIN)), sys(t(66 * MIN))), None);
        assert_eq!(tray_hint(&skip(&s, t(61 * MIN)).unwrap(), sys(t(61 * MIN))), None);
    }

    #[test]
    fn the_countdown_is_minutes_and_seconds_rounded_up() {
        assert_eq!(countdown(5 * MIN), "5:00");
        assert_eq!(countdown(5 * MIN - 1), "5:00");
        assert_eq!(countdown(5 * MIN - SEC), "4:59");
        assert_eq!(countdown(3 * MIN + 42 * SEC), "3:42");
        assert_eq!(countdown(7 * SEC), "0:07");
        assert_eq!(countdown(1), "0:01");
        assert_eq!(countdown(0), "0:00");
        assert_eq!(countdown(60 * MIN), "60:00");
    }

    #[test]
    fn the_due_time_is_a_twelve_hour_clock_in_the_given_offset() {
        // T0 is 2027-01-15 08:00:00 UTC.
        assert_eq!(clock_label(T0, 0), "8:00");
        assert_eq!(clock_label(t(150 * MIN), 0), "10:30");
        assert_eq!(clock_label(t(150 * MIN), -300), "5:30");
        assert_eq!(clock_label(t(5 * 60 * MIN), 0), "1:00");
        assert_eq!(clock_label(t(4 * 60 * MIN + 5 * MIN), 0), "12:05");
        assert_eq!(clock_label(T0, 540), "5:00");
        // Midnight and noon read 12; an offset may cross into the day before.
        assert_eq!(clock_label(T0, -480), "12:00");
        assert_eq!(clock_label(T0, 240), "12:00");
        assert_eq!(clock_label(T0, -600), "10:00");
    }

    // ---- the thread's pure pieces ----

    #[test]
    fn the_panel_drops_once_per_stage_and_hides_by_itself() {
        let s = with_due(&[60]);
        let mut p = Presenter::default();
        assert_eq!(p.observe(&s, t(54 * MIN)), Present::default());
        // Heads-up: shown once, hidden 60 s later.
        assert_eq!(p.observe(&s, t(55 * MIN)), Present { show: true, hide: false });
        assert_eq!(p.hide_at, Some(t(55 * MIN + 60 * SEC)));
        assert_eq!(p.observe(&s, t(55 * MIN + 59 * SEC)), Present::default());
        assert_eq!(p.observe(&s, t(56 * MIN)), Present { show: false, hide: true });
        assert_eq!(p.hide_at, None);
        assert_eq!(p.observe(&s, t(57 * MIN)), Present::default());
        // Due: shown again, hidden 120 s later.
        assert_eq!(p.observe(&s, t(60 * MIN)), Present { show: true, hide: false });
        assert_eq!(p.hide_at, Some(t(62 * MIN)));
        assert_eq!(p.observe(&s, t(62 * MIN - 1)), Present::default());
        assert_eq!(p.observe(&s, t(62 * MIN)), Present { show: false, hide: true });
        // Still due, never shown a third time.
        assert_eq!(p.observe(&s, t(70 * MIN)), Present::default());
    }

    #[test]
    fn a_snoozed_reminder_drops_the_panel_when_it_comes_due() {
        let s = with_due(&[60]);
        let mut p = Presenter::default();
        assert!(p.observe(&s, t(60 * MIN)).show);
        let z = snooze(&s, 5, t(60 * MIN)).unwrap();
        assert!(!p.observe(&z, t(61 * MIN)).show);
        assert!(p.observe(&z, t(65 * MIN)).show);
        // Nothing is shown while a session runs.
        let r = start(&with_due(&[60]), t(50 * MIN)).unwrap();
        let mut p = Presenter::default();
        assert_eq!(p.observe(&r, t(55 * MIN - 1)), Present::default());
    }

    #[test]
    fn the_thread_wakes_for_each_stage() {
        let s = with_due(&[60]);
        assert_eq!(next_event(&s, None, T0), Some(t(55 * MIN)));
        assert_eq!(next_event(&s, None, t(55 * MIN)), Some(t(60 * MIN)));
        assert_eq!(
            next_event(&s, Some(t(56 * MIN)), t(55 * MIN)),
            Some(t(56 * MIN))
        );
        assert_eq!(next_event(&s, None, t(60 * MIN)), Some(t(90 * MIN)));
        assert_eq!(next_event(&tick(&s, t(90 * MIN)), None, t(90 * MIN)), None);
        // No heads-up: the due time is next.
        assert_eq!(next_event(&heads_up(&s, 0), None, T0), Some(t(60 * MIN)));
        // A session's end comes first.
        let r = start(&s, t(10 * MIN)).unwrap();
        assert_eq!(next_event(&r, None, t(11 * MIN)), Some(t(15 * MIN)));
        // A snooze: its time, then its own 30 minutes.
        let z = snooze(&s, 5, t(60 * MIN)).unwrap();
        assert_eq!(next_event(&z, None, t(61 * MIN)), Some(t(65 * MIN)));
        assert_eq!(next_event(&z, None, t(65 * MIN)), Some(t(95 * MIN)));
        assert_eq!(next_event(&MedState::default(), None, T0), None);
    }

    #[test]
    fn the_display_under_the_mouse_is_found_by_its_frame() {
        // A 1512 × 982 main display with a 2560 × 1440 one to its left.
        let frames = [(0.0, 0.0, 1512.0, 982.0), (-2560.0, -200.0, 2560.0, 1440.0)];
        assert_eq!(monitor_under(&frames, 10.0, 10.0), Some(0));
        assert_eq!(monitor_under(&frames, 1511.9, 981.9), Some(0));
        assert_eq!(monitor_under(&frames, -1.0, 500.0), Some(1));
        assert_eq!(monitor_under(&frames, -2560.0, -200.0), Some(1));
        assert_eq!(monitor_under(&frames, 1512.0, 10.0), None);
        assert_eq!(monitor_under(&[], 0.0, 0.0), None);
    }
}
