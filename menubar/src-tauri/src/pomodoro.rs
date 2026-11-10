//! The pomodoro timer (chunk 94). Rust owns it: macOS throttles or suspends a
//! hidden web view, so nothing about the countdown, the phase changes or the
//! tray text may depend on JS running. The web view sends commands, renders
//! the focus header while the popover is shown, and supplies the settings.
//!
//! Top half: pure state and transitions, tested with injected times. Bottom
//! half: the Tauri glue — the managed state, the commands, and the one thread
//! that advances the phase and writes the tray.
//!
//! Time is wall-clock (`SystemTime`), never `Instant`: on macOS `Instant`
//! stops while the Mac sleeps. There is no tick counting anywhere — remaining
//! time is always `ends_at − now`.

use std::collections::HashMap;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::image::Image;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager};

const MINUTE_MS: u64 = 60_000;
/// `pomodoro_extend` adds this much to the current phase.
const EXTEND_MS: u64 = 5 * MINUTE_MS;
const TITLE_MAX: usize = 200;
const ID_MAX: usize = 64;
/// The focus ring is redrawn at most this many times a phase.
pub const RING_STEPS: u8 = 24;
/// Tray images are 44 px (22 pt @2x), like `icons/tray.png`.
const TRAY_PX: u32 = 44;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Idle,
    Focus,
    ShortBreak,
    LongBreak,
}

impl Phase {
    fn name(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Focus => "focus",
            Phase::ShortBreak => "short_break",
            Phase::LongBreak => "long_break",
        }
    }
}

/// Minutes, minutes, minutes, a count, and the tray's compact format.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Config {
    pub focus: u32,
    pub short: u32,
    pub long: u32,
    pub every: u32,
    pub compact: bool,
}

impl Config {
    pub const DEFAULT: Config = Config {
        focus: 25,
        short: 5,
        long: 15,
        every: 4,
        compact: false,
    };

