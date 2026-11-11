//! Site blocking (chunk 99): keep the active tab of each supported browser
//! window off the sites in the user's block groups, while a focus phase runs
//! and/or inside the group's scheduled hours.
//!
//! A web page cannot block other sites, so the rules live in Supabase, the
//! dashboard edits them, the web view turns them into a `Config` (the
//! schedule as epoch-ms windows, D17) and this file enforces them. One
//! thread, `blocker`, reads the URL of the active tab of every window of
//! each installed, running browser through `osascript`, and sends a tab
//! whose host matches to the fixed blocked page. Background tabs are left
//! alone until they become the active tab; nothing is closed.
//!
//! The AppleScript comes only from the fixed templates below; the one
//! variable in their text is the bundle id from the fixed browser table
//! (by bundle id, not by name: by name, `application "Microsoft Edge"`
//! resolved to Microsoft Teams' WebView helper on a Mac with Teams). A window id and the URLs travel as `osascript` arguments after the
//! script, never inside its text. A URL read from a browser stays in this
//! file, in memory: it is never in the state JSON, an event, a log line or a
//! file.
//!
//! Nothing active (the usual case) means no `osascript` at all: the thread
//! waits on its condvar until a change, or until the next scheduled start
//! (capped at 30 s, so a start after sleep is at most 30 s late). Active, it
//! reads every 2 s; a browser that answered `not_running` is tried again
//! after 10 s (so a browser opened during a block is caught within 10 s),
//! and one that answered `denied`, `timeout` or `error` after 30 s.
//!
//! The `Blocker` lock is a leaf: never taken under the pomodoro, meditation
//! or sessions lock, and never held across an `osascript` run or an emit.
//!
//! Top half: pure pieces, unit-tested. Bottom half: the thread and the Tauri
//! commands.

use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager};

use crate::pomodoro::json_string;
use crate::sound::{run_with_timeout, Run, TIMEOUT};

const OSASCRIPT: &str = "/usr/bin/osascript";
/// The dashboard's own pages, the blocked page among them, are never blocked.
pub const EXEMPT_PREFIX: &str = "https://smrios07mdb.github.io/dashboard/";
pub const BLOCKED_PAGE: &str = "https://smrios07mdb.github.io/dashboard/blocked.html";
/// Joins a window id and its URL in the read's output (ASCII unit separator).
const SEP: char = '\u{1f}';

pub const ACTIVE_WAIT: Duration = Duration::from_secs(2);
pub const RETRY_MS: u64 = 30_000;
/// A browser that answered "not running" is read again after this, not on
/// every pass: a browser opened during a block is caught within 10 s.
pub const NOT_RUNNING_MS: u64 = 10_000;
pub const IDLE_CAP: Duration = Duration::from_secs(30);

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
pub const MAX_GROUPS: usize = 20;
pub const MAX_DOMAINS: usize = 50;
pub const MAX_WINDOWS: usize = 60;

// ---------------------------------------------------------------------------
// Domains and hosts
// ---------------------------------------------------------------------------

/// D2: 1–253 characters of `[a-z0-9.-]`, at least one dot, no leading or
/// trailing dot or hyphen, no `..`. The same rule as `src/lib/blockRules.ts`.
pub fn valid_domain(d: &str) -> bool {
    (1..=253).contains(&d.len())
        && d.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && d.contains('.')
        && !d.contains("..")
        && !d.starts_with(['.', '-'])
        && !d.ends_with(['.', '-'])
}

