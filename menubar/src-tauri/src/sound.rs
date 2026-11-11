//! Sound (chunk 95): the Spotify desktop app on this Mac, driven with
//! AppleScript. No Web API, no Spotify login.
//!
//! Rust owns it, so "play on focus, pause on break" works with the popover
//! closed and the web view suspended. Every control is one run of
//! `/usr/bin/osascript -e <script>`; the script text comes only from the fixed
//! templates below. The web view never sends AppleScript. The one parameter is
//! a playlist URI, validated before it is put in a template.
//!
//! Nothing here runs on the main thread: one worker thread runs every script,
//! in order, each under a 4 s timeout. Commands hand it a job and wait for the
//! reply on the blocking pool; the pomodoro edge sends a job and does not wait.
//!
//! Top half: pure pieces, unit-tested. Bottom half: the worker and the Tauri
//! commands.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

use crate::pomodoro::{json_string, MusicAction};

const OSASCRIPT: &str = "/usr/bin/osascript";
/// Each `osascript` run is killed after this long.
pub const TIMEOUT: Duration = Duration::from_secs(4);
/// Joins the fields of the state read (ASCII unit separator).
const SEP: char = '\u{1f}';
const URI_PREFIX: &str = "spotify:playlist:";
const AUTOMATION_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

// ---------------------------------------------------------------------------
// Templates. The only Spotify AppleScript this app runs; the browser
// scripts are `blocker.rs`'s own fixed templates (chunk 99).
// ---------------------------------------------------------------------------

/// The one read. `application "Spotify" is running` sends no Apple Event, so
/// it needs no permission and never launches Spotify; not running, the script
/// prints nothing.
pub const STATE_SCRIPT: &str = r#"if application "Spotify" is running then
set sep to character id 31
tell application "Spotify"
set s to player state as text
set t to ""
set a to ""
try
set t to name of current track
set a to artist of current track
end try
return s & sep & t & sep & a
end tell
end if"#;

// Writes. All but the pause may launch Spotify.
pub const PLAY_PAUSE_SCRIPT: &str = r#"tell application "Spotify" to playpause"#;
pub const NEXT_SCRIPT: &str = r#"tell application "Spotify" to next track"#;
pub const PREVIOUS_SCRIPT: &str = r#"tell application "Spotify" to previous track"#;
/// Resume where it stopped.
pub const PLAY_SCRIPT: &str = r#"tell application "Spotify" to play"#;
/// Never launches Spotify just to pause it.
pub const PAUSE_SCRIPT: &str =
    r#"if application "Spotify" is running then tell application "Spotify" to pause"#;

/// `^spotify:playlist:[A-Za-z0-9]{22}$` — nothing else reaches a template.
pub fn valid_uri(uri: &str) -> bool {
    uri.strip_prefix(URI_PREFIX)
        .is_some_and(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// `play track "<uri>"`, or nothing for a URI that is not a playlist's.
pub fn play_track_script(uri: &str) -> Option<String> {
    valid_uri(uri).then(|| format!(r#"tell application "Spotify" to play track "{uri}""#))
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Ok,
    NotInstalled,
    NotRunning,
    Denied,
    Timeout,
    Error,
}

impl Status {
    fn name(self) -> &'static str {
        match self {
            Status::Ok => "ok",
            Status::NotInstalled => "not_installed",
            Status::NotRunning => "not_running",
            Status::Denied => "denied",
            Status::Timeout => "timeout",
            Status::Error => "error",
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Spotify {
    pub status: Status,
    pub playing: bool,
    pub track: Option<String>,
    pub artist: Option<String>,
}

impl Spotify {
    pub fn only(status: Status) -> Spotify {
        Spotify {
            status,
            playing: false,
            track: None,
            artist: None,
        }
    }

    /// What the web view reads, written by hand like the pomodoro snapshot.
    pub fn json(&self) -> String {
        let text = |v: &Option<String>| match v {
            Some(s) => json_string(s),
            None => "null".into(),
        };
        format!(
            "{{\"status\":\"{}\",\"playing\":{},\"track\":{},\"artist\":{}}}",
            self.status.name(),
            self.playing,
            text(&self.track),
            text(&self.artist)
        )
    }
}

/// The state read's output: `state SEP track SEP artist`, or nothing when
/// Spotify is not running.
pub fn parse_state(stdout: &str) -> Spotify {
    let out = stdout.trim_end_matches(['\n', '\r']);
    if out.is_empty() {
        return Spotify::only(Status::NotRunning);
    }
    let mut parts = out.splitn(3, SEP);
    let playing = parts.next() == Some("playing");
    let mut field = || parts.next().filter(|s| !s.is_empty()).map(str::to_string);
    let track = field();
    let artist = field();
    Spotify {
        status: Status::Ok,
        playing,
        track,
        artist,
    }
}

/// A failed `osascript` run, from its stderr. `-1743`: the user has not
/// allowed (or has refused) Automation. `-600`: the app is not running.
pub fn classify_failure(stderr: &str) -> Status {
    if stderr.contains("-1743") {
        Status::Denied
    } else if stderr.contains("-600") {
        Status::NotRunning
    } else {
        Status::Error
    }
}

/// Whether `Spotify.app` is in one of these folders. Checked before any
/// script that names Spotify: compiling `tell application "Spotify"` without
/// it opens a "Where is Spotify?" dialog.
pub fn installed_in(folders: &[PathBuf]) -> bool {
    folders.iter().any(|f| f.join("Spotify.app").exists())
}

fn spotify_installed() -> bool {
    let mut folders = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        folders.push(Path::new(&home).join("Applications"));
    }
    installed_in(&folders)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PlayPlan {
    /// Already playing, or Spotify cannot be asked: leave it.
    Nothing,
    /// `play`: resume where it stopped.
    Resume,
    /// `play track <configured uri>`.
    PlayTrack,
}

/// What a focus start does. `last` is the last preset this app started.
/// Resume only makes sense in a running Spotify that still holds that
/// playlist; a closed one is started on the playlist again.
pub fn play_plan(status: Status, playing: bool, last: Option<&str>, configured: &str) -> PlayPlan {
    match status {
        Status::Ok if playing => PlayPlan::Nothing,
        Status::Ok if last == Some(configured) => PlayPlan::Resume,
        Status::Ok | Status::NotRunning => PlayPlan::PlayTrack,
        Status::NotInstalled | Status::Denied | Status::Timeout | Status::Error => {
            PlayPlan::Nothing
        }
    }
}

// ---------------------------------------------------------------------------
// Running a script
// ---------------------------------------------------------------------------

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Run {
    /// Exit 0, with stdout.
    Ok(String),
    /// Any other exit (or no start), with stderr.
    Failed(String),
    Timeout,
}

/// Runs one script. A plain fn pointer, so tests inject their own.
pub type Runner = fn(&str) -> Run;

/// Run a program, kill it after `timeout`. Polls `try_wait`; the outputs here
/// are a line at most, far below a pipe's buffer.
pub fn run_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Run {
    let mut child = match Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => return Run::Failed(e.to_string()),
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                let mut err = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_string(&mut out);
                }
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut err);
                }
                return if status.success() {
                    Run::Ok(out)
                } else {
                    Run::Failed(err)
                };
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Run::Timeout;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Run::Failed(e.to_string());
            }
        }
    }
}