    /// Out-of-range values are rejected, not clamped.
    pub fn validated(
        focus: u32,
        short: u32,
        long: u32,
        every: u32,
        compact: bool,
    ) -> Result<Config, String> {
        let check = |name: &str, v: u32, min: u32, max: u32| {
            if (min..=max).contains(&v) {
                Ok(())
            } else {
                Err(format!("{name} must be {min}–{max}"))
            }
        };
        check("focus", focus, 1, 180)?;
        check("short", short, 1, 60)?;
        check("long", long, 1, 90)?;
        check("every", every, 1, 12)?;
        Ok(Config {
            focus,
            short,
            long,
            every,
            compact,
        })
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Task {
    pub id: String,
    pub title: String,
}

#[derive(Clone, PartialEq, Debug)]
pub struct State {
    pub phase: Phase,
    /// Only in `Focus` and the breaks.
    pub paused: bool,
    /// Wall-clock end of the running phase. Stale while paused or idle.
    pub ends_at: SystemTime,
    /// The phase's whole length, for the ring fraction.
    pub phase_len_ms: u64,
    /// What was left when paused; `ends_at` is recomputed on resume.
    pub remaining_ms: u64,
    /// 1..=`every` — the `2 OF 4`.
    pub cycle_pos: u32,
    pub task: Option<Task>,
    pub config: Config,
    /// The last open-Today count the web view sent; the idle tray title.
    pub idle_title: String,
}

impl Default for State {
    fn default() -> Self {
        State {
            phase: Phase::Idle,
            paused: false,
            ends_at: UNIX_EPOCH,
            phase_len_ms: 0,
            remaining_ms: 0,
            cycle_pos: 1,
            task: None,
            config: Config::DEFAULT,
            idle_title: String::new(),
        }
    }
}

fn ms(d: u64) -> Duration {
    Duration::from_millis(d)
}

fn epoch_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Time left in the current phase: frozen while paused, 0 when idle.
pub fn remaining_ms(s: &State, now: SystemTime) -> u64 {
    match s.phase {
        Phase::Idle => 0,
        _ if s.paused => s.remaining_ms,
        _ => s
            .ends_at
            .duration_since(now)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    }
}

fn to_idle(mut s: State) -> State {
    s.phase = Phase::Idle;
    s.paused = false;
    s.ends_at = UNIX_EPOCH;
    s.phase_len_ms = 0;
    s.remaining_ms = 0;
    s.task = None;
    s
}

/// The current phase ends at `at`: focus → its break, a break → idle.
fn end_phase(mut s: State, at: SystemTime) -> State {
    match s.phase {
        Phase::Idle => s,
        Phase::Focus => {
            let (phase, minutes) = if s.cycle_pos >= s.config.every {
                (Phase::LongBreak, s.config.long)
            } else {
                (Phase::ShortBreak, s.config.short)
            };
            s.phase = phase;
            s.paused = false;
            s.phase_len_ms = minutes as u64 * MINUTE_MS;
            s.remaining_ms = 0;
            s.ends_at = at + ms(s.phase_len_ms);
            s
        }
        Phase::ShortBreak => {
            s.cycle_pos = if s.cycle_pos >= s.config.every {
                1
            } else {
                s.cycle_pos + 1
            };
            to_idle(s)
        }
        Phase::LongBreak => {
            s.cycle_pos = 1;
            to_idle(s)
        }
    }
}

/// Every transition time alone causes. Focus ends → its break starts by
/// itself, anchored to the focus's *scheduled* end, so a Mac that slept
/// through the focus end and the break end wakes to `Idle`. A break ends →
/// `Idle`; the next focus never starts on its own. May cross several
/// boundaries in one call.
pub fn advance(state: &State, now: SystemTime) -> State {
    let mut s = state.clone();
    while s.phase != Phase::Idle && !s.paused && now >= s.ends_at {
        let at = s.ends_at;
        s = end_phase(s, at);
    }
    s
}

/// `Focus` for `config.focus` minutes, from `Idle` or a break (the break is
/// abandoned, `cycle_pos` unchanged). Rejected while focus is running or
/// paused.
pub fn start(state: &State, task: Option<Task>, now: SystemTime) -> Result<State, String> {
    if state.phase == Phase::Focus {
        return Err("focus is already running".into());
    }
    let mut s = state.clone();
    s.phase = Phase::Focus;
    s.paused = false;
    s.phase_len_ms = s.config.focus as u64 * MINUTE_MS;
    s.remaining_ms = 0;
    s.ends_at = now + ms(s.phase_len_ms);
    s.task = task.map(|t| Task {
        id: t.id.chars().take(ID_MAX).collect(),
        title: t.title.chars().take(TITLE_MAX).collect(),
    });
    Ok(s)
}

pub fn pause(state: &State, now: SystemTime) -> Result<State, String> {
    if state.phase == Phase::Idle {
        return Err("no session".into());
    }
    if state.paused {
        return Err("already paused".into());
    }
    let mut s = state.clone();
    s.remaining_ms = remaining_ms(state, now);
    s.paused = true;
    Ok(s)
}

pub fn resume(state: &State, now: SystemTime) -> Result<State, String> {
    if state.phase == Phase::Idle || !state.paused {
        return Err("not paused".into());
    }
    let mut s = state.clone();
    s.paused = false;
    s.ends_at = now + ms(s.remaining_ms);
    s.remaining_ms = 0;
    Ok(s)
}

/// +5 minutes to the current phase, running or paused.
pub fn extend(state: &State) -> Result<State, String> {
    if state.phase == Phase::Idle {
        return Err("no session".into());
    }
    let mut s = state.clone();
    s.phase_len_ms += EXTEND_MS;
    if s.paused {
        s.remaining_ms += EXTEND_MS;
    } else {
        s.ends_at += ms(EXTEND_MS);
    }
    Ok(s)
}

/// In focus: the session counts and its break starts now. In a break: idle,
/// with the `cycle_pos` rule of a natural end.
pub fn skip(state: &State, now: SystemTime) -> Result<State, String> {
    if state.phase == Phase::Idle {
        return Err("no session".into());
    }
    Ok(end_phase(state.clone(), now))
}

/// `Idle` from anywhere; the session is not counted.
pub fn stop(state: &State) -> State {
    to_idle(state.clone())
}

/// Applies from the next phase; a running phase keeps its length.
pub fn configure(state: &State, config: Config) -> State {
    let mut s = state.clone();
    s.config = config;
    s
}

/// The idle tray title: a number of up to four digits, else nothing — the
/// web view is the only sender, but the bar is not its to fill.
pub fn valid_idle_title(title: &str) -> String {
    let t = title.trim();
    let ok = !t.is_empty() && t.len() <= 4 && t.bytes().all(|b| b.is_ascii_digit());
    if ok {
        t.to_string()
    } else {
        String::new()
    }
}

/// `mm:ss`, `h:mm:ss` from an hour up; compact: whole minutes rounded up.
/// Seconds round up too, so a fresh 25-minute phase reads `25:00`.
pub fn clock(remaining_ms: u64, compact: bool) -> String {
    if compact {
        return format!("{}m", remaining_ms.div_ceil(MINUTE_MS));
    }
    let s = remaining_ms.div_ceil(1000);
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, s % 3600 / 60, s % 60)
    } else {
        format!("{:02}:{:02}", s / 60, s % 60)
    }
}