/// The host of an `http` / `https` URL, lowercase, without userinfo, port or
/// a trailing dot. Anything else (`chrome://`, `file://`, `about:blank`, an
/// empty string) has none.
pub fn host_of(url: &str) -> Option<String> {
    let lower = url.get(..8).map(str::to_ascii_lowercase).unwrap_or_default();
    let rest = if lower.starts_with("https://") {
        &url[8..]
    } else if lower.starts_with("http://") {
        &url[7..]
    } else {
        return None;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = authority.rsplit('@').next().unwrap_or("");
    let host = match hostport.rfind(':') {
        // `[::1]:80` and bare IPv6 keep their brackets; only a trailing port goes.
        Some(i) if !hostport[i + 1..].contains(']') => &hostport[..i],
        _ => hostport,
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

/// `x.com` matches `x.com` and every subdomain, never `notx.com`.
pub fn matches(host: &str, domain: &str) -> bool {
    host == domain
        || (host.len() > domain.len()
            && host.ends_with(domain)
            && host.as_bytes()[host.len() - domain.len() - 1] == b'.')
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Group {
    pub name: String,
    pub domains: Vec<String>,
    /// Block during a focus phase.
    pub focus: bool,
    /// Scheduled windows, epoch ms, `start < end`.
    pub windows: Vec<(u64, u64)>,
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Config {
    pub enabled: bool,
    pub groups: Vec<Group>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Reason {
    Focus,
    Schedule,
}

impl Reason {
    /// The blocked page, with this reason as its fragment.
    pub fn url(self) -> String {
        match self {
            Reason::Focus => format!("{BLOCKED_PAGE}#focus"),
            Reason::Schedule => format!("{BLOCKED_PAGE}#schedule"),
        }
    }
}

fn in_window(g: &Group, now: u64) -> bool {
    g.windows.iter().any(|&(s, e)| s <= now && now < e)
}

/// Why this URL must not be the active tab now, if it must not. `Focus`
/// beats `Schedule`.
pub fn verdict(config: &Config, focus_on: bool, now: u64, url: &str) -> Option<Reason> {
    if !config.enabled || url.starts_with(EXEMPT_PREFIX) {
        return None;
    }
    let host = host_of(url)?;
    let mut scheduled = false;
    for g in &config.groups {
        if !g.domains.iter().any(|d| matches(&host, d)) {
            continue;
        }
        if focus_on && g.focus {
            return Some(Reason::Focus);
        }
        scheduled |= in_window(g, now);
    }
    scheduled.then_some(Reason::Schedule)
}

/// Whether any group blocks anything now. Nothing active, nothing runs.
pub fn anything_active(config: &Config, focus_on: bool, now: u64) -> bool {
    config.enabled
        && config
            .groups
            .iter()
            .any(|g| !g.domains.is_empty() && ((focus_on && g.focus) || in_window(g, now)))
}

/// The next scheduled start after `now`, when one exists.
pub fn next_start(config: &Config, now: u64) -> Option<u64> {
    if !config.enabled {
        return None;
    }
    config
        .groups
        .iter()
        .filter(|g| !g.domains.is_empty())
        .flat_map(|g| g.windows.iter().map(|&(s, _)| s))
        .filter(|&s| s > now)
        .min()
}

/// D14: the web view's parallel lists → a `Config`, or the reason the whole
/// set is rejected. Nothing is clamped.
pub fn validate(
    enabled: bool,
    names: Vec<String>,
    domains: Vec<Vec<String>>,
    focus: Vec<bool>,
    starts: Vec<Vec<u64>>,
    ends: Vec<Vec<u64>>,
    now: u64,
) -> Result<Config, String> {
    let n = names.len();
    if [domains.len(), focus.len(), starts.len(), ends.len()]
        .iter()
        .any(|&l| l != n)
    {
        return Err("lists differ in length".into());
    }
    if n > MAX_GROUPS {
        return Err("too many groups".into());
    }
    let lo = now.saturating_sub(2 * DAY_MS);
    let hi = now + 16 * DAY_MS;
    let mut groups = Vec::with_capacity(n);
    for ((((name, doms), f), s), e) in names.into_iter().zip(domains).zip(focus).zip(starts).zip(ends) {
        if !(1..=40).contains(&name.trim().chars().count()) {
            return Err("bad group name".into());
        }
        if doms.len() > MAX_DOMAINS {
            return Err("too many domains".into());
        }
        if !doms.iter().all(|d| valid_domain(d)) {
            return Err("bad domain".into());
        }
        if s.len() != e.len() {
            return Err("starts and ends differ in length".into());
        }
        if s.len() > MAX_WINDOWS {
            return Err("too many windows".into());
        }
        let windows: Vec<(u64, u64)> = s.into_iter().zip(e).collect();
        if !windows.iter().all(|&(a, b)| a < b) {
            return Err("window ends before it starts".into());
        }
        if !windows.iter().all(|&(a, b)| a >= lo && b <= hi) {
            return Err("window out of range".into());
        }
        groups.push(Group {
            name,
            domains: doms,
            focus: f,
            windows,
        });
    }
    Ok(Config { enabled, groups })
}

// ---------------------------------------------------------------------------
// Browsers and scripts
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dialect {
    /// `URL of active tab of w`
    Chromium,
    /// `URL of current tab of w`
    Safari,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Browser {
    /// The application name, for display only (Settings › Blocking).
    pub name: &'static str,
    /// What every script addresses: the only variable in a script's text.
    /// By name, `application "Microsoft Edge"` resolved to Microsoft Teams'
    /// WebView helper on a Mac with Teams (chunk 99 gate).
    pub bundle_id: &'static str,
    pub app_file: &'static str,
    pub dialect: Dialect,
}

/// D6: the fixed table. Firefox and Arc are not covered.
pub const BROWSERS: [Browser; 4] = [
    Browser {
        name: "Google Chrome",
        bundle_id: "com.google.Chrome",
        app_file: "Google Chrome.app",
        dialect: Dialect::Chromium,
    },
    Browser {
        name: "Safari",
        bundle_id: "com.apple.Safari",
        app_file: "Safari.app",
        dialect: Dialect::Safari,
    },
    Browser {
        name: "Brave Browser",
        bundle_id: "com.brave.Browser",
        app_file: "Brave Browser.app",
        dialect: Dialect::Chromium,
    },
    Browser {
        name: "Microsoft Edge",
        bundle_id: "com.microsoft.edgemac",
        app_file: "Microsoft Edge.app",
        dialect: Dialect::Chromium,
    },
];

fn tab_ref(d: Dialect) -> &'static str {
    match d {
        Dialect::Chromium => "active tab",
        Dialect::Safari => "current tab",
    }
}

/// One line per window: `<window id>` SEP `<url of its active tab>`, then a
/// last line `ok` (skipped by `parse_tabs`, it tells "running, no windows"
/// from "not running"). `is running` sends no Apple Event: the read never
/// launches a browser, and prints nothing when it is not running. Each
/// window sits in its own `try`, so one odd window (a Safari settings
/// window, an empty tab) does not lose the others.
pub fn read_script(b: &Browser) -> String {
    format!(
        r#"if application id "{id}" is running then
set sep to character id 31
set out to ""
tell application id "{id}"
repeat with w in windows
try
set out to out & ((id of w) as text) & sep & (URL of {tab} of w) & linefeed
end try
end repeat
end tell
return out & "ok"
end if"#,
        id = b.bundle_id,
        tab = tab_ref(b.dialect)
    )
}

/// `on run argv`: window id, the URL that was read, the block URL. The tab
/// changes only if its URL still equals the one read — the user may have
/// moved on since — and a browser that quit meanwhile is not launched.
pub fn write_script(b: &Browser) -> String {
    format!(
        r#"on run argv
set wid to (item 1 of argv) as integer
set seen to item 2 of argv
set target to item 3 of argv
if application id "{id}" is running then
tell application id "{id}"
set w to window id wid
considering case
if (URL of {tab} of w) is equal to seen then
set URL of {tab} of w to target
end if
end considering
end tell
end if
end run"#,
        id = b.bundle_id,
        tab = tab_ref(b.dialect)
    )
}

/// The read's output → `(window id, url)` pairs. A malformed line is skipped.
pub fn parse_tabs(stdout: &str) -> Vec<(i64, String)> {
    stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim_end_matches('\r');
            let (id, url) = line.split_once(SEP)?;
            Some((id.trim().parse().ok()?, url.to_string()))
        })
        .collect()
}

/// Whether `<app_file>` is in one of these folders. Checked before any
/// script that names a browser: compiling `tell application id "X"` without it
/// opens a "Where is X?" dialog (the Spotify rule).
pub fn installed(folders: &[PathBuf], app_file: &str) -> bool {
    folders.iter().any(|f| f.join(app_file).exists())
}

fn app_folders() -> Vec<PathBuf> {
    let mut folders = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        folders.push(Path::new(&home).join("Applications"));
    }
    folders
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
    /// Installed and not read yet.
    Unknown,
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
            Status::Unknown => "unknown",
        }
    }

    /// Tried again after 30 s, not 2 s.
    fn backs_off(self) -> bool {
        matches!(self, Status::Denied | Status::Timeout | Status::Error)
    }
}

/// A failed `osascript` run, from its stderr. `-1743`: Automation not
/// allowed. `-600`: the browser is not running.
pub fn classify(stderr: &str) -> Status {
    if stderr.contains("-1743") {
        Status::Denied
    } else if stderr.contains("-600") {
        Status::NotRunning
    } else {
        Status::Error
    }
}

/// What the web view reads, written by hand like the pomodoro snapshot. No
/// URL, ever.
pub fn state_json(enabled: bool, active: bool, statuses: &[Status; 4]) -> String {
    let browsers: Vec<String> = BROWSERS
        .iter()
        .zip(statuses)
        .map(|(b, s)| format!("{{\"name\":{},\"status\":\"{}\"}}", json_string(b.name), s.name()))
        .collect();
    format!(
        "{{\"enabled\":{enabled},\"active\":{active},\"browsers\":[{}]}}",
        browsers.join(",")
    )
}

// ---------------------------------------------------------------------------
// One pass (pure apart from the injected runner)
// ---------------------------------------------------------------------------

/// Runs one script with its arguments. Injected, so tests count the calls.
pub type ScriptRun<'a> = dyn FnMut(&str, &[String]) -> Run + 'a;

/// Per-browser bookkeeping the thread keeps between passes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Track {
    pub statuses: [Status; 4],
    /// Epoch ms before which a browser is not read (not running: 10 s;
    /// backed off: 30 s).
    pub retry_at: [u64; 4],
}