fn osascript(script: &str) -> Run {
    run_with_timeout(OSASCRIPT, &["-e", script], TIMEOUT)
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

/// What the web view chose: play on focus or not, and the preset's playlist
/// (`None` = Silence). In memory; the web view sends it at sign-in and on
/// every change.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct SoundConfig {
    pub auto: bool,
    pub uri: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Op {
    State,
    PlayPause,
    /// Silence: a pause, never the toggle.
    Pause,
    Next,
    Previous,
    PlayPreset(String),
    /// The pomodoro edge (D9).
    Edge(MusicAction),
    /// A meditation session starts (chunk 96, D10): pause Spotify if it is
    /// playing, and remember that this session paused it.
    /// `after_focus_pause`: this start has just paused a running focus, so
    /// the pomodoro's Pause edge is queued ahead of it.
    MeditationStart { after_focus_pause: bool },
    /// It ends (D14): play again, only if this session paused it and it is
    /// still paused.
    MeditationEnd,
}

pub struct Job {
    pub op: Op,
    /// The fresh state as JSON; `None` when nobody waits (the edge).
    pub reply: Option<Sender<String>>,
}

struct Worker {
    runner: Runner,
    installed: fn() -> bool,
    config: Arc<Mutex<SoundConfig>>,
    /// The last preset this app started, to resume it instead of restarting.
    last_started: Option<String>,
    /// The running meditation session paused Spotify (chunk 96).
    meditation_paused: bool,
}

impl Worker {
    fn read(&self) -> Spotify {
        match (self.runner)(STATE_SCRIPT) {
            Run::Ok(out) => parse_state(&out),
            Run::Failed(err) => failed(&err),
            Run::Timeout => Spotify::only(Status::Timeout),
        }
    }

    fn run(&self, script: &str) -> Result<(), Spotify> {
        match (self.runner)(script) {
            Run::Ok(_) => Ok(()),
            Run::Failed(err) => Err(failed(&err)),
            Run::Timeout => Err(Spotify::only(Status::Timeout)),
        }
    }

    /// A write answers the fresh state after it runs.
    fn write(&self, script: &str) -> Spotify {
        match self.run(script) {
            Ok(()) => self.read(),
            Err(state) => state,
        }
    }

    fn play_track(&mut self, uri: &str) -> Spotify {
        let Some(script) = play_track_script(uri) else {
            return Spotify::only(Status::Error);
        };
        match self.run(&script) {
            Ok(()) => {
                self.last_started = Some(uri.to_string());
                self.read()
            }
            Err(state) => state,
        }
    }

    fn handle(&mut self, op: Op) -> Spotify {
        // Before any script that names Spotify (D6).
        if !(self.installed)() {
            return Spotify::only(Status::NotInstalled);
        }
        match op {
            Op::State => self.read(),
            Op::PlayPause => self.write(PLAY_PAUSE_SCRIPT),
            Op::Pause => self.write(PAUSE_SCRIPT),
            Op::Next => self.write(NEXT_SCRIPT),
            Op::Previous => self.write(PREVIOUS_SCRIPT),
            Op::PlayPreset(uri) => self.play_track(&uri),
            Op::Edge(action) => self.edge(action),
            Op::MeditationStart { after_focus_pause } => self.meditation_start(after_focus_pause),
            Op::MeditationEnd => self.meditation_end(),
        }
    }

    /// Unlike the edge, this does not depend on "play on focus" or a preset.
    fn meditation_start(&mut self, after_focus_pause: bool) -> Spotify {
        self.meditation_paused = false;
        // The pomodoro's Pause edge ran just before this and paused the
        // music itself. Spotify still answers `playing` for a few hundred ms
        // after a pause, so reading it here would pause twice and remember a
        // pause that is the focus's — the end would then start the music
        // under a paused focus. Nothing to pause, nothing to resume.
        if after_focus_pause && self.edge_acts() {
            return Spotify::only(Status::Ok);
        }
        let now = self.read();
        if now.status != Status::Ok || !now.playing {
            return now;
        }
        match self.run(PAUSE_SCRIPT) {
            Ok(()) => {
                self.meditation_paused = true;
                self.read()
            }
            Err(state) => state,
        }
    }

    /// If the music was started again in between, it is left alone.
    fn meditation_end(&mut self) -> Spotify {
        if !std::mem::take(&mut self.meditation_paused) {
            return Spotify::only(Status::Ok);
        }
        let now = self.read();
        if now.status == Status::Ok && !now.playing {
            self.write(PLAY_SCRIPT)
        } else {
            now
        }
    }

    /// Whether a pomodoro edge does anything: "play on focus" is on and a
    /// preset (not Silence) is set.
    fn edge_acts(&self) -> bool {
        let config = self.config.lock().unwrap_or_else(|e| e.into_inner());
        config.auto && config.uri.is_some()
    }

    /// Acts only when "play on focus" is on and a preset (not Silence) is set.
    fn edge(&mut self, action: MusicAction) -> Spotify {
        let config = self
            .config
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let Some(uri) = config.uri.filter(|_| config.auto) else {
            return Spotify::only(Status::Ok);
        };
        match action {
            MusicAction::Pause => self.write(PAUSE_SCRIPT),
            MusicAction::Play => {
                let now = self.read();
                match play_plan(now.status, now.playing, self.last_started.as_deref(), &uri) {
                    PlayPlan::Nothing => now,
                    PlayPlan::Resume => self.write(PLAY_SCRIPT),
                    PlayPlan::PlayTrack => self.play_track(&uri),
                }
            }
        }
    }
}

fn failed(stderr: &str) -> Spotify {
    let status = classify_failure(stderr);
    if status == Status::Error {
        eprintln!("menubar: osascript failed: {}", stderr.trim());
    }
    Spotify::only(status)
}

/// The one thread that runs scripts, in the order the jobs arrive. It ends
/// when every sender is gone.
pub fn spawn_worker(
    runner: Runner,
    installed: fn() -> bool,
    config: Arc<Mutex<SoundConfig>>,
) -> std::io::Result<Sender<Job>> {
    let (tx, rx) = mpsc::channel::<Job>();
    std::thread::Builder::new()
        .name("sound".into())
        .spawn(move || {
            let mut worker = Worker {
                runner,
                installed,
                config,
                last_started: None,
                meditation_paused: false,
            };
            for job in rx {
                let state = worker.handle(job.op);
                if let Some(reply) = job.reply {
                    let _ = reply.send(state.json());
                }
            }
        })?;
    Ok(tx)
}

// ---------------------------------------------------------------------------
// Tauri glue
// ---------------------------------------------------------------------------

/// The managed handle: the worker's queue and the web view's choice.
pub struct Sound {
    jobs: Mutex<Sender<Job>>,
    config: Arc<Mutex<SoundConfig>>,
}

impl Sound {
    pub fn start() -> std::io::Result<Sound> {
        let config = Arc::new(Mutex::new(SoundConfig::default()));
        let jobs = spawn_worker(osascript, spotify_installed, config.clone())?;
        Ok(Sound {
            jobs: Mutex::new(jobs),
            config,
        })
    }

    fn send(&self, op: Op, reply: Option<Sender<String>>) -> Result<(), String> {
        self.jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .send(Job { op, reply })
            .map_err(|e| e.to_string())
    }

    /// The pomodoro edge: queue it and return at once.
    pub fn edge(&self, action: MusicAction) {
        let _ = self.send(Op::Edge(action), None);
    }

    /// Meditation's two edges (chunk 96): queued, never waited for.
    pub fn meditation_start(&self, after_focus_pause: bool) {
        let _ = self.send(Op::MeditationStart { after_focus_pause }, None);
    }

    pub fn meditation_end(&self) {
        let _ = self.send(Op::MeditationEnd, None);
    }
}

/// Queue a job and wait for its reply off the main thread and off the async
/// runtime's workers.
async fn ask(app: AppHandle, op: Op) -> Result<Response, String> {
    let (tx, rx) = mpsc::channel();
    app.state::<Sound>().send(op, Some(tx))?;
    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map(Response::new)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn spotify_state(app: AppHandle) -> Result<Response, String> {
    ask(app, Op::State).await
}

#[tauri::command]
pub async fn spotify_play_pause(app: AppHandle) -> Result<Response, String> {
    ask(app, Op::PlayPause).await
}

/// Silence. A pause cannot start music, whatever Spotify did since the web
/// view last read it; and it never launches a closed Spotify.
#[tauri::command]
pub async fn spotify_pause(app: AppHandle) -> Result<Response, String> {
    ask(app, Op::Pause).await
}

#[tauri::command]
pub async fn spotify_next(app: AppHandle) -> Result<Response, String> {
    ask(app, Op::Next).await
}

#[tauri::command]
pub async fn spotify_previous(app: AppHandle) -> Result<Response, String> {
    ask(app, Op::Previous).await
}

#[tauri::command]
pub async fn spotify_play_preset(app: AppHandle, uri: String) -> Result<Response, String> {
    if !valid_uri(&uri) {
        return Err("not a playlist uri".into());
    }
    ask(app, Op::PlayPreset(uri)).await
}

/// `uri: null` is Silence. Runs no script.
#[tauri::command]
pub fn sound_configure(app: AppHandle, auto: bool, uri: Option<String>) -> Result<(), String> {
    if uri.as_deref().is_some_and(|u| !valid_uri(u)) {
        return Err("not a playlist uri".into());
    }
    let sound = app.state::<Sound>();
    *sound.config.lock().unwrap_or_else(|e| e.into_inner()) = SoundConfig { auto, uri };
    Ok(())
}

/// Open System Settings → Privacy & Security → Automation. The URL is fixed
/// here, like `open_dashboard`'s.
#[tauri::command]
pub fn open_automation_settings() -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg(AUTOMATION_SETTINGS_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "spotify:playlist:37i9dQZF1DX7EF8wVxBVhG";
    const OTHER: &str = "spotify:playlist:37i9dQZF1DWZeKCadgRdKQ";

    fn yes() -> bool {
        true
    }
    fn no() -> bool {
        false
    }

    fn config(auto: bool, uri: Option<&str>) -> Arc<Mutex<SoundConfig>> {
        Arc::new(Mutex::new(SoundConfig {
            auto,
            uri: uri.map(str::to_string),
        }))
    }

    fn worker(runner: Runner, auto: bool, uri: Option<&str>) -> Worker {
        Worker {
            runner,
            installed: yes,
            config: config(auto, uri),
            last_started: None,
            meditation_paused: false,
        }
    }

    fn state_line(state: &str, track: &str, artist: &str) -> String {
        format!("{state}{SEP}{track}{SEP}{artist}\n")
    }

    // ---- URI ----

    #[test]
    fn a_playlist_uri_is_valid() {
        assert!(valid_uri(GOOD));
        assert!(valid_uri("spotify:playlist:abcdefghijABCDEFGHIJ01"));
    }

    #[test]
    fn a_wrong_prefix_is_rejected() {
        assert!(!valid_uri("spotify:track:37i9dQZF1DX7EF8wVxBVhG"));
        assert!(!valid_uri("spotify:album:37i9dQZF1DX7EF8wVxBVhG"));
        assert!(!valid_uri("https://open.spotify.com/playlist/37i9dQZF1DX7EF8wVxBVhG"));
        assert!(!valid_uri(" spotify:playlist:37i9dQZF1DX7EF8wVxBVhG"));
        assert!(!valid_uri(""));
    }

    #[test]
    fn a_wrong_length_is_rejected() {
        assert!(!valid_uri("spotify:playlist:37i9dQZF1DX7EF8wVxBVh")); // 21
        assert!(!valid_uri("spotify:playlist:37i9dQZF1DX7EF8wVxBVhGx")); // 23
        assert!(!valid_uri("spotify:playlist:"));
    }

    #[test]
    fn quote_and_backslash_injection_is_rejected() {
        // Each is 22 characters after the prefix: only the alphabet stops them.
        for id in [
            "37i9dQZF1DX7EF8wVxBV\"x",
            "37i9dQZF1DX7EF8wVxBV\\x",
            "\" & (do shell script)&",
            "37i9dQZF1DX7EF8wVxBV\nx",
            "37i9dQZF1DX7EF8wVxBVhé",
        ] {
            let uri = format!("spotify:playlist:{id}");
            assert!(!valid_uri(&uri), "{uri:?}");
            assert_eq!(play_track_script(&uri), None);
        }
        assert!(!valid_uri(
            "spotify:playlist:37i9dQZF1DX7EF8wVxBVhG\" & (do shell script \"id\") & \""
        ));
    }

    // ---- templates ----

    #[test]
    fn the_write_templates_are_exactly_these() {
        assert_eq!(PLAY_PAUSE_SCRIPT, "tell application \"Spotify\" to playpause");
        assert_eq!(NEXT_SCRIPT, "tell application \"Spotify\" to next track");
        assert_eq!(PREVIOUS_SCRIPT, "tell application \"Spotify\" to previous track");
        assert_eq!(PLAY_SCRIPT, "tell application \"Spotify\" to play");
        assert_eq!(
            PAUSE_SCRIPT,
            "if application \"Spotify\" is running then tell application \"Spotify\" to pause"
        );
        assert_eq!(
            play_track_script(GOOD).as_deref(),
            Some("tell application \"Spotify\" to play track \"spotify:playlist:37i9dQZF1DX7EF8wVxBVhG\"")
        );
    }

    #[test]
    fn the_state_template_is_exactly_this_and_guarded() {
        let expected = [
            "if application \"Spotify\" is running then",
            "set sep to character id 31",
            "tell application \"Spotify\"",
            "set s to player state as text",
            "set t to \"\"",
            "set a to \"\"",
            "try",
            "set t to name of current track",
            "set a to artist of current track",
            "end try",
            "return s & sep & t & sep & a",
            "end tell",
            "end if",
        ]
        .join("\n");
        assert_eq!(STATE_SCRIPT, expected);
        // A read never launches Spotify (D6), and asks for no artwork.
        assert!(STATE_SCRIPT.starts_with("if application \"Spotify\" is running then"));
        assert!(STATE_SCRIPT.ends_with("end if"));
        assert!(!STATE_SCRIPT.contains("artwork"));
        assert_eq!(SEP as u32, 31);
    }

    // ---- parse_state ----

    #[test]
    fn parse_playing() {
        let s = parse_state(&state_line("playing", "Alpha Waves, 10 Hz", "Binaural Mind"));
        assert_eq!(s.status, Status::Ok);
        assert!(s.playing);
        assert_eq!(s.track.as_deref(), Some("Alpha Waves, 10 Hz"));
        assert_eq!(s.artist.as_deref(), Some("Binaural Mind"));
    }

    #[test]
    fn parse_paused() {
        let s = parse_state(&state_line("paused", "Aria", "J.S. Bach"));
        assert_eq!(s.status, Status::Ok);
        assert!(!s.playing);
        assert_eq!(s.track.as_deref(), Some("Aria"));
    }

    #[test]
    fn parse_stopped_has_no_track() {
        let s = parse_state(&state_line("stopped", "", ""));
        assert_eq!(s, Spotify::only(Status::Ok));
    }

    #[test]
    fn parse_empty_output_is_not_running() {
        assert_eq!(parse_state(""), Spotify::only(Status::NotRunning));
        assert_eq!(parse_state("\n"), Spotify::only(Status::NotRunning));
    }

    #[test]
    fn state_json_is_what_the_web_view_reads() {
        let s = parse_state(&state_line("playing", "Say \"hi\"", "A\\B"));
        assert_eq!(
            s.json(),
            r#"{"status":"ok","playing":true,"track":"Say \"hi\"","artist":"A\\B"}"#
        );
        assert_eq!(
            Spotify::only(Status::NotInstalled).json(),
            r#"{"status":"not_installed","playing":false,"track":null,"artist":null}"#
        );
        for (status, name) in [
            (Status::NotRunning, "not_running"),
            (Status::Denied, "denied"),
            (Status::Timeout, "timeout"),
            (Status::Error, "error"),
        ] {
            assert!(Spotify::only(status)
                .json()
                .starts_with(&format!("{{\"status\":\"{name}\"")));
        }
    }

    // ---- stderr ----

    #[test]
    fn stderr_is_classified() {
        assert_eq!(
            classify_failure(
                "execution error: Not authorized to send Apple events to Spotify. (-1743)"
            ),
            Status::Denied
        );
        assert_eq!(
            classify_failure("execution error: Spotify got an error: Application isn’t running. (-600)"),
            Status::NotRunning
        );
        assert_eq!(
            classify_failure("execution error: Spotify got an error: Can’t get current track. (-1728)"),
            Status::Error
        );
        assert_eq!(classify_failure(""), Status::Error);
    }

    // ---- installed ----

    #[test]
    fn installed_is_a_spotify_app_in_one_of_the_folders() {
        let root = std::env::temp_dir().join(format!("hup-sound-test-{}", std::process::id()));
        let (apps, home_apps) = (root.join("Applications"), root.join("home/Applications"));
        std::fs::create_dir_all(&apps).unwrap();
        std::fs::create_dir_all(&home_apps).unwrap();
        let folders = [apps.clone(), home_apps.clone()];
        assert!(!installed_in(&folders));
        std::fs::create_dir(apps.join("Spotify Helper.app")).unwrap();
        assert!(!installed_in(&folders));
        std::fs::create_dir(home_apps.join("Spotify.app")).unwrap();
        assert!(installed_in(&folders));
        assert!(!installed_in(&[apps]));
        assert!(!installed_in(&[]));
        std::fs::remove_dir_all(&root).unwrap();
    }

    // ---- the Play rule ----

    #[test]
    fn play_leaves_a_playing_spotify_alone() {
        assert_eq!(play_plan(Status::Ok, true, None, GOOD), PlayPlan::Nothing);
        assert_eq!(play_plan(Status::Ok, true, Some(GOOD), GOOD), PlayPlan::Nothing);
        assert_eq!(play_plan(Status::Ok, true, Some(OTHER), GOOD), PlayPlan::Nothing);
    }

    #[test]
    fn play_resumes_the_preset_this_app_started() {
        assert_eq!(play_plan(Status::Ok, false, Some(GOOD), GOOD), PlayPlan::Resume);
    }

    #[test]
    fn play_starts_a_different_preset_from_its_playlist() {
        assert_eq!(play_plan(Status::Ok, false, Some(OTHER), GOOD), PlayPlan::PlayTrack);
        assert_eq!(play_plan(Status::Ok, false, None, GOOD), PlayPlan::PlayTrack);
    }

    #[test]
    fn play_starts_the_playlist_again_in_a_closed_spotify() {
        assert_eq!(play_plan(Status::NotRunning, false, Some(GOOD), GOOD), PlayPlan::PlayTrack);
        assert_eq!(play_plan(Status::NotRunning, false, None, GOOD), PlayPlan::PlayTrack);
    }

    #[test]
    fn play_does_nothing_when_spotify_cannot_be_asked() {
        for status in [Status::NotInstalled, Status::Denied, Status::Timeout, Status::Error] {
            assert_eq!(play_plan(status, false, Some(GOOD), GOOD), PlayPlan::Nothing);
        }
    }

    // ---- the edge, against an injected runner ----

    #[test]
    fn edge_play_starts_the_playlist_then_resumes_it() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            if script == STATE_SCRIPT {
                Run::Ok(format!("paused{SEP}Aria{SEP}Bach\n"))
            } else {
                Run::Ok(String::new())
            }
        }
        let mut w = worker(runner, true, Some(GOOD));
        w.handle(Op::Edge(MusicAction::Play));
        w.handle(Op::Edge(MusicAction::Pause));
        w.handle(Op::Edge(MusicAction::Play));
        let play_track = play_track_script(GOOD).unwrap();
        assert_eq!(
            *LOG.lock().unwrap(),
            [
                // Play: read, then the playlist (nothing started yet).
                STATE_SCRIPT,
                play_track.as_str(),
                STATE_SCRIPT,
                // Pause.
                PAUSE_SCRIPT,
                STATE_SCRIPT,
                // Play again: the same preset resumes.
                STATE_SCRIPT,
                PLAY_SCRIPT,
                STATE_SCRIPT,
            ]
        );
    }

    #[test]
    fn edge_play_leaves_a_playing_spotify_alone() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(format!("playing{SEP}Aria{SEP}Bach\n"))
        }
        let mut w = worker(runner, true, Some(GOOD));
        w.handle(Op::Edge(MusicAction::Play));
        assert_eq!(*LOG.lock().unwrap(), [STATE_SCRIPT]);
    }

    #[test]
    fn edge_does_nothing_with_auto_off_or_silence() {
        static RUNS: Mutex<u32> = Mutex::new(0);
        fn runner(_: &str) -> Run {
            *RUNS.lock().unwrap() += 1;
            Run::Ok(String::new())
        }
        for (auto, uri) in [(false, Some(GOOD)), (true, None), (false, None)] {
            let mut w = worker(runner, auto, uri);
            w.handle(Op::Edge(MusicAction::Play));
            w.handle(Op::Edge(MusicAction::Pause));
        }
        assert_eq!(*RUNS.lock().unwrap(), 0);
    }

    #[test]
    fn a_preset_tap_is_remembered_for_the_next_focus() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            if script == STATE_SCRIPT {
                Run::Ok(format!("paused{SEP}{SEP}\n"))
            } else {
                Run::Ok(String::new())
            }
        }
        let mut w = worker(runner, true, Some(GOOD));
        w.handle(Op::PlayPreset(GOOD.to_string()));
        w.handle(Op::Edge(MusicAction::Play));
        let log = LOG.lock().unwrap();
        assert_eq!(log.last().map(String::as_str), Some(STATE_SCRIPT));
        assert_eq!(log[log.len() - 2], PLAY_SCRIPT);
    }

    #[test]
    fn pause_runs_the_pause_script_and_never_the_toggle() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            if script == STATE_SCRIPT {
                Run::Ok(format!("paused{SEP}Aria{SEP}Bach\n"))
            } else {
                Run::Ok(String::new())
            }
        }
        // Silence: auto off and no preset must not matter, unlike the edge.
        let mut w = worker(runner, false, None);
        let state = w.handle(Op::Pause);
        assert_eq!(state.status, Status::Ok);
        assert!(!state.playing);
        // The pause, then the fresh state it answers.
        assert_eq!(*LOG.lock().unwrap(), [PAUSE_SCRIPT, STATE_SCRIPT]);
        assert!(!LOG.lock().unwrap().iter().any(|s| s == PLAY_PAUSE_SCRIPT));
    }

    #[test]
    fn a_failed_write_answers_its_failure_and_is_not_remembered() {
        fn runner(script: &str) -> Run {
            if script == STATE_SCRIPT {
                Run::Ok(String::new())
            } else {
                Run::Failed("execution error: Not authorized to send Apple events to Spotify. (-1743)".into())
            }
        }
        let mut w = worker(runner, true, Some(GOOD));
        assert_eq!(w.handle(Op::PlayPreset(GOOD.to_string())).status, Status::Denied);
        assert_eq!(w.last_started, None);
        assert_eq!(w.handle(Op::Next).status, Status::Denied);
        assert_eq!(w.handle(Op::State).status, Status::NotRunning);
    }

    // ---- meditation (chunk 96) ----

    #[test]
    fn meditation_start_pauses_a_playing_spotify_and_remembers_it() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(format!("playing{SEP}Aria{SEP}Bach\n"))
        }
        // "Play on focus" off and Silence: this is not the pomodoro edge.
        let mut w = worker(runner, false, None);
        w.handle(Op::MeditationStart { after_focus_pause: false });
        assert!(w.meditation_paused);
        assert_eq!(*LOG.lock().unwrap(), [STATE_SCRIPT, PAUSE_SCRIPT, STATE_SCRIPT]);
    }

    #[test]
    fn meditation_start_leaves_a_paused_spotify_alone() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(format!("paused{SEP}Aria{SEP}Bach\n"))
        }
        let mut w = worker(runner, true, Some(GOOD));
        // A flag left by an earlier session does not survive a new start.
        w.meditation_paused = true;
        w.handle(Op::MeditationStart { after_focus_pause: false });
        assert!(!w.meditation_paused);
        assert_eq!(*LOG.lock().unwrap(), [STATE_SCRIPT]);
        // And a closed Spotify is not launched to be paused.
        fn closed(script: &str) -> Run {
            assert_eq!(script, STATE_SCRIPT);
            Run::Ok(String::new())
        }
        let mut w = worker(closed, true, Some(GOOD));
        assert_eq!(w.handle(Op::MeditationStart { after_focus_pause: false }).status, Status::NotRunning);
        assert!(!w.meditation_paused);
    }

    /// Spotify still answers `playing` for a few hundred ms after a pause
    /// (chunk 96 native run), so a start that follows the pomodoro's Pause
    /// edge must not read it: it would pause again, remember that, and the
    /// end would start the music under a paused focus.
    #[test]
    fn meditation_start_after_the_focus_edge_paused_reads_nothing() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(format!("playing{SEP}Aria{SEP}Bach\n"))
        }
        let mut w = worker(runner, true, Some(GOOD));
        w.meditation_paused = true;
        w.handle(Op::MeditationStart { after_focus_pause: true });
        assert!(!w.meditation_paused);
        assert!(LOG.lock().unwrap().is_empty());
    }

    /// "Play on focus" off: the edge did nothing, so the music is this
    /// session's to pause and to start again.
    #[test]
    fn meditation_start_after_a_focus_pause_without_auto_still_pauses() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(format!("playing{SEP}Aria{SEP}Bach\n"))
        }
        let mut w = worker(runner, false, Some(GOOD));
        w.handle(Op::MeditationStart { after_focus_pause: true });
        assert!(w.meditation_paused);
        assert_eq!(*LOG.lock().unwrap(), [STATE_SCRIPT, PAUSE_SCRIPT, STATE_SCRIPT]);
    }

    #[test]
    fn meditation_end_plays_again_what_the_session_paused() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(format!("paused{SEP}Aria{SEP}Bach\n"))
        }
        let mut w = worker(runner, false, None);
        w.meditation_paused = true;
        w.handle(Op::MeditationEnd);
        assert!(!w.meditation_paused);
        assert_eq!(*LOG.lock().unwrap(), [STATE_SCRIPT, PLAY_SCRIPT, STATE_SCRIPT]);
        // Once: a second end has no flag.
        w.handle(Op::MeditationEnd);
        assert_eq!(LOG.lock().unwrap().len(), 3);
    }

    #[test]
    fn meditation_end_leaves_music_that_was_started_again() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(format!("playing{SEP}Aria{SEP}Bach\n"))
        }
        let mut w = worker(runner, false, None);
        w.meditation_paused = true;
        w.handle(Op::MeditationEnd);
        assert!(!w.meditation_paused);
        assert_eq!(*LOG.lock().unwrap(), [STATE_SCRIPT]);
    }

    #[test]
    fn meditation_end_without_the_flag_runs_no_script() {
        static RUNS: Mutex<u32> = Mutex::new(0);
        fn runner(_: &str) -> Run {
            *RUNS.lock().unwrap() += 1;
            Run::Ok(format!("paused{SEP}Aria{SEP}Bach\n"))
        }
        let mut w = worker(runner, true, Some(GOOD));
        assert_eq!(w.handle(Op::MeditationEnd), Spotify::only(Status::Ok));
        assert_eq!(*RUNS.lock().unwrap(), 0);
    }

    #[test]
    fn meditation_end_does_not_launch_a_spotify_that_was_quit() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(script.to_string());
            Run::Ok(String::new())
        }
        let mut w = worker(runner, false, None);
        w.meditation_paused = true;
        assert_eq!(w.handle(Op::MeditationEnd).status, Status::NotRunning);
        assert_eq!(*LOG.lock().unwrap(), [STATE_SCRIPT]);
    }

    #[test]
    fn not_installed_runs_no_script() {
        static RUNS: Mutex<u32> = Mutex::new(0);
        fn runner(_: &str) -> Run {
            *RUNS.lock().unwrap() += 1;
            Run::Ok(String::new())
        }
        let mut w = worker(runner, true, Some(GOOD));
        w.installed = no;
        for op in [
            Op::State,
            Op::PlayPause,
            Op::Pause,
            Op::Next,
            Op::Previous,
            Op::PlayPreset(GOOD.to_string()),
            Op::Edge(MusicAction::Play),
            Op::Edge(MusicAction::Pause),
            Op::MeditationStart { after_focus_pause: false },
            Op::MeditationEnd,
        ] {
            assert_eq!(w.handle(op).status, Status::NotInstalled);
        }
        assert_eq!(*RUNS.lock().unwrap(), 0);
    }

    // ---- the worker thread ----

    #[test]
    fn a_hung_program_is_killed_at_the_timeout() {
        let started = Instant::now();
        let run = run_with_timeout("/bin/sleep", &["5"], Duration::from_millis(150));
        assert_eq!(run, Run::Timeout);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn a_program_reports_its_stdout_or_its_stderr() {
        let t = Duration::from_secs(2);
        assert_eq!(run_with_timeout("/bin/echo", &["hi"], t), Run::Ok("hi\n".into()));
        assert!(matches!(
            run_with_timeout("/bin/ls", &["/no/such/folder"], t),
            Run::Failed(e) if e.contains("No such file")
        ));
        assert!(matches!(
            run_with_timeout("/no/such/program", &[], t),
            Run::Failed(_)
        ));
    }

    #[test]
    fn the_worker_reports_a_timeout_and_keeps_going() {
        fn runner(script: &str) -> Run {
            if script == NEXT_SCRIPT {
                // The real path: a child that outlives its timeout.
                run_with_timeout("/bin/sleep", &["5"], Duration::from_millis(100))
            } else {
                Run::Ok(format!("paused{SEP}Aria{SEP}Bach\n"))
            }
        }
        let jobs = spawn_worker(runner, yes, config(false, None)).unwrap();
        let (tx, rx) = mpsc::channel();
        jobs.send(Job { op: Op::Next, reply: Some(tx.clone()) }).unwrap();
        jobs.send(Job { op: Op::State, reply: Some(tx) }).unwrap();
        let wait = Duration::from_secs(3);
        assert_eq!(
            rx.recv_timeout(wait).unwrap(),
            r#"{"status":"timeout","playing":false,"track":null,"artist":null}"#
        );
        assert_eq!(
            rx.recv_timeout(wait).unwrap(),
            r#"{"status":"ok","playing":false,"track":"Aria","artist":"Bach"}"#
        );
    }

    #[test]
    fn the_worker_runs_jobs_one_at_a_time_in_order() {
        static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn runner(script: &str) -> Run {
            LOG.lock().unwrap().push(format!("start {script}"));
            // Long enough that an out-of-order or overlapping run would show.
            std::thread::sleep(Duration::from_millis(30));
            LOG.lock().unwrap().push(format!("end {script}"));
            Run::Ok(String::new())
        }
        let jobs = spawn_worker(runner, yes, config(true, Some(GOOD))).unwrap();
        let (tx, rx) = mpsc::channel();
        // The edge goes in first without a reply; the rest queue behind it.
        jobs.send(Job { op: Op::Edge(MusicAction::Pause), reply: None }).unwrap();
        for op in [Op::Next, Op::Previous, Op::PlayPause] {
            jobs.send(Job { op, reply: Some(tx.clone()) }).unwrap();
        }
        for _ in 0..3 {
            rx.recv_timeout(Duration::from_secs(3)).unwrap();
        }
        let expected: Vec<String> = [PAUSE_SCRIPT, NEXT_SCRIPT, PREVIOUS_SCRIPT, PLAY_PAUSE_SCRIPT]
            .iter()
            // Each write is followed by its state read.
            .flat_map(|s| [*s, STATE_SCRIPT])
            .flat_map(|s| [format!("start {s}"), format!("end {s}")])
            .collect();
        assert_eq!(*LOG.lock().unwrap(), expected);
    }
}