/// The tray text. Idle: the open-Today count. Otherwise the time left, frozen
/// while paused.
pub fn tray_title(state: &State, now: SystemTime) -> String {
    match state.phase {
        Phase::Idle => state.idle_title.clone(),
        _ => clock(remaining_ms(state, now), state.config.compact),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrayIcon {
    /// The app's mark (idle).
    Mark,
    /// Focus: the elapsed fraction in 1/24 steps.
    Ring(u8),
    /// A break.
    Cup,
    /// Paused.
    Bars,
}

pub fn tray_icon(state: &State, now: SystemTime) -> TrayIcon {
    match state.phase {
        Phase::Idle => TrayIcon::Mark,
        _ if state.paused => TrayIcon::Bars,
        Phase::Focus => {
            let len = state.phase_len_ms.max(1);
            let elapsed = len.saturating_sub(remaining_ms(state, now));
            TrayIcon::Ring((elapsed * RING_STEPS as u64 / len).min(RING_STEPS as u64) as u8)
        }
        Phase::ShortBreak | Phase::LongBreak => TrayIcon::Cup,
    }
}

/// Alpha of the ring's track; the arc is opaque.
pub const TRACK_ALPHA: u8 = 77; // 30 %

/// The focus tray icon: a `size`-px RGBA ring — a 30 % track and an opaque
/// arc for the elapsed `fraction`, clockwise from 12 o'clock. Black with
/// alpha: macOS draws a template image from its alpha channel alone.
/// Geometry is the prototype's states strip (viewBox 14, r 5.5, stroke 2).
pub fn ring_rgba(size: u32, fraction: f32) -> Vec<u8> {
    const SS: u32 = 4;
    let fraction = fraction.clamp(0.0, 1.0);
    let unit = size as f32 / 14.0;
    let (c, r, half) = (size as f32 / 2.0, 5.5 * unit, unit);
    let sweep = fraction * std::f32::consts::TAU;
    // Round caps: a dot at each end of a partial arc.
    let end = (c + r * sweep.sin(), c - r * sweep.cos());
    let mut out = vec![0u8; (size * size * 4) as usize];
    for py in 0..size {
        for px in 0..size {
            let (mut track, mut arc) = (0u32, 0u32);
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = px as f32 + (sx as f32 + 0.5) / SS as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / SS as f32;
                    let (dx, dy) = (x - c, y - c);
                    let on_ring = ((dx * dx + dy * dy).sqrt() - r).abs() <= half;
                    if !on_ring && fraction == 0.0 {
                        continue;
                    }
                    let mut angle = dx.atan2(-dy);
                    if angle < 0.0 {
                        angle += std::f32::consts::TAU;
                    }
                    let near = |p: (f32, f32)| (x - p.0).hypot(y - p.1) <= half;
                    let in_arc = fraction >= 1.0 && on_ring
                        || fraction > 0.0
                            && (on_ring && angle <= sweep || near((c, c - r)) || near(end));
                    if in_arc {
                        arc += 1;
                    } else if on_ring {
                        track += 1;
                    }
                }
            }
            let n = SS * SS;
            let alpha = (arc * 255 + track * TRACK_ALPHA as u32) / n;
            out[((py * size + px) * 4 + 3) as usize] = alpha as u8;
        }
    }
    out
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => {
                out.push_str(&format!("\\u{:04x}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The snapshot the web view reads, as JSON (written by hand — the shell has
/// no serde dependency of its own). `endsAt` is epoch ms, `null` unless a
/// phase is running; `remainingMs` is always set.
pub fn snapshot_json(s: &State, now: SystemTime) -> String {
    let running = s.phase != Phase::Idle && !s.paused;
    let ends_at = if running {
        epoch_ms(s.ends_at).to_string()
    } else {
        "null".into()
    };
    let task = match &s.task {
        Some(t) => format!(
            "{{\"id\":{},\"title\":{}}}",
            json_string(&t.id),
            json_string(&t.title)
        ),
        None => "null".into(),
    };
    let c = &s.config;
    format!(
        "{{\"phase\":\"{}\",\"paused\":{},\"endsAt\":{},\"phaseLenMs\":{},\"remainingMs\":{},\
         \"cyclePos\":{},\"task\":{},\"config\":{{\"focus\":{},\"short\":{},\"long\":{},\
         \"every\":{},\"compact\":{}}}}}",
        s.phase.name(),
        s.paused,
        ends_at,
        s.phase_len_ms,
        remaining_ms(s, now),
        s.cycle_pos,
        task,
        c.focus,
        c.short,
        c.long,
        c.every,
        c.compact
    )
}

// ---------------------------------------------------------------------------
// Tauri glue
// ---------------------------------------------------------------------------

struct Inner {
    state: State,
    /// Bumped on every change a command makes, so the loop never sleeps
    /// through one that landed while it was writing the tray.
    generation: u64,
}

/// The managed timer. Commands change `state` and wake the loop; the loop is
/// the only writer of the tray. The lock is never held across a tray write or
/// an emit — those hop to the main thread, where a command may be waiting on
/// this same lock.
pub struct Pomodoro {
    inner: Mutex<Inner>,
    wake: Condvar,
}

impl Default for Pomodoro {
    fn default() -> Self {
        Pomodoro {
            inner: Mutex::new(Inner {
                state: State::default(),
                generation: 0,
            }),
            wake: Condvar::new(),
        }
    }
}

impl Pomodoro {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Run one command: bring the state up to `now`, apply `f`, and emit one
    /// `pomodoro` event if anything changed. A rejected command still keeps
    /// what time alone changed.
    fn change(
        &self,
        app: &AppHandle,
        f: impl FnOnce(&State, SystemTime) -> Result<State, String>,
    ) -> Result<Response, String> {
        let now = SystemTime::now();
        let (json, changed, rejected) = {
            let mut g = self.lock();
            let base = advance(&g.state, now);
            let (next, rejected) = match f(&base, now) {
                Ok(next) => (next, None),
                Err(e) => (base, Some(e)),
            };
            let changed = next != g.state;
            if changed {
                g.state = next;
                g.generation += 1;
            }
            (snapshot_json(&g.state, now), changed, rejected)
        };
        if changed {
            self.wake.notify_all();
            let _ = app.emit_str("pomodoro", json.clone());
        }
        match rejected {
            Some(e) => Err(e),
            None => Ok(Response::new(json)),
        }
    }

    /// Store the open-Today count. The loop shows it when (and only when)
    /// the timer is idle.
    pub fn set_idle_title(&self, title: &str) {
        let title = valid_idle_title(title);
        {
            let mut g = self.lock();
            if g.state.idle_title == title {
                return;
            }
            g.state.idle_title = title;
            g.generation += 1;
        }
        self.wake.notify_all();
    }
}

#[tauri::command]
pub fn pomodoro_state(app: AppHandle) -> Result<Response, String> {
    app.state::<Pomodoro>().change(&app, |s, _| Ok(s.clone()))
}

#[tauri::command]
pub fn pomodoro_configure(
    app: AppHandle,
    focus: u32,
    short: u32,
    long: u32,
    every: u32,
    compact: bool,
) -> Result<Response, String> {
    let config = Config::validated(focus, short, long, every, compact)?;
    app.state::<Pomodoro>()
        .change(&app, |s, _| Ok(configure(s, config)))
}

/// `task` is `{ id, title }` or null (a bare session).
#[tauri::command]
pub fn pomodoro_start(
    app: AppHandle,
    task: Option<HashMap<String, String>>,
) -> Result<Response, String> {
    let task = match task {
        None => None,
        Some(mut t) => Some(Task {
            id: t.remove("id").ok_or("task.id missing")?,
            title: t.remove("title").ok_or("task.title missing")?,
        }),
    };
    app.state::<Pomodoro>()
        .change(&app, |s, now| start(s, task, now))
}

#[tauri::command]
pub fn pomodoro_pause(app: AppHandle) -> Result<Response, String> {
    app.state::<Pomodoro>().change(&app, pause)
}

#[tauri::command]
pub fn pomodoro_resume(app: AppHandle) -> Result<Response, String> {
    app.state::<Pomodoro>().change(&app, resume)
}

#[tauri::command]
pub fn pomodoro_extend(app: AppHandle) -> Result<Response, String> {
    app.state::<Pomodoro>().change(&app, |s, _| extend(s))
}

#[tauri::command]
pub fn pomodoro_skip(app: AppHandle) -> Result<Response, String> {
    app.state::<Pomodoro>().change(&app, skip)
}

#[tauri::command]
pub fn pomodoro_stop(app: AppHandle) -> Result<Response, String> {
    app.state::<Pomodoro>().change(&app, |s, _| Ok(stop(s)))
}

fn tray_image(icon: TrayIcon) -> Image<'static> {
    match icon {
        TrayIcon::Mark => tauri::include_image!("icons/tray.png"),
        TrayIcon::Cup => tauri::include_image!("icons/tray-break.png"),
        TrayIcon::Bars => tauri::include_image!("icons/tray-paused.png"),
        TrayIcon::Ring(step) => Image::new_owned(
            ring_rgba(TRAY_PX, step as f32 / RING_STEPS as f32),
            TRAY_PX,
            TRAY_PX,
        ),
    }
}

/// How long the loop may sleep: until the tray's seconds next change.
fn next_wake(state: &State, now: SystemTime) -> Duration {
    let into_second = remaining_ms(state, now) % 1000;
    ms(if into_second == 0 { 1000 } else { into_second } + 15)
}

/// The one timer thread (std only). While a phase runs it wakes about once a
/// second, advances the phase and writes the tray — only when the text or the
/// icon actually changed. Paused or idle it parks on the condvar until a
/// command wakes it: no polling.
pub fn spawn_loop(app: AppHandle, tray_id: &'static str) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("pomodoro".into())
        .spawn(move || {
            let pomo = app.state::<Pomodoro>();
            // What the tray shows now: the builder's mark and no title.
            let mut shown_title = String::new();
            let mut shown_icon = TrayIcon::Mark;
            loop {
                let now = SystemTime::now();
                let (title, icon, event, generation) = {
                    let mut g = pomo.lock();
                    let next = advance(&g.state, now);
                    let event = (next != g.state).then(|| snapshot_json(&next, now));
                    g.state = next;
                    (
                        tray_title(&g.state, now),
                        tray_icon(&g.state, now),
                        event,
                        g.generation,
                    )
                };
                if let Some(json) = event {
                    let _ = app.emit_str("pomodoro", json);
                }
                if let Some(tray) = app.tray_by_id(tray_id) {
                    if icon != shown_icon {
                        // `set_icon` alone drops the template flag
                        // (tray-icon 0.25); this call sets both.
                        if tray
                            .set_icon_with_as_template(Some(tray_image(icon)), true)
                            .is_ok()
                        {
                            shown_icon = icon;
                        }
                    }
                    if title != shown_title {
                        let text = (!title.is_empty()).then_some(title.as_str());
                        if tray.set_title(text).is_ok() {
                            shown_title = title;
                        }
                    }
                }

                let g = pomo.lock();
                if g.generation != generation {
                    continue; // a command landed while the tray was written
                }
                if g.state.phase != Phase::Idle && !g.state.paused {
                    let wait = next_wake(&g.state, SystemTime::now());
                    drop(pomo.wake.wait_timeout(g, wait));
                } else {
                    drop(
                        pomo.wake
                            .wait_while(g, |inner| inner.generation == generation),
                    );
                }
            }
        })
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u64 = MINUTE_MS;

    fn at(ms_: u64) -> SystemTime {
        UNIX_EPOCH + ms(1_800_000_000_000 + ms_)
    }

    fn focus_at_zero() -> State {
        start(&State::default(), None, at(0)).unwrap()
    }

    fn with_pos(pos: u32) -> State {
        State {
            cycle_pos: pos,
            ..State::default()
        }
    }

    // ---- advance ----

    #[test]
    fn focus_runs_until_its_end() {
        let s = focus_at_zero();
        assert_eq!(s.phase, Phase::Focus);
        assert_eq!(s.ends_at, at(25 * MIN));
        assert_eq!(s.phase_len_ms, 25 * MIN);
        assert_eq!(advance(&s, at(25 * MIN - 1)), s);
    }

    #[test]
    fn focus_end_starts_a_short_break_by_itself() {
        let s = advance(&focus_at_zero(), at(25 * MIN));
        assert_eq!(s.phase, Phase::ShortBreak);
        assert_eq!(s.ends_at, at(30 * MIN));
        assert_eq!(s.phase_len_ms, 5 * MIN);
        assert_eq!(s.cycle_pos, 1);
        assert!(!s.paused);
    }

    #[test]
    fn fourth_focus_ends_in_a_long_break() {
        let s = start(&with_pos(4), None, at(0)).unwrap();
        let s = advance(&s, at(25 * MIN));
        assert_eq!(s.phase, Phase::LongBreak);
        assert_eq!(s.ends_at, at(40 * MIN));
        assert_eq!(s.phase_len_ms, 15 * MIN);
    }

    #[test]
    fn short_break_ends_idle_and_moves_the_cycle_on() {
        let s = advance(&focus_at_zero(), at(25 * MIN + 1));
        let s = advance(&s, at(30 * MIN));
        assert_eq!(s.phase, Phase::Idle);
        assert_eq!(s.cycle_pos, 2);
        // The next focus never starts on its own.
        assert_eq!(advance(&s, at(500 * MIN)), s);
    }

    #[test]
    fn long_break_ends_idle_and_resets_the_cycle() {
        let s = start(&with_pos(4), None, at(0)).unwrap();
        let s = advance(&s, at(26 * MIN));
        let s = advance(&s, at(40 * MIN));
        assert_eq!(s.phase, Phase::Idle);
        assert_eq!(s.cycle_pos, 1);
    }

    #[test]
    fn sleep_across_focus_and_break_wakes_idle() {
        let task = Some(Task {
            id: "t1".into(),
            title: "Draft".into(),
        });
        let s = start(&State::default(), task, at(0)).unwrap();
        let s = advance(&s, at(8 * 60 * MIN));
        assert_eq!(s.phase, Phase::Idle);
        assert_eq!(s.cycle_pos, 2);
        assert_eq!(s.task, None);
    }

    #[test]
    fn sleep_across_focus_end_only_wakes_in_the_anchored_break() {
        // Noticed 3 minutes late: the break still ends at focus end + 5.
        let s = advance(&focus_at_zero(), at(28 * MIN));
        assert_eq!(s.phase, Phase::ShortBreak);
        assert_eq!(s.ends_at, at(30 * MIN));
        assert_eq!(remaining_ms(&s, at(28 * MIN)), 2 * MIN);
    }

    // ---- commands ----

    #[test]
    fn pause_freezes_and_resume_recomputes_the_end() {
        let s = pause(&focus_at_zero(), at(10 * MIN)).unwrap();
        assert!(s.paused);
        assert_eq!(s.remaining_ms, 15 * MIN);
        // Paused, time does nothing.
        assert_eq!(advance(&s, at(300 * MIN)), s);
        assert_eq!(remaining_ms(&s, at(300 * MIN)), 15 * MIN);

        let r = resume(&s, at(60 * MIN)).unwrap();
        assert!(!r.paused);
        assert_eq!(r.ends_at, at(75 * MIN));
        assert_eq!(r.phase_len_ms, 25 * MIN);

        assert!(pause(&s, at(11 * MIN)).is_err());
        assert!(resume(&r, at(61 * MIN)).is_err());
        assert!(pause(&State::default(), at(0)).is_err());
    }

    #[test]
    fn breaks_pause_and_resume_too() {
        let b = advance(&focus_at_zero(), at(25 * MIN));
        let p = pause(&b, at(26 * MIN)).unwrap();
        assert_eq!(p.phase, Phase::ShortBreak);
        assert_eq!(p.remaining_ms, 4 * MIN);
        let r = resume(&p, at(50 * MIN)).unwrap();
        assert_eq!(r.ends_at, at(54 * MIN));
    }

    #[test]
    fn extend_adds_five_minutes_running_and_paused() {
        let s = extend(&focus_at_zero()).unwrap();
        assert_eq!(s.ends_at, at(30 * MIN));
        assert_eq!(s.phase_len_ms, 30 * MIN);

        let p = pause(&focus_at_zero(), at(10 * MIN)).unwrap();
        let p = extend(&p).unwrap();
        assert_eq!(p.remaining_ms, 20 * MIN);
        assert_eq!(p.phase_len_ms, 30 * MIN);

        assert!(extend(&State::default()).is_err());
    }

    #[test]
    fn skip_in_focus_counts_the_session_and_starts_the_break_now() {
        let s = skip(&focus_at_zero(), at(10 * MIN)).unwrap();
        assert_eq!(s.phase, Phase::ShortBreak);
        assert_eq!(s.ends_at, at(15 * MIN));
        // Counted: the break's end moves the cycle on.
        assert_eq!(advance(&s, at(15 * MIN)).cycle_pos, 2);

        let fourth = start(&with_pos(4), None, at(0)).unwrap();
        assert_eq!(skip(&fourth, at(MIN)).unwrap().phase, Phase::LongBreak);

        // A paused focus skips to a running break.
        let p = pause(&focus_at_zero(), at(10 * MIN)).unwrap();
        let b = skip(&p, at(90 * MIN)).unwrap();
        assert!(!b.paused);
        assert_eq!(b.ends_at, at(95 * MIN));
    }

    #[test]
    fn skip_in_a_break_goes_idle_with_the_natural_cycle_rule() {
        let b = advance(&focus_at_zero(), at(25 * MIN));
        let s = skip(&b, at(26 * MIN)).unwrap();
        assert_eq!(s.phase, Phase::Idle);
        assert_eq!(s.cycle_pos, 2);

        let fourth = start(&with_pos(4), None, at(0)).unwrap();
        let long = advance(&fourth, at(25 * MIN));
        assert_eq!(skip(&long, at(26 * MIN)).unwrap().cycle_pos, 1);

        assert!(skip(&State::default(), at(0)).is_err());
    }

    #[test]
    fn stop_goes_idle_without_counting() {
        let s = stop(&start(&with_pos(3), None, at(0)).unwrap());
        assert_eq!(s.phase, Phase::Idle);
        assert_eq!(s.cycle_pos, 3);
        let b = advance(&start(&with_pos(3), None, at(0)).unwrap(), at(25 * MIN));
        assert_eq!(stop(&b).cycle_pos, 3);
        assert_eq!(stop(&State::default()), State::default());
    }

    #[test]
    fn start_is_rejected_while_focus_is_running_or_paused() {
        let s = focus_at_zero();
        assert!(start(&s, None, at(MIN)).is_err());
        let p = pause(&s, at(MIN)).unwrap();
        assert!(start(&p, None, at(2 * MIN)).is_err());
    }

    #[test]
    fn start_from_a_break_abandons_it_and_keeps_the_cycle() {
        let b = advance(&focus_at_zero(), at(25 * MIN));
        let s = start(&b, None, at(26 * MIN)).unwrap();
        assert_eq!(s.phase, Phase::Focus);
        assert_eq!(s.cycle_pos, 1);
        assert_eq!(s.ends_at, at(51 * MIN));
    }

    #[test]
    fn start_keeps_the_task_and_truncates_its_title() {
        let task = Task {
            id: "t1".into(),
            title: "é".repeat(300),
        };
        let s = start(&State::default(), Some(task), at(0)).unwrap();
        let t = s.task.unwrap();
        assert_eq!(t.id, "t1");
        assert_eq!(t.title.chars().count(), 200);
    }

    #[test]
    fn config_applies_from_the_next_phase() {
        let c = Config::validated(50, 10, 30, 2, true).unwrap();
        let s = configure(&focus_at_zero(), c);
        assert_eq!(s.ends_at, at(25 * MIN));
        assert_eq!(s.phase_len_ms, 25 * MIN);
        let b = advance(&s, at(25 * MIN));
        assert_eq!(b.phase_len_ms, 10 * MIN);
        let idle = advance(&b, at(35 * MIN));
        assert_eq!(start(&idle, None, at(40 * MIN)).unwrap().phase_len_ms, 50 * MIN);
    }

    #[test]
    fn config_validation_rejects_out_of_range() {
        assert_eq!(
            Config::validated(25, 5, 15, 4, false),
            Ok(Config::DEFAULT)
        );
        assert!(Config::validated(1, 1, 1, 1, true).is_ok());
        assert!(Config::validated(180, 60, 90, 12, true).is_ok());
        assert!(Config::validated(0, 5, 15, 4, false).is_err());
        assert!(Config::validated(181, 5, 15, 4, false).is_err());
        assert!(Config::validated(25, 0, 15, 4, false).is_err());
        assert!(Config::validated(25, 61, 15, 4, false).is_err());
        assert!(Config::validated(25, 5, 0, 4, false).is_err());
        assert!(Config::validated(25, 5, 91, 4, false).is_err());
        assert!(Config::validated(25, 5, 15, 0, false).is_err());
        assert!(Config::validated(25, 5, 15, 13, false).is_err());
    }

    // ---- tray ----

    fn idle_with(title: &str) -> State {
        State {
            idle_title: title.into(),
            ..State::default()
        }
    }

    #[test]
    fn tray_title_idle_is_the_open_count() {
        assert_eq!(tray_title(&idle_with("4"), at(0)), "4");
        assert_eq!(tray_title(&idle_with(""), at(0)), "");
        assert_eq!(valid_idle_title(" 12 "), "12");
        assert_eq!(valid_idle_title("12345"), "");
        assert_eq!(valid_idle_title("4 tasks"), "");
        assert_eq!(valid_idle_title(""), "");
    }

    #[test]
    fn tray_title_counts_down_in_mm_ss() {
        let s = start(&idle_with("4"), None, at(0)).unwrap();
        assert_eq!(tray_title(&s, at(0)), "25:00");
        assert_eq!(tray_title(&s, at(1)), "25:00");
        assert_eq!(tray_title(&s, at(1000)), "24:59");
        assert_eq!(tray_title(&s, at(8 * MIN + 12_000)), "16:48");
        assert_eq!(tray_title(&s, at(25 * MIN - 1)), "00:01");
        let b = advance(&s, at(25 * MIN));
        assert_eq!(tray_title(&b, at(25 * MIN + 29_000)), "04:31");
        // Back to the count once idle.
        assert_eq!(tray_title(&advance(&b, at(30 * MIN)), at(30 * MIN)), "4");
    }

    #[test]
    fn tray_title_shows_hours_from_sixty_minutes_up() {
        let c = Config::validated(90, 5, 15, 4, false).unwrap();
        let s = start(&configure(&State::default(), c), None, at(0)).unwrap();
        assert_eq!(tray_title(&s, at(0)), "1:30:00");
        assert_eq!(tray_title(&s, at(30 * MIN)), "1:00:00");
        assert_eq!(tray_title(&s, at(30 * MIN + 1000)), "59:59");
    }

    #[test]
    fn tray_title_compact_rounds_minutes_up() {
        let c = Config::validated(25, 5, 15, 4, true).unwrap();
        let s = start(&configure(&State::default(), c), None, at(0)).unwrap();
        assert_eq!(tray_title(&s, at(0)), "25m");
        assert_eq!(tray_title(&s, at(8 * MIN + 12_000)), "17m");
        assert_eq!(tray_title(&s, at(9 * MIN)), "16m");
        let c = Config::validated(65, 5, 15, 4, true).unwrap();
        let s = start(&configure(&State::default(), c), None, at(0)).unwrap();
        assert_eq!(tray_title(&s, at(1)), "65m");
    }

    #[test]
    fn tray_title_paused_is_the_frozen_time() {
        let p = pause(&focus_at_zero(), at(8 * MIN + 12_000)).unwrap();
        assert_eq!(tray_title(&p, at(8 * MIN + 12_000)), "16:48");
        assert_eq!(tray_title(&p, at(900 * MIN)), "16:48");
    }

    #[test]
    fn tray_icon_follows_the_state() {
        assert_eq!(tray_icon(&State::default(), at(0)), TrayIcon::Mark);
        let s = focus_at_zero();
        assert_eq!(tray_icon(&s, at(0)), TrayIcon::Ring(0));
        assert_eq!(tray_icon(&s, at(12 * MIN + 30_000)), TrayIcon::Ring(12));
        assert_eq!(tray_icon(&s, at(25 * MIN - 1)), TrayIcon::Ring(23));
        let p = pause(&s, at(5 * MIN)).unwrap();
        assert_eq!(tray_icon(&p, at(5 * MIN)), TrayIcon::Bars);
        let b = advance(&s, at(25 * MIN));
        assert_eq!(tray_icon(&b, at(25 * MIN)), TrayIcon::Cup);
        assert_eq!(
            tray_icon(&pause(&b, at(26 * MIN)).unwrap(), at(26 * MIN)),
            TrayIcon::Bars
        );
    }

    // ---- ring ----

    fn alpha(img: &[u8], size: u32, x: u32, y: u32) -> u8 {
        img[((y * size + x) * 4 + 3) as usize]
    }

    /// Pixels on the ring's centre line at 12, 3, 6 and 9 o'clock.
    fn clock_points(size: u32) -> [(u32, u32); 4] {
        let c = size / 2;
        let r = (5.5 * size as f32 / 14.0) as u32;
        [(c, c - r), (c + r - 1, c), (c, c + r - 1), (c - r, c)]
    }

    #[test]
    fn ring_at_zero_is_all_track() {
        let img = ring_rgba(44, 0.0);
        assert_eq!(img.len(), 44 * 44 * 4);
        assert_eq!(alpha(&img, 44, 22, 22), 0);
        assert_eq!(alpha(&img, 44, 0, 0), 0);
        for (x, y) in clock_points(44) {
            assert_eq!(alpha(&img, 44, x, y), TRACK_ALPHA);
        }
        assert!(img.chunks(4).all(|p| p[3] <= TRACK_ALPHA));
        // Template image: colour is black, only alpha varies.
        assert!(img.chunks(4).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0));
    }

    #[test]
    fn ring_at_half_fills_the_right_side() {
        let img = ring_rgba(44, 0.5);
        let [_, three, _, nine] = clock_points(44);
        assert_eq!(alpha(&img, 44, three.0, three.1), 255);
        assert_eq!(alpha(&img, 44, nine.0, nine.1), TRACK_ALPHA);
        assert_eq!(alpha(&img, 44, 22, 22), 0);
    }

    #[test]
    fn ring_at_one_is_all_arc() {
        let img = ring_rgba(44, 1.0);
        for (x, y) in clock_points(44) {
            assert_eq!(alpha(&img, 44, x, y), 255);
        }
        assert_eq!(alpha(&img, 44, 22, 22), 0);
        // Never lighter than the bare track anywhere.
        let track = ring_rgba(44, 0.0);
        assert!(img.chunks(4).zip(track.chunks(4)).all(|(a, t)| a[3] >= t[3]));
    }

    // ---- snapshot ----

    #[test]
    fn snapshot_is_json_the_web_view_can_read() {
        assert_eq!(
            snapshot_json(&State::default(), at(0)),
            "{\"phase\":\"idle\",\"paused\":false,\"endsAt\":null,\"phaseLenMs\":0,\
             \"remainingMs\":0,\"cyclePos\":1,\"task\":null,\"config\":{\"focus\":25,\
             \"short\":5,\"long\":15,\"every\":4,\"compact\":false}}"
        );
        let task = Task {
            id: "t1".into(),
            title: "Say \"hi\" \\ é\n\u{1}".into(),
        };
        let s = start(&State::default(), Some(task), at(0)).unwrap();
        let json = snapshot_json(&s, at(MIN));
        assert!(json.contains("\"phase\":\"focus\""));
        assert!(json.contains("\"endsAt\":1800001500000"));
        assert!(json.contains("\"phaseLenMs\":1500000"));
        assert!(json.contains("\"remainingMs\":1440000"));
        assert!(json.contains("\"title\":\"Say \\\"hi\\\" \\\\ é\\n\\u0001\""));
        let p = pause(&s, at(MIN)).unwrap();
        let json = snapshot_json(&p, at(9 * MIN));
        assert!(json.contains("\"paused\":true,\"endsAt\":null"));
        assert!(json.contains("\"remainingMs\":1440000"));
    }
}