impl Default for Track {
    fn default() -> Self {
        Track {
            statuses: [Status::Unknown; 4],
            retry_at: [0; 4],
        }
    }
}

/// Read one browser and record its status. The tabs it holds, when it
/// answered.
fn read_one(b: &Browser, i: usize, now: u64, track: &mut Track, run: &mut ScriptRun) -> Vec<(i64, String)> {
    let (status, tabs) = match run(&read_script(b), &[]) {
        Run::Ok(out) if out.trim().is_empty() => (Status::NotRunning, Vec::new()),
        Run::Ok(out) => (Status::Ok, parse_tabs(&out)),
        Run::Failed(err) => (classify(&err), Vec::new()),
        Run::Timeout => (Status::Timeout, Vec::new()),
    };
    track.statuses[i] = status;
    track.retry_at[i] = match status {
        s if s.backs_off() => now + RETRY_MS,
        Status::NotRunning => now + NOT_RUNNING_MS,
        _ => 0,
    };
    tabs
}

/// Bring each browser's installed / not-installed status up to date.
fn refresh_installed(installed: [bool; 4], track: &mut Track) {
    for (i, &is) in installed.iter().enumerate() {
        if !is {
            track.statuses[i] = Status::NotInstalled;
        } else if track.statuses[i] == Status::NotInstalled {
            track.statuses[i] = Status::Unknown;
        }
    }
}

/// One pass of the watcher at `now`. Answers how long to wait before the
/// next: `None` = until something changes.
pub fn pass(
    config: &Config,
    focus_on: bool,
    now: u64,
    installed: [bool; 4],
    track: &mut Track,
    run: &mut ScriptRun,
) -> Option<Duration> {
    refresh_installed(installed, track);
    if !anything_active(config, focus_on, now) {
        return next_start(config, now)
            .map(|s| Duration::from_millis(s - now).min(IDLE_CAP));
    }
    for (i, b) in BROWSERS.iter().enumerate() {
        if !installed[i] || now < track.retry_at[i] {
            continue;
        }
        for (wid, url) in read_one(b, i, now, track, run) {
            if let Some(reason) = verdict(config, focus_on, now, &url) {
                let args = [wid.to_string(), url, reason.url()];
                if let Run::Failed(err) = run(&write_script(b), &args) {
                    let status = classify(&err);
                    if status == Status::Denied {
                        track.statuses[i] = status;
                        track.retry_at[i] = now + RETRY_MS;
                    }
                }
            }
        }
    }
    Some(ACTIVE_WAIT)
}

/// `blocker_check`: one read of every installed browser now, no writes.
pub fn check(now: u64, installed: [bool; 4], track: &mut Track, run: &mut ScriptRun) {
    refresh_installed(installed, track);
    for (i, b) in BROWSERS.iter().enumerate() {
        if installed[i] {
            read_one(b, i, now, track, run);
        }
    }
}

// ---------------------------------------------------------------------------
// The thread and the commands
// ---------------------------------------------------------------------------

struct Shared {
    config: Config,
    focus_on: bool,
    generation: u64,
    track: Track,
    json: String,
}

/// Managed by Tauri. Its lock is a leaf (see the file header).
pub struct Blocker {
    inner: Mutex<Shared>,
    wake: Condvar,
}

impl Default for Blocker {
    fn default() -> Self {
        let track = Track::default();
        Blocker {
            inner: Mutex::new(Shared {
                config: Config::default(),
                focus_on: false,
                generation: 0,
                json: state_json(false, false, &track.statuses),
                track,
            }),
            wake: Condvar::new(),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn installed_now() -> [bool; 4] {
    let folders = app_folders();
    BROWSERS.map(|b| installed(&folders, b.app_file))
}

fn osascript(script: &str, args: &[String]) -> Run {
    let mut argv: Vec<&str> = vec!["-e", script];
    argv.extend(args.iter().map(String::as_str));
    run_with_timeout(OSASCRIPT, &argv, TIMEOUT)
}

impl Blocker {
    fn lock(&self) -> MutexGuard<'_, Shared> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn bump(&self, f: impl FnOnce(&mut Shared) -> bool) {
        let changed = {
            let mut g = self.lock();
            let changed = f(&mut g);
            if changed {
                g.generation += 1;
            }
            changed
        };
        if changed {
            self.wake.notify_all();
        }
    }

    /// The pomodoro's focus edge (D15). Called after the pomodoro lock is
    /// released.
    pub fn set_focus(&self, on: bool) {
        self.bump(|g| {
            let changed = g.focus_on != on;
            g.focus_on = on;
            changed
        });
    }

    fn set_config(&self, config: Config) {
        self.bump(|g| {
            let changed = g.config != config;
            g.config = config;
            changed
        });
    }

    fn json(&self) -> String {
        self.lock().json.clone()
    }
}

/// The watcher. Each pass reads the wall clock.
pub fn spawn_loop(app: AppHandle) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("blocker".into())
        .spawn(move || {
            let blocker = app.state::<Blocker>();
            let mut emitted = String::new();
            loop {
                let (config, focus_on, generation, mut track) = {
                    let g = blocker.lock();
                    (g.config.clone(), g.focus_on, g.generation, g.track)
                };
                let now = now_ms();
                let wait = pass(&config, focus_on, now, installed_now(), &mut track, &mut osascript);
                let json = state_json(
                    config.enabled,
                    anything_active(&config, focus_on, now),
                    &track.statuses,
                );
                {
                    let mut g = blocker.lock();
                    g.track = track;
                    g.json = json.clone();
                }
                if json != emitted {
                    let _ = app.emit_str("blocker", json.clone());
                    emitted = json;
                }

                let g = blocker.lock();
                if g.generation != generation {
                    continue; // a change landed during the pass
                }
                match wait {
                    Some(d) => drop(blocker.wake.wait_timeout(g, d)),
                    None => drop(blocker.wake.wait_while(g, |s| s.generation == generation)),
                }
            }
        })
        .map(|_| ())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn blocker_configure(
    app: AppHandle,
    enabled: bool,
    names: Vec<String>,
    domains: Vec<Vec<String>>,
    focus: Vec<bool>,
    starts: Vec<Vec<u64>>,
    ends: Vec<Vec<u64>>,
) -> Result<Response, String> {
    let config = validate(enabled, names, domains, focus, starts, ends, now_ms())?;
    let blocker = app.state::<Blocker>();
    blocker.set_config(config);
    Ok(Response::new(blocker.json()))
}

#[tauri::command]
pub fn blocker_state(app: AppHandle) -> Response {
    Response::new(app.state::<Blocker>().json())
}

/// One read of every installed, running browser now — so the Automation
/// prompt can be met on purpose — then the state JSON. Off the main thread.
#[tauri::command]
pub async fn blocker_check(app: AppHandle) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let blocker = app.state::<Blocker>();
        let (config, focus_on, mut track) = {
            let g = blocker.lock();
            (g.config.clone(), g.focus_on, g.track)
        };
        let now = now_ms();
        check(now, installed_now(), &mut track, &mut osascript);
        let json = state_json(config.enabled, anything_active(&config, focus_on, now), &track.statuses);
        {
            let mut g = blocker.lock();
            g.track = track;
            g.json = json.clone();
        }
        Response::new(json)
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000_000;
    const MIN: u64 = 60_000;

    fn group(domains: &[&str], focus: bool, windows: &[(u64, u64)]) -> Group {
        Group {
            name: "G".into(),
            domains: domains.iter().map(|d| d.to_string()).collect(),
            focus,
            windows: windows.to_vec(),
        }
    }

    fn cfg(groups: Vec<Group>) -> Config {
        Config {
            enabled: true,
            groups,
        }
    }

    // ---- valid_domain ----

    #[test]
    fn valid_domain_accepts_plain_domains() {
        assert!(valid_domain("x.com"));
        assert!(valid_domain("news.ycombinator.com"));
        assert!(valid_domain("my-site.co.uk"));
    }

    #[test]
    fn valid_domain_rejects_everything_else() {
        for bad in [
            "",
            "localhost",
            "X.com",
            "https://x.com",
            "x.com/path",
            "x .com",
            "x\".com",
            "x..com",
            ".x.com",
            "x.com.",
            "-x.com",
            "x.com-",
        ] {
            assert!(!valid_domain(bad), "{bad:?}");
        }
        let long = format!("{}.com", "a".repeat(250));
        assert_eq!(long.len(), 254);
        assert!(!valid_domain(&long));
        assert!(valid_domain(&long[1..]));
    }

    // ---- host_of ----

    #[test]
    fn host_of_reads_http_and_https_hosts() {
        assert_eq!(host_of("https://x.com/a?b#c").as_deref(), Some("x.com"));
        assert_eq!(host_of("http://www.x.com/").as_deref(), Some("www.x.com"));
        assert_eq!(host_of("https://x.com:8443/a").as_deref(), Some("x.com"));
        assert_eq!(host_of("https://user:pw@x.com/").as_deref(), Some("x.com"));
        assert_eq!(host_of("HTTPS://X.COM/A").as_deref(), Some("x.com"));
        assert_eq!(host_of("https://x.com./").as_deref(), Some("x.com"));
    }

    #[test]
    fn host_of_has_none_for_other_schemes() {
        assert_eq!(host_of("chrome://settings"), None);
        assert_eq!(host_of("file:///Users/x/a.html"), None);
        assert_eq!(host_of("about:blank"), None);
        assert_eq!(host_of(""), None);
    }

    // ---- matches ----

    #[test]
    fn matches_the_domain_and_its_subdomains_only() {
        assert!(matches("x.com", "x.com"));
        assert!(matches("mobile.x.com", "x.com"));
        assert!(!matches("notx.com", "x.com"));
        assert!(!matches("x.com.evil.org", "x.com"));
    }

    // ---- verdict ----

    #[test]
    fn verdict_none_when_disabled() {
        let mut c = cfg(vec![group(&["x.com"], true, &[(NOW - MIN, NOW + MIN)])]);
        c.enabled = false;
        assert_eq!(verdict(&c, true, NOW, "https://x.com/"), None);
    }

    #[test]
    fn verdict_focus_only() {
        let c = cfg(vec![group(&["x.com"], true, &[])]);
        assert_eq!(verdict(&c, true, NOW, "https://x.com/"), Some(Reason::Focus));
        assert_eq!(verdict(&c, false, NOW, "https://x.com/"), None);
        assert_eq!(verdict(&c, true, NOW, "https://y.com/"), None);
    }

    #[test]
    fn verdict_schedule_from_start_to_just_before_end() {
        let (s, e) = (NOW, NOW + 10 * MIN);
        let c = cfg(vec![group(&["x.com"], false, &[(s, e)])]);
        assert_eq!(verdict(&c, false, s, "https://x.com/"), Some(Reason::Schedule));
        assert_eq!(verdict(&c, false, e - 1, "https://x.com/"), Some(Reason::Schedule));
        assert_eq!(verdict(&c, false, e, "https://x.com/"), None);
        assert_eq!(verdict(&c, false, s - 1, "https://x.com/"), None);
        // Focus does not trigger a schedule-only group.
        assert_eq!(verdict(&c, true, e, "https://x.com/"), None);
    }

    #[test]
    fn verdict_focus_beats_schedule() {
        let w = [(NOW - MIN, NOW + MIN)];
        // One group with both, and two groups, one each.
        let both = cfg(vec![group(&["x.com"], true, &w)]);
        assert_eq!(verdict(&both, true, NOW, "https://x.com/"), Some(Reason::Focus));
        let two = cfg(vec![group(&["x.com"], false, &w), group(&["x.com"], true, &[])]);
        assert_eq!(verdict(&two, true, NOW, "https://x.com/"), Some(Reason::Focus));
        assert_eq!(verdict(&two, false, NOW, "https://x.com/"), Some(Reason::Schedule));
    }

    #[test]
    fn verdict_paused_focus_still_blocks() {
        use crate::pomodoro::{focus_edge, pause, start, State};
        let t = |ms: u64| UNIX_EPOCH + Duration::from_millis(NOW + ms);
        let idle = State::default();
        let focus = start(&idle, None, t(0)).unwrap();
        let paused = pause(&focus, t(MIN)).unwrap();
        let mut on = false;
        for (a, b) in [(&idle, &focus), (&focus, &paused)] {
            if let Some(v) = focus_edge(a, b) {
                on = v;
            }
        }
        assert!(on);
        let c = cfg(vec![group(&["x.com"], true, &[])]);
        assert_eq!(verdict(&c, on, NOW, "https://x.com/"), Some(Reason::Focus));
    }

    #[test]
    fn verdict_exempts_the_dashboard_and_the_blocked_page() {
        let c = cfg(vec![group(&["github.io", "smrios07mdb.github.io"], true, &[])]);
        assert_eq!(verdict(&c, true, NOW, "https://smrios07mdb.github.io/dashboard/"), None);
        assert_eq!(verdict(&c, true, NOW, &Reason::Focus.url()), None);
        assert_eq!(
            verdict(&c, true, NOW, "https://smrios07mdb.github.io/other/"),
            Some(Reason::Focus)
        );
    }

    // ---- anything_active / next_start ----

    #[test]
    fn nothing_active_without_groups() {
        let c = cfg(vec![]);
        assert!(!anything_active(&c, true, NOW));
        assert_eq!(next_start(&c, NOW), None);
    }

    #[test]
    fn a_future_window_is_not_active_and_is_next() {
        let c = cfg(vec![group(&["x.com"], false, &[(NOW + 5 * MIN, NOW + 9 * MIN)])]);
        assert!(!anything_active(&c, false, NOW));
        assert_eq!(next_start(&c, NOW), Some(NOW + 5 * MIN));
    }

    #[test]
    fn inside_a_window_is_active() {
        let c = cfg(vec![group(&["x.com"], false, &[(NOW - MIN, NOW + MIN)])]);
        assert!(anything_active(&c, false, NOW));
        // A group without domains blocks nothing.
        let empty = cfg(vec![group(&[], true, &[(NOW - MIN, NOW + MIN)])]);
        assert!(!anything_active(&empty, true, NOW));
        let mut off = c.clone();
        off.enabled = false;
        assert!(!anything_active(&off, true, NOW));
    }

    #[test]
    fn next_start_is_the_earliest_over_two_groups() {
        let c = cfg(vec![
            group(&["x.com"], false, &[(NOW + 9 * MIN, NOW + 10 * MIN)]),
            group(&["y.com"], false, &[(NOW - MIN, NOW + MIN), (NOW + 3 * MIN, NOW + 4 * MIN)]),
        ]);
        assert!(anything_active(&c, false, NOW));
        assert_eq!(next_start(&c, NOW), Some(NOW + 3 * MIN));
        assert!(!anything_active(&c, false, NOW + 2 * MIN));
    }

    // ---- parse_tabs ----

    #[test]
    fn parse_tabs_reads_one_line_per_window() {
        let out = "12\u{1f}https://x.com/a b\n\n7\u{1f}https://y.com/\nno separator\nok\n";
        assert_eq!(
            parse_tabs(out),
            vec![(12, "https://x.com/a b".to_string()), (7, "https://y.com/".to_string())]
        );
    }

    // ---- scripts ----

    #[test]
    fn read_script_golden_chrome() {
        assert_eq!(
            read_script(&BROWSERS[0]),
            "if application id \"com.google.Chrome\" is running then\n\
set sep to character id 31\n\
set out to \"\"\n\
tell application id \"com.google.Chrome\"\n\
repeat with w in windows\n\
try\n\
set out to out & ((id of w) as text) & sep & (URL of active tab of w) & linefeed\n\
end try\n\
end repeat\n\
end tell\n\
return out & \"ok\"\n\
end if"
        );
    }

    #[test]
    fn read_script_golden_safari() {
        let s = read_script(&BROWSERS[1]);
        assert!(s.starts_with("if application id \"com.apple.Safari\" is running then\n"));
        assert!(s.contains("tell application id \"com.apple.Safari\"\n"));
        assert!(s.contains("(URL of current tab of w)"));
        assert!(!s.contains("active tab"));
    }

    // Chunk 99 gate: by name, `application "Microsoft Edge"` resolved to
    // Microsoft Teams' WebView helper on a Mac with Teams. By bundle id, never.
    #[test]
    fn read_script_golden_edge() {
        let s = read_script(&BROWSERS[3]);
        assert!(s.starts_with("if application id \"com.microsoft.edgemac\" is running then\n"));
        assert!(s.contains("tell application id \"com.microsoft.edgemac\"\n"));
        assert!(s.contains("(URL of active tab of w)"));
        assert!(!s.contains("Microsoft Edge"));
        let w = write_script(&BROWSERS[3]);
        assert!(w.contains("if application id \"com.microsoft.edgemac\" is running then\n"));
        assert!(w.contains("tell application id \"com.microsoft.edgemac\"\n"));
        assert!(!w.contains("Microsoft Edge"));
    }

    #[test]
    fn browsers_carry_their_bundle_ids() {
        let ids: Vec<&str> = BROWSERS.iter().map(|b| b.bundle_id).collect();
        assert_eq!(ids, ["com.google.Chrome", "com.apple.Safari", "com.brave.Browser", "com.microsoft.edgemac"]);
        // The name is for display only: no script holds it.
        for b in &BROWSERS {
            assert!(!read_script(b).contains(&format!("\"{}\"", b.name)));
            assert!(!write_script(b).contains(&format!("\"{}\"", b.name)));
        }
    }

    #[test]
    fn write_script_golden_chrome_and_safari() {
        assert_eq!(
            write_script(&BROWSERS[0]),
            "on run argv\n\
set wid to (item 1 of argv) as integer\n\
set seen to item 2 of argv\n\
set target to item 3 of argv\n\
if application id \"com.google.Chrome\" is running then\n\
tell application id \"com.google.Chrome\"\n\
set w to window id wid\n\
considering case\n\
if (URL of active tab of w) is equal to seen then\n\
set URL of active tab of w to target\n\
end if\n\
end considering\n\
end tell\n\
end if\n\
end run"
        );
        let safari = write_script(&BROWSERS[1]);
        assert!(safari.contains("tell application id \"com.apple.Safari\"\n"));
        assert!(safari.contains("if (URL of current tab of w) is equal to seen then\n"));
        assert!(safari.contains("set URL of current tab of w to target\n"));
    }

    #[test]
    fn no_script_holds_a_url_or_a_domain() {
        for b in &BROWSERS {
            for s in [read_script(b), write_script(b)] {
                assert!(!s.contains("://"), "{s}");
                assert!(!s.contains("github"), "{s}");
                assert!(!s.contains(".com"), "{s}");
            }
        }
    }

    // ---- installed ----

    #[test]
    fn installed_looks_in_each_folder() {
        let dir = std::env::temp_dir().join(format!("blocker-test-{}", std::process::id()));
        let apps = dir.join("Applications");
        std::fs::create_dir_all(apps.join("Safari.app")).unwrap();
        let folders = vec![dir.join("nowhere"), apps];
        assert!(installed(&folders, "Safari.app"));
        assert!(!installed(&folders, "Google Chrome.app"));
        let _ = std::fs::remove_dir_all(dir);
    }

    // ---- validate (blocker_configure) ----

    fn ok_args() -> (Vec<String>, Vec<Vec<String>>, Vec<bool>, Vec<Vec<u64>>, Vec<Vec<u64>>) {
        (
            vec!["Social".into()],
            vec![vec!["x.com".into()]],
            vec![true],
            vec![vec![NOW]],
            vec![vec![NOW + MIN]],
        )
    }

    fn run_validate(
        a: (Vec<String>, Vec<Vec<String>>, Vec<bool>, Vec<Vec<u64>>, Vec<Vec<u64>>),
    ) -> Result<Config, String> {
        validate(true, a.0, a.1, a.2, a.3, a.4, NOW)
    }

    #[test]
    fn validate_accepts_a_good_set() {
        let c = run_validate(ok_args()).unwrap();
        assert_eq!(c.groups.len(), 1);
        assert_eq!(c.groups[0].windows, vec![(NOW, NOW + MIN)]);
        assert!(validate(false, vec![], vec![], vec![], vec![], vec![], NOW).is_ok());
    }

    #[test]
    fn validate_rejects_lists_of_different_lengths() {
        let mut a = ok_args();
        a.2.push(false);
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_more_than_20_groups() {
        let n = 21;
        let a = (
            vec!["G".to_string(); n],
            vec![vec!["x.com".to_string()]; n],
            vec![true; n],
            vec![vec![]; n],
            vec![vec![]; n],
        );
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_a_bad_name() {
        let mut a = ok_args();
        a.0[0] = "  ".into();
        assert!(run_validate(a).is_err());
        let mut a = ok_args();
        a.0[0] = "n".repeat(41);
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_more_than_50_domains() {
        let mut a = ok_args();
        a.1[0] = (0..51).map(|i| format!("s{i}.com")).collect();
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_an_invalid_domain() {
        let mut a = ok_args();
        a.1[0] = vec!["https://x.com".into()];
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_more_than_60_windows() {
        let mut a = ok_args();
        a.3[0] = (0..61).map(|i| NOW + i * MIN).collect();
        a.4[0] = (0..61).map(|i| NOW + i * MIN + 1).collect();
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_starts_and_ends_of_different_lengths() {
        let mut a = ok_args();
        a.4[0].push(NOW + 2 * MIN);
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_a_window_not_starting_before_its_end() {
        let mut a = ok_args();
        a.4[0] = vec![NOW];
        assert!(run_validate(a).is_err());
    }

    #[test]
    fn validate_rejects_a_window_out_of_range() {
        let mut a = ok_args();
        a.3[0] = vec![NOW - 2 * DAY_MS - 1];
        assert!(run_validate(a).is_err());
        let mut a = ok_args();
        a.4[0] = vec![NOW + 16 * DAY_MS + 1];
        assert!(run_validate(a).is_err());
    }

    // ---- state_json ----

    #[test]
    fn state_json_golden() {
        let s = [Status::Ok, Status::Denied, Status::NotInstalled, Status::Unknown];
        assert_eq!(
            state_json(true, false, &s),
            "{\"enabled\":true,\"active\":false,\"browsers\":[\
{\"name\":\"Google Chrome\",\"status\":\"ok\"},\
{\"name\":\"Safari\",\"status\":\"denied\"},\
{\"name\":\"Brave Browser\",\"status\":\"not_installed\"},\
{\"name\":\"Microsoft Edge\",\"status\":\"unknown\"}]}"
        );
        let t = [Status::NotRunning, Status::Timeout, Status::Error, Status::Ok];
        assert!(state_json(false, true, &t).contains("\"not_running\"") );
        assert!(state_json(false, true, &t).contains("\"timeout\""));
        assert!(state_json(false, true, &t).contains("\"error\""));
    }

    // ---- the pass (injected runner and clock) ----

    type Calls = Vec<(String, Vec<String>)>;

    fn runner<'a>(calls: &'a mut Calls, reply: impl Fn(&str) -> Run + 'a) -> impl FnMut(&str, &[String]) -> Run + 'a {
        move |script, args| {
            calls.push((script.to_string(), args.to_vec()));
            reply(script)
        }
    }

    const CHROME_ONLY: [bool; 4] = [true, false, false, false];
    const CHROME_SAFARI: [bool; 4] = [true, true, false, false];

    #[test]
    fn no_runner_call_while_nothing_is_active() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let c = cfg(vec![group(&["x.com"], true, &[(NOW + 10 * MIN, NOW + 20 * MIN)])]);
        let wait = pass(&c, false, NOW, CHROME_SAFARI, &mut track, &mut runner(&mut calls, |_| Run::Ok("ok".into())));
        assert!(calls.is_empty());
        assert_eq!(wait, Some(IDLE_CAP));
        // Close to the start, it wakes right at it.
        let wait = pass(&c, false, NOW + 10 * MIN - 5_000, CHROME_SAFARI, &mut track, &mut runner(&mut calls, |_| Run::Ok("ok".into())));
        assert_eq!(wait, Some(Duration::from_secs(5)));
        // No window at all: wait for a change.
        let none = cfg(vec![group(&["x.com"], true, &[])]);
        assert_eq!(pass(&none, false, NOW, CHROME_SAFARI, &mut track, &mut runner(&mut calls, |_| Run::Ok("ok".into()))), None);
        assert!(calls.is_empty());
        assert_eq!(track.statuses[2], Status::NotInstalled);
        assert_eq!(track.statuses[0], Status::Unknown);
    }

    #[test]
    fn one_read_per_installed_browser_per_pass() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let c = cfg(vec![group(&["x.com"], true, &[])]);
        let wait = pass(&c, true, NOW, CHROME_SAFARI, &mut track, &mut runner(&mut calls, |_| Run::Ok("ok\n".into())));
        assert_eq!(wait, Some(ACTIVE_WAIT));
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, read_script(&BROWSERS[0]));
        assert_eq!(calls[1].0, read_script(&BROWSERS[1]));
        assert!(calls.iter().all(|(_, a)| a.is_empty()));
        assert_eq!(track.statuses, [Status::Ok, Status::Ok, Status::NotInstalled, Status::NotInstalled]);
    }

    #[test]
    fn a_write_only_for_a_matching_tab_with_three_arguments_in_order() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let c = cfg(vec![group(&["x.com"], true, &[])]);
        let out = "1\u{1f}https://y.com/\n2\u{1f}https://mobile.x.com/feed\n3\u{1f}https://notx.com/\nok\n".to_string();
        pass(&c, true, NOW, CHROME_ONLY, &mut track, &mut runner(&mut calls, move |s| {
            if s.starts_with("on run") { Run::Ok(String::new()) } else { Run::Ok(out.clone()) }
        }));
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].0, write_script(&BROWSERS[0]));
        assert_eq!(
            calls[1].1,
            vec![
                "2".to_string(),
                "https://mobile.x.com/feed".to_string(),
                format!("{BLOCKED_PAGE}#focus"),
            ]
        );
    }

    #[test]
    fn a_scheduled_block_carries_the_schedule_fragment() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let c = cfg(vec![group(&["x.com"], false, &[(NOW - MIN, NOW + MIN)])]);
        pass(&c, false, NOW, CHROME_ONLY, &mut track, &mut runner(&mut calls, |s| {
            if s.starts_with("on run") { Run::Ok(String::new()) } else { Run::Ok("9\u{1f}https://x.com/\nok".into()) }
        }));
        assert_eq!(calls[1].1[2], format!("{BLOCKED_PAGE}#schedule"));
    }

    #[test]
    fn denied_backs_off_to_30_s() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let c = cfg(vec![group(&["x.com"], true, &[])]);
        let denied = |_: &str| Run::Failed("execution error: Not authorized to send Apple events to Google Chrome. (-1743)".into());
        pass(&c, true, NOW, CHROME_ONLY, &mut track, &mut runner(&mut calls, denied));
        assert_eq!(track.statuses[0], Status::Denied);
        assert_eq!(calls.len(), 1);
        // 2 s and 29 s later: not tried.
        pass(&c, true, NOW + 2_000, CHROME_ONLY, &mut track, &mut runner(&mut calls, denied));
        pass(&c, true, NOW + 29_999, CHROME_ONLY, &mut track, &mut runner(&mut calls, denied));
        assert_eq!(calls.len(), 1);
        // 30 s later: tried again.
        pass(&c, true, NOW + 30_000, CHROME_ONLY, &mut track, &mut runner(&mut calls, denied));
        assert_eq!(calls.len(), 2);
    }

    #[test]
    fn retry_cadence_per_status() {
        // ok: next pass (2 s). not running: 10 s. timeout / error: 30 s.
        let c = cfg(vec![group(&["x.com"], true, &[])]);
        for (reply, status, retry) in [
            (Run::Ok("ok\n".into()), Status::Ok, 0),
            (Run::Timeout, Status::Timeout, NOW + 30_000),
            (Run::Failed("boom".into()), Status::Error, NOW + 30_000),
            (Run::Failed("Application isn't running. (-600)".into()), Status::NotRunning, NOW + 10_000),
            (Run::Ok("\n".into()), Status::NotRunning, NOW + 10_000),
        ] {
            let mut calls = Calls::new();
            let mut track = Track::default();
            let r = reply.clone();
            pass(&c, true, NOW, CHROME_ONLY, &mut track, &mut runner(&mut calls, move |_| r.clone()));
            assert_eq!(track.statuses[0], status);
            assert_eq!(track.retry_at[0], retry, "{status:?}");
        }
    }

    #[test]
    fn not_running_is_tried_again_after_10_s() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let c = cfg(vec![group(&["x.com"], true, &[])]);
        let closed = |_: &str| Run::Ok(String::new());
        pass(&c, true, NOW, CHROME_ONLY, &mut track, &mut runner(&mut calls, closed));
        assert_eq!(track.statuses[0], Status::NotRunning);
        assert_eq!(calls.len(), 1);
        // 2 s and 9.999 s later: not tried.
        pass(&c, true, NOW + 2_000, CHROME_ONLY, &mut track, &mut runner(&mut calls, closed));
        pass(&c, true, NOW + 9_999, CHROME_ONLY, &mut track, &mut runner(&mut calls, closed));
        assert_eq!(calls.len(), 1);
        // 10 s later: tried again.
        pass(&c, true, NOW + 10_000, CHROME_ONLY, &mut track, &mut runner(&mut calls, closed));
        assert_eq!(calls.len(), 2);
        // A running browser is read on every pass.
        let mut calls = Calls::new();
        let mut track = Track::default();
        pass(&c, true, NOW, CHROME_ONLY, &mut track, &mut runner(&mut calls, |_| Run::Ok("ok\n".into())));
        pass(&c, true, NOW + 2_000, CHROME_ONLY, &mut track, &mut runner(&mut calls, |_| Run::Ok("ok\n".into())));
        assert_eq!(calls.len(), 2);
    }

    #[test]
    fn classify_maps_the_two_codes() {
        assert_eq!(classify("... (-1743)"), Status::Denied);
        assert_eq!(classify("... (-600)"), Status::NotRunning);
        assert_eq!(classify("syntax error"), Status::Error);
    }

    #[test]
    fn check_reads_every_installed_browser_and_writes_nothing() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        track.retry_at[0] = NOW + RETRY_MS;
        check(NOW, CHROME_SAFARI, &mut track, &mut runner(&mut calls, |_| Run::Ok("1\u{1f}https://x.com/\nok".into())));
        assert_eq!(calls.len(), 2);
        assert!(calls.iter().all(|(s, _)| !s.starts_with("on run")));
        assert_eq!(track.statuses[0], Status::Ok);
        assert_eq!(track.retry_at[0], 0);
    }
}
