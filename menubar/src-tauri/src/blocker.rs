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
//! A daily allowance (chunk 100) is the third trigger. A group can carry
//! "N minutes a day": time counts for it while one of its sites is the
//! active tab of the front window of a browser that is itself the frontmost
//! app, and once the count reaches the allowance the group's sites are
//! blocked until the next local midnight (`#limit`). While nothing blocks
//! but some allowance is still open, the thread reads on a 5 s cadence, only
//! to count. The count lives in `allowance.rs` and in `usage.tsv`, which
//! holds group ids and milliseconds, never a URL.
//!
//! The `Blocker` lock is a leaf: never taken under the pomodoro, meditation
//! or sessions lock, and never held across an `osascript` run, an emit, a
//! file write or `show_passive`.
//!
//! Top half: pure pieces, unit-tested. Bottom half: the thread and the Tauri
//! commands.

use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager};

use crate::allowance::{self, day_start, exhausted, minute_changed, valid_id, warn_now, Usage};
use crate::pomodoro::json_string;
use crate::sound::{run_with_timeout, Run, TIMEOUT};

const OSASCRIPT: &str = "/usr/bin/osascript";
/// The dashboard's own pages, the blocked page among them, are never blocked.
pub const EXEMPT_PREFIX: &str = "https://smrios07mdb.github.io/dashboard/";
pub const BLOCKED_PAGE: &str = "https://smrios07mdb.github.io/dashboard/blocked.html";
/// Joins a window id and its URL in the read's output (ASCII unit separator).
const SEP: char = '\u{1f}';

pub const ACTIVE_WAIT: Duration = Duration::from_secs(2);
/// Nothing blocks, but an allowance is still open: read only to count.
pub const TRACK_WAIT: Duration = Duration::from_secs(5);
/// How long the five-minute warning stays up when nobody clicks into it.
pub const WARNING_SHOWN_MS: u64 = 10_000;
pub const RETRY_MS: u64 = 30_000;
/// A browser that answered "not running" is read again after this, not on
/// every pass: a browser opened during a block is caught within 10 s.
pub const NOT_RUNNING_MS: u64 = 10_000;
pub const IDLE_CAP: Duration = Duration::from_secs(30);

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
pub const MAX_GROUPS: usize = 20;
pub const MAX_DOMAINS: usize = 50;
pub const MAX_WINDOWS: usize = 60;
pub const MAX_LIMIT_MIN: u64 = 1440;
pub const MAX_MIDNIGHTS: usize = 20;
const MINUTE_MS: u64 = 60_000;

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
    /// The row's id: what the day's count is kept under.
    pub id: String,
    pub name: String,
    pub domains: Vec<String>,
    /// Block during a focus phase.
    pub focus: bool,
    /// Scheduled windows, epoch ms, `start < end`.
    pub windows: Vec<(u64, u64)>,
    /// The daily allowance in ms; 0 = none.
    pub limit_ms: u64,
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Config {
    pub enabled: bool,
    pub groups: Vec<Group>,
    /// The Mac's local midnights around now, ascending (the web view's).
    pub midnights: Vec<u64>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Reason {
    Focus,
    Schedule,
    /// Today's allowance is used up.
    Limit,
}

impl Reason {
    /// The blocked page, with this reason as its fragment.
    pub fn url(self) -> String {
        match self {
            Reason::Focus => format!("{BLOCKED_PAGE}#focus"),
            Reason::Schedule => format!("{BLOCKED_PAGE}#schedule"),
            Reason::Limit => format!("{BLOCKED_PAGE}#limit"),
        }
    }
}

fn in_window(g: &Group, now: u64) -> bool {
    g.windows.iter().any(|&(s, e)| s <= now && now < e)
}

fn used_up(g: &Group, usage: &Usage, day: u64) -> bool {
    exhausted(g.limit_ms, usage.used_ms(day, &g.id))
}

/// Why this URL must not be the active tab now, if it must not. `Focus`
/// beats `Schedule`, which beats `Limit` (D4): focus and schedule blocks
/// apply whether or not allowance is left.
pub fn verdict(
    config: &Config,
    focus_on: bool,
    now: u64,
    usage: &Usage,
    day: u64,
    url: &str,
) -> Option<Reason> {
    if !config.enabled || url.starts_with(EXEMPT_PREFIX) {
        return None;
    }
    let host = host_of(url)?;
    let mut scheduled = false;
    let mut limited = false;
    for g in &config.groups {
        if !g.domains.iter().any(|d| matches(&host, d)) {
            continue;
        }
        if focus_on && g.focus {
            return Some(Reason::Focus);
        }
        scheduled |= in_window(g, now);
        limited |= used_up(g, usage, day);
    }
    if scheduled {
        Some(Reason::Schedule)
    } else {
        limited.then_some(Reason::Limit)
    }
}

/// Whether any group blocks anything now: a focus phase, a scheduled window
/// or an allowance used up. Nothing active, nothing runs at 2 s.
pub fn anything_active(config: &Config, focus_on: bool, now: u64, usage: &Usage, day: u64) -> bool {
    config.enabled
        && config.groups.iter().any(|g| {
            !g.domains.is_empty()
                && ((focus_on && g.focus) || in_window(g, now) || used_up(g, usage, day))
        })
}

/// Whether there is anything to count: some group with sites has an
/// allowance not yet used up.
pub fn tracking(config: &Config, usage: &Usage, day: u64) -> bool {
    config.enabled
        && config
            .groups
            .iter()
            .any(|g| !g.domains.is_empty() && g.limit_ms > 0 && !used_up(g, usage, day))
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

/// `blocker_configure`'s arguments: parallel lists, one entry per group,
/// and the local midnights.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Lists {
    pub ids: Vec<String>,
    pub names: Vec<String>,
    pub domains: Vec<Vec<String>>,
    pub focus: Vec<bool>,
    pub starts: Vec<Vec<u64>>,
    pub ends: Vec<Vec<u64>>,
    /// Minutes a day; 0 = no allowance.
    pub limits: Vec<u64>,
    pub midnights: Vec<u64>,
}

/// D14 (chunk 99) and D13 (chunk 100): the web view's lists → a `Config`, or
/// the reason the whole set is rejected. Nothing is clamped.
pub fn validate(enabled: bool, lists: Lists, now: u64) -> Result<Config, String> {
    let Lists {
        ids,
        names,
        domains,
        focus,
        starts,
        ends,
        limits,
        midnights,
    } = lists;
    let n = names.len();
    if [
        ids.len(),
        domains.len(),
        focus.len(),
        starts.len(),
        ends.len(),
        limits.len(),
    ]
    .iter()
    .any(|&l| l != n)
    {
        return Err("lists differ in length".into());
    }
    if n > MAX_GROUPS {
        return Err("too many groups".into());
    }
    if !ids.iter().all(|id| valid_id(id)) {
        return Err("bad group id".into());
    }
    if ids.iter().enumerate().any(|(i, id)| ids[..i].contains(id)) {
        return Err("duplicate group id".into());
    }
    if limits.iter().any(|&m| m > MAX_LIMIT_MIN) {
        return Err("allowance out of range".into());
    }
    if midnights.is_empty() || midnights.len() > MAX_MIDNIGHTS {
        return Err("bad midnight count".into());
    }
    if !midnights.windows(2).all(|w| w[0] < w[1]) {
        return Err("midnights not ascending".into());
    }
    let lo = now.saturating_sub(2 * DAY_MS);
    if !midnights.iter().all(|&m| m >= lo && m <= now + 17 * DAY_MS) {
        return Err("midnight out of range".into());
    }
    let hi = now + 16 * DAY_MS;
    let mut groups = Vec::with_capacity(n);
    let rows = ids
        .into_iter()
        .zip(names)
        .zip(domains)
        .zip(focus)
        .zip(starts)
        .zip(ends)
        .zip(limits);
    for ((((((id, name), doms), f), s), e), limit) in rows {
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
            id,
            name,
            domains: doms,
            focus: f,
            windows,
            limit_ms: limit * MINUTE_MS,
        });
    }
    Ok(Config {
        enabled,
        groups,
        midnights,
    })
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

/// A first line `front` or `back` (chunk 100): whether the browser is the
/// frontmost app. It is `frontmost of application id`, an AppleScript
/// application property read **outside** the `tell` block, so it sends the
/// browser nothing. Then one line per window, front to back: `<window id>`
/// SEP `<url of its active tab>`; then a last line `ok` (it tells "running,
/// no windows" from "not running"). `parse_tabs` skips the first and the
/// last. `is running` sends no Apple Event: the read never launches a
/// browser, and prints nothing when it is not running. Each window sits in
/// its own `try`, so one odd window (a Safari settings window, an empty tab)
/// does not lose the others; it leaves a line with window id 0 and no URL,
/// so the first window line is always the front window.
pub fn read_script(b: &Browser) -> String {
    format!(
        r#"if application id "{id}" is running then
set sep to character id 31
if frontmost of application id "{id}" then
set out to "front" & linefeed
else
set out to "back" & linefeed
end if
tell application id "{id}"
repeat with w in windows
try
set out to out & ((id of w) as text) & sep & (URL of {tab} of w) & linefeed
on error
set out to out & "0" & sep & linefeed
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

/// The read's first line: whether the browser is the frontmost app. Anything
/// but `front` — `back`, or no such line — is not.
pub fn parse_front(stdout: &str) -> bool {
    stdout.lines().next().map(|l| l.trim_end_matches('\r')) == Some("front")
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

/// The five-minute warning (D5) for one group.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Warning {
    pub id: String,
    pub name: String,
    pub minutes_left: u64,
}

/// What the web view reads, written by hand like the pomodoro snapshot. No
/// URL, ever. `usage` lists the groups with an allowance, in whole minutes
/// rounded down — so this text, and the `blocker` event, change at most once
/// a minute per group.
pub fn state_json(
    config: &Config,
    active: bool,
    statuses: &[Status; 4],
    usage: &Usage,
    day: u64,
    warning: Option<&Warning>,
) -> String {
    let browsers: Vec<String> = BROWSERS
        .iter()
        .zip(statuses)
        .map(|(b, s)| format!("{{\"name\":{},\"status\":\"{}\"}}", json_string(b.name), s.name()))
        .collect();
    let used: Vec<String> = config
        .groups
        .iter()
        .filter(|g| g.limit_ms > 0)
        .map(|g| {
            let limit = g.limit_ms / MINUTE_MS;
            format!(
                "{{\"id\":{},\"usedMinutes\":{},\"limitMinutes\":{limit}}}",
                json_string(&g.id),
                (usage.used_ms(day, &g.id) / MINUTE_MS).min(limit)
            )
        })
        .collect();
    let warning = warning.map_or("null".to_string(), |w| {
        format!(
            "{{\"id\":{},\"name\":{},\"minutesLeft\":{}}}",
            json_string(&w.id),
            json_string(&w.name),
            w.minutes_left
        )
    });
    format!(
        "{{\"enabled\":{},\"active\":{active},\"browsers\":[{}],\"usage\":[{}],\"warning\":{warning}}}",
        config.enabled,
        browsers.join(","),
        used.join(",")
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

/// The allowance's bookkeeping between passes (chunk 100).
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Allowance {
    pub usage: Usage,
    /// The day the last pass saw; `None` before the first configuration.
    pub day: Option<u64>,
    /// When the previous pass read the browsers; `None` when it read
    /// nothing, so the first read after an idle stretch adds no time.
    pub last_pass: Option<u64>,
    /// The groups warned today (D5: one warning per group per day).
    pub warned: Vec<String>,
    pub warning: Option<Warning>,
}

/// What one pass asks of the thread.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Outcome {
    /// How long to wait before the next pass: `None` = until a change.
    pub wait: Option<Duration>,
    /// `usage.tsv` is due a rewrite.
    pub save: bool,
    /// A warning was just given: drop the panel.
    pub warned: bool,
}

/// Read one browser and record its status. Whether it is the frontmost app,
/// and the tabs it holds, front window first, when it answered.
fn read_one(
    b: &Browser,
    i: usize,
    now: u64,
    track: &mut Track,
    run: &mut ScriptRun,
) -> (bool, Vec<(i64, String)>) {
    let (status, front, tabs) = match run(&read_script(b), &[]) {
        Run::Ok(out) if out.trim().is_empty() => (Status::NotRunning, false, Vec::new()),
        Run::Ok(out) => (Status::Ok, parse_front(&out), parse_tabs(&out)),
        Run::Failed(err) => (classify(&err), false, Vec::new()),
        Run::Timeout => (Status::Timeout, false, Vec::new()),
    };
    track.statuses[i] = status;
    track.retry_at[i] = match status {
        s if s.backs_off() => now + RETRY_MS,
        Status::NotRunning => now + NOT_RUNNING_MS,
        _ => 0,
    };
    (front, tabs)
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

/// The day this pass belongs to. A new one drops the other days' counts and
/// the warnings given (D3). Before the first configuration there are no
/// midnights and nothing changes. The pass that sees the new day counts
/// nothing: the time since the previous pass lies across midnight.
fn roll_day(config: &Config, now: u64, allow: &mut Allowance, out: &mut Outcome) -> u64 {
    if config.midnights.is_empty() {
        return allow.day.unwrap_or(0);
    }
    let day = day_start(&config.midnights, now);
    if allow.day != Some(day) {
        out.save |= allow.usage.prune(day);
        allow.warned.clear();
        allow.warning = None;
        allow.day = Some(day);
        allow.last_pass = None;
    }
    day
}

/// D2: `elapsed` ms for every group with an open allowance that holds this
/// URL's host. Whether one of them just reached its limit.
fn count(config: &Config, day: u64, url: &str, elapsed: u64, allow: &mut Allowance, out: &mut Outcome) -> bool {
    if elapsed == 0 || url.starts_with(EXEMPT_PREFIX) {
        return false;
    }
    let Some(host) = host_of(url) else { return false };
    let mut reached = false;
    for g in &config.groups {
        if g.limit_ms == 0 || !g.domains.iter().any(|d| matches(&host, d)) {
            continue;
        }
        let before = allow.usage.used_ms(day, &g.id);
        if exhausted(g.limit_ms, before) {
            continue;
        }
        allow.usage.add(day, &g.id, elapsed);
        let after = before + elapsed;
        out.save |= minute_changed(before, after);
        if exhausted(g.limit_ms, after) {
            reached = true;
            out.save = true;
            if allow.warning.as_ref().is_some_and(|w| w.id == g.id) {
                allow.warning = None;
            }
        } else if warn_now(g.limit_ms, before, after) && !allow.warned.contains(&g.id) {
            allow.warned.push(g.id.clone());
            allow.warning = Some(Warning {
                id: g.id.clone(),
                name: g.name.clone(),
                minutes_left: (g.limit_ms - after).div_ceil(MINUTE_MS),
            });
            out.warned = true;
        }
    }
    reached
}

/// One pass of the watcher at `now`.
///
/// Something blocks: one read per installed browser and one write per
/// matching tab, every 2 s. Nothing blocks but an allowance is open: the
/// same reads every 5 s, to count. Neither: no script at all.
///
/// After a read, a tab that nothing blocks yet, in the front window of the
/// frontmost browser, adds the time since the previous pass (10 s at most)
/// to its groups; the verdict is then taken again, so the tab that spends
/// the last second is redirected in the same pass.
pub fn pass(
    config: &Config,
    focus_on: bool,
    now: u64,
    installed: [bool; 4],
    track: &mut Track,
    allow: &mut Allowance,
    run: &mut ScriptRun,
) -> Outcome {
    refresh_installed(installed, track);
    let mut out = Outcome::default();
    let day = roll_day(config, now, allow, &mut out);
    // A warning outlives neither its group, its allowance nor the limit.
    if let Some(w) = &allow.warning {
        let open = config.enabled
            && config
                .groups
                .iter()
                .any(|g| g.id == w.id && g.limit_ms > 0 && !used_up(g, &allow.usage, day));
        if !open {
            allow.warning = None;
        }
    }
    if !anything_active(config, focus_on, now, &allow.usage, day) && !tracking(config, &allow.usage, day) {
        allow.last_pass = None;
        out.wait = next_start(config, now).map(|s| Duration::from_millis(s - now).min(IDLE_CAP));
        return out;
    }
    let elapsed = allow
        .last_pass
        .map_or(0, |t| now.saturating_sub(t).min(allowance::MAX_STEP_MS));
    allow.last_pass = Some(now);
    for (i, b) in BROWSERS.iter().enumerate() {
        if !installed[i] || now < track.retry_at[i] {
            continue;
        }
        let (front, tabs) = read_one(b, i, now, track, run);
        for (n, (wid, url)) in tabs.into_iter().enumerate() {
            let mut reason = verdict(config, focus_on, now, &allow.usage, day, &url);
            if reason.is_none() && front && n == 0 && count(config, day, &url, elapsed, allow, &mut out) {
                reason = verdict(config, focus_on, now, &allow.usage, day, &url);
            }
            if let Some(reason) = reason {
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
    out.wait = Some(if anything_active(config, focus_on, now, &allow.usage, day) {
        ACTIVE_WAIT
    } else {
        TRACK_WAIT
    });
    out
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
    allow: Allowance,
    /// `usage.tsv`; `None` until `load` (and in a run with no app data
    /// folder): the count is then kept in memory only.
    file: Option<PathBuf>,
    json: String,
}

/// The state JSON from what is held now.
fn snapshot(g: &Shared, now: u64) -> String {
    let day = g.allow.day.unwrap_or(0);
    state_json(
        &g.config,
        anything_active(&g.config, g.focus_on, now, &g.allow.usage, day),
        &g.track.statuses,
        &g.allow.usage,
        day,
        g.allow.warning.as_ref(),
    )
}

/// Managed by Tauri. Its lock is a leaf (see the file header).
pub struct Blocker {
    inner: Mutex<Shared>,
    wake: Condvar,
}

impl Default for Blocker {
    fn default() -> Self {
        let mut shared = Shared {
            config: Config::default(),
            focus_on: false,
            generation: 0,
            track: Track::default(),
            allow: Allowance::default(),
            file: None,
            json: String::new(),
        };
        shared.json = snapshot(&shared, 0);
        Blocker {
            inner: Mutex::new(shared),
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

    /// Read the count a previous run left, once, in `setup`, before the
    /// thread starts (D7: quitting does not reset the count). The file is
    /// read outside the lock.
    pub fn load(&self, dir: PathBuf) {
        let file = dir.join(allowance::FILE_NAME);
        let usage = std::fs::read_to_string(&file)
            .map(|text| allowance::parse_usage(&text))
            .unwrap_or_default();
        let mut g = self.lock();
        g.allow.usage = usage;
        g.file = Some(file);
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
            let file = blocker.lock().file.clone();
            let mut emitted = String::new();
            // When the warning panel this thread dropped goes away again.
            let mut hide_at: Option<u64> = None;
            loop {
                let (config, focus_on, generation, mut track, mut allow) = {
                    let g = blocker.lock();
                    (g.config.clone(), g.focus_on, g.generation, g.track, g.allow.clone())
                };
                let warning_before = allow.warning.clone();
                let now = now_ms();
                let out = pass(&config, focus_on, now, installed_now(), &mut track, &mut allow, &mut osascript);
                let saved = out.save.then(|| allow.usage.clone());
                let json = {
                    let mut g = blocker.lock();
                    // A warning dismissed during the pass stays dismissed.
                    if allow.warning == warning_before {
                        allow.warning = g.allow.warning.clone();
                    }
                    g.track = track;
                    g.allow = allow;
                    let json = snapshot(&g, now);
                    g.json = json.clone();
                    json
                };
                if let (Some(usage), Some(file)) = (saved, file.as_deref()) {
                    // A failed write leaves the count in memory; the next
                    // change tries again.
                    if let Err(e) = allowance::persist(file, &usage) {
                        eprintln!("usage file: {e}");
                    }
                }
                if json != emitted {
                    let _ = app.emit_str("blocker", json.clone());
                    emitted = json;
                }
                if out.warned {
                    // D5: drop the panel without taking focus. One that is
                    // already up (the user's, or a reminder's) is left alone.
                    let shown = crate::popover_is_shown(app.clone());
                    crate::show_passive(&app);
                    if !shown {
                        hide_at = Some(now + WARNING_SHOWN_MS);
                    }
                }
                if hide_at.is_some_and(|at| now_ms() >= at) {
                    crate::hide_unfocused(&app);
                    hide_at = None;
                }
                let wait = match (out.wait, hide_at) {
                    (wait, None) => wait,
                    (wait, Some(at)) => {
                        let left = Duration::from_millis(at.saturating_sub(now_ms()));
                        Some(wait.map_or(left, |w| w.min(left)))
                    }
                };

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
    ids: Vec<String>,
    names: Vec<String>,
    domains: Vec<Vec<String>>,
    focus: Vec<bool>,
    starts: Vec<Vec<u64>>,
    ends: Vec<Vec<u64>>,
    limits: Vec<u64>,
    midnights: Vec<u64>,
) -> Result<Response, String> {
    let lists = Lists {
        ids,
        names,
        domains,
        focus,
        starts,
        ends,
        limits,
        midnights,
    };
    let config = validate(enabled, lists, now_ms())?;
    let blocker = app.state::<Blocker>();
    blocker.set_config(config);
    Ok(Response::new(blocker.json()))
}

#[tauri::command]
pub fn blocker_state(app: AppHandle) -> Response {
    Response::new(app.state::<Blocker>().json())
}

/// **OK** on the five-minute warning (D5): it is gone until tomorrow.
#[tauri::command]
pub fn blocker_dismiss_warning(app: AppHandle) -> Response {
    let blocker = app.state::<Blocker>();
    let json = {
        let mut g = blocker.lock();
        g.allow.warning = None;
        g.generation += 1;
        let json = snapshot(&g, now_ms());
        g.json = json.clone();
        json
    };
    blocker.wake.notify_all();
    Response::new(json)
}

/// One read of every installed, running browser now — so the Automation
/// prompt can be met on purpose — then the state JSON. Off the main thread.
#[tauri::command]
pub async fn blocker_check(app: AppHandle) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let blocker = app.state::<Blocker>();
        let mut track = blocker.lock().track;
        let now = now_ms();
        check(now, installed_now(), &mut track, &mut osascript);
        let json = {
            let mut g = blocker.lock();
            g.track = track;
            let json = snapshot(&g, now);
            g.json = json.clone();
            json
        };
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
            id: "g".into(),
            name: "G".into(),
            domains: domains.iter().map(|d| d.to_string()).collect(),
            focus,
            windows: windows.to_vec(),
            limit_ms: 0,
        }
    }

    fn cfg(groups: Vec<Group>) -> Config {
        Config {
            enabled: true,
            groups,
            midnights: Vec::new(),
        }
    }

    // The chunk-99 tests below know no allowance: these stand in for the
    // real functions with no usage, so their calls read as they did. The
    // chunk-100 tests at the end call `super::` directly.
    fn verdict(config: &Config, focus_on: bool, now: u64, url: &str) -> Option<Reason> {
        super::verdict(config, focus_on, now, &Usage::default(), 0, url)
    }

    fn anything_active(config: &Config, focus_on: bool, now: u64) -> bool {
        super::anything_active(config, focus_on, now, &Usage::default(), 0)
    }

    fn pass(
        config: &Config,
        focus_on: bool,
        now: u64,
        installed: [bool; 4],
        track: &mut Track,
        run: &mut ScriptRun,
    ) -> Option<Duration> {
        super::pass(config, focus_on, now, installed, track, &mut Allowance::default(), run).wait
    }

    fn state_json(enabled: bool, active: bool, statuses: &[Status; 4]) -> String {
        let config = Config {
            enabled,
            ..Config::default()
        };
        super::state_json(&config, active, statuses, &Usage::default(), 0, None)
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
if frontmost of application id \"com.google.Chrome\" then\n\
set out to \"front\" & linefeed\n\
else\n\
set out to \"back\" & linefeed\n\
end if\n\
tell application id \"com.google.Chrome\"\n\
repeat with w in windows\n\
try\n\
set out to out & ((id of w) as text) & sep & (URL of active tab of w) & linefeed\n\
on error\n\
set out to out & \"0\" & sep & linefeed\n\
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
        // One id and no allowance per name; the chunk-100 lists are tested
        // at the end.
        let n = a.0.len();
        let lists = Lists {
            ids: (0..n).map(|i| format!("g-{i}")).collect(),
            names: a.0,
            domains: a.1,
            focus: a.2,
            starts: a.3,
            ends: a.4,
            limits: vec![0; n],
            midnights: vec![NOW],
        };
        validate(true, lists, NOW)
    }

    #[test]
    fn validate_accepts_a_good_set() {
        let c = run_validate(ok_args()).unwrap();
        assert_eq!(c.groups.len(), 1);
        assert_eq!(c.groups[0].windows, vec![(NOW, NOW + MIN)]);
        let empty = Lists {
            midnights: vec![NOW],
            ..Lists::default()
        };
        assert!(validate(false, empty, NOW).is_ok());
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
{\"name\":\"Microsoft Edge\",\"status\":\"unknown\"}],\
\"usage\":[],\"warning\":null}"
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

    // =======================================================================
    // Chunk 100: the daily allowance
    // =======================================================================

    const DAY0: u64 = NOW - 3_600_000;
    const SEC: u64 = 1_000;
    const FRONT_X: &str = "front\n1\u{1f}https://x.com/\nok\n";

    fn limited(id: &str, domains: &[&str], minutes: u64) -> Group {
        Group {
            id: id.into(),
            name: format!("Group {id}"),
            limit_ms: minutes * MIN,
            ..group(domains, false, &[])
        }
    }

    fn day_cfg(groups: Vec<Group>) -> Config {
        Config {
            enabled: true,
            groups,
            midnights: vec![DAY0, DAY0 + DAY_MS],
        }
    }

    fn used(id: &str, ms: u64) -> Usage {
        let mut u = Usage::default();
        u.add(DAY0, id, ms);
        u
    }

    /// One pass with a fixed reply to every read; writes answer nothing.
    fn step(c: &Config, focus: bool, now: u64, track: &mut Track, allow: &mut Allowance, calls: &mut Calls, read: &str) -> Outcome {
        let read = read.to_string();
        super::pass(c, focus, now, CHROME_ONLY, track, allow, &mut runner(calls, move |s| {
            if s.starts_with("on run") { Run::Ok(String::new()) } else { Run::Ok(read.clone()) }
        }))
    }

    fn writes(calls: &Calls) -> Vec<&(String, Vec<String>)> {
        calls.iter().filter(|(s, _)| s.starts_with("on run")).collect()
    }

    // ---- parse_front / parse_tabs ----

    #[test]
    fn parse_front_reads_the_first_line() {
        assert!(parse_front("front\n1\u{1f}https://x.com/\nok"));
        assert!(parse_front("front\r\nok"));
        assert!(!parse_front("back\n1\u{1f}https://x.com/\nok"));
        // Missing: an old-style answer, or nothing at all.
        assert!(!parse_front("1\u{1f}https://x.com/\nok"));
        assert!(!parse_front("ok"));
        assert!(!parse_front(""));
    }

    #[test]
    fn parse_tabs_skips_the_front_line() {
        for first in ["front", "back"] {
            let out = format!("{first}\n12\u{1f}https://x.com/\n7\u{1f}https://y.com/\nok\n");
            assert_eq!(
                parse_tabs(&out),
                vec![(12, "https://x.com/".to_string()), (7, "https://y.com/".to_string())]
            );
        }
        // A window that could not be read keeps its place, with no URL.
        assert_eq!(
            parse_tabs("front\n0\u{1f}\n7\u{1f}https://y.com/\nok"),
            vec![(0, String::new()), (7, "https://y.com/".to_string())]
        );
    }

    // ---- the read script ----

    #[test]
    fn read_script_reads_frontmost_outside_the_tell() {
        for b in &BROWSERS {
            let s = read_script(b);
            let front = s.find(&format!("if frontmost of application id \"{}\" then\n", b.bundle_id)).unwrap();
            let tell = s.find(&format!("tell application id \"{}\"\n", b.bundle_id)).unwrap();
            assert!(front < tell, "{s}");
            // Nowhere inside the tell block.
            let end = s.find("end tell").unwrap();
            assert!(!s[tell..end].contains("frontmost"));
            assert_eq!(s.matches("frontmost").count(), 1);
        }
    }

    #[test]
    fn read_script_golden_safari_whole() {
        assert_eq!(
            read_script(&BROWSERS[1]),
            "if application id \"com.apple.Safari\" is running then\n\
set sep to character id 31\n\
if frontmost of application id \"com.apple.Safari\" then\n\
set out to \"front\" & linefeed\n\
else\n\
set out to \"back\" & linefeed\n\
end if\n\
tell application id \"com.apple.Safari\"\n\
repeat with w in windows\n\
try\n\
set out to out & ((id of w) as text) & sep & (URL of current tab of w) & linefeed\n\
on error\n\
set out to out & \"0\" & sep & linefeed\n\
end try\n\
end repeat\n\
end tell\n\
return out & \"ok\"\n\
end if"
        );
    }

    // ---- verdict ----

    #[test]
    fn verdict_none_under_the_limit() {
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        assert_eq!(super::verdict(&c, false, NOW, &Usage::default(), DAY0, "https://x.com/"), None);
        assert_eq!(super::verdict(&c, false, NOW, &used("a", 30 * MIN - 1), DAY0, "https://x.com/"), None);
    }

    #[test]
    fn verdict_limit_at_the_limit() {
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        let u = used("a", 30 * MIN);
        assert_eq!(super::verdict(&c, false, NOW, &u, DAY0, "https://www.x.com/a"), Some(Reason::Limit));
        assert_eq!(Reason::Limit.url(), format!("{BLOCKED_PAGE}#limit"));
        // Another site, another day, another group's count: nothing.
        assert_eq!(super::verdict(&c, false, NOW, &u, DAY0, "https://y.com/"), None);
        assert_eq!(super::verdict(&c, false, NOW, &u, DAY0 + DAY_MS, "https://x.com/"), None);
        assert_eq!(super::verdict(&c, false, NOW, &used("b", 30 * MIN), DAY0, "https://x.com/"), None);
    }

    #[test]
    fn verdict_focus_and_schedule_still_win() {
        let mut g = limited("a", &["x.com"], 30);
        g.focus = true;
        g.windows = vec![(NOW - MIN, NOW + MIN)];
        let c = day_cfg(vec![g]);
        for u in [Usage::default(), used("a", 30 * MIN)] {
            assert_eq!(super::verdict(&c, true, NOW, &u, DAY0, "https://x.com/"), Some(Reason::Focus));
            assert_eq!(super::verdict(&c, false, NOW, &u, DAY0, "https://x.com/"), Some(Reason::Schedule));
        }
        // Outside the window, with no focus: the limit.
        assert_eq!(
            super::verdict(&c, false, NOW + MIN, &used("a", 30 * MIN), DAY0, "https://x.com/"),
            Some(Reason::Limit)
        );
    }

    #[test]
    fn verdict_limit_still_exempts_the_dashboard() {
        let c = day_cfg(vec![limited("a", &["github.io"], 1)]);
        let u = used("a", 5 * MIN);
        assert_eq!(super::verdict(&c, false, NOW, &u, DAY0, "https://smrios07mdb.github.io/dashboard/"), None);
        assert_eq!(super::verdict(&c, false, NOW, &u, DAY0, &Reason::Limit.url()), None);
        assert_eq!(
            super::verdict(&c, false, NOW, &u, DAY0, "https://smrios07mdb.github.io/other/"),
            Some(Reason::Limit)
        );
    }

    // ---- anything_active / tracking ----

    #[test]
    fn an_exhausted_group_is_active_and_an_open_one_is_tracked() {
        let c = day_cfg(vec![limited("a", &["x.com"], 2)]);
        let none = Usage::default();
        let full = used("a", 2 * MIN);
        assert!(!super::anything_active(&c, false, NOW, &none, DAY0));
        assert!(tracking(&c, &none, DAY0));
        assert!(super::anything_active(&c, false, NOW, &full, DAY0));
        assert!(!tracking(&c, &full, DAY0));
        // No sites, no allowance, or the Mac switch off: nothing to count.
        assert!(!tracking(&day_cfg(vec![limited("a", &[], 2)]), &none, DAY0));
        assert!(!tracking(&day_cfg(vec![limited("a", &["x.com"], 0)]), &none, DAY0));
        let mut off = c.clone();
        off.enabled = false;
        assert!(!tracking(&off, &none, DAY0));
        assert!(!super::anything_active(&off, false, NOW, &full, DAY0));
    }

    // ---- the pass ----

    #[test]
    fn no_runner_call_with_neither_blocking_nor_tracking() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        // No allowance and no trigger; then an allowance on a group that is
        // switched off (the web view sends none) or with the Mac switch off.
        let plain = day_cfg(vec![limited("a", &["x.com"], 0)]);
        let out = step(&plain, false, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(out.wait, None);
        let mut off = day_cfg(vec![limited("a", &["x.com"], 30)]);
        off.enabled = false;
        let out = step(&off, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(out.wait, None);
        assert!(calls.is_empty());
        assert!(allow.usage.is_empty());
    }

    #[test]
    fn tracking_alone_waits_5_s() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        let out = step(&c, false, NOW, &mut track, &mut allow, &mut calls, "back\nok\n");
        assert_eq!(out.wait, Some(TRACK_WAIT));
        assert_eq!(TRACK_WAIT, Duration::from_secs(5));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, read_script(&BROWSERS[0]));
        // A focus block on top of it: back to 2 s.
        let mut g = limited("b", &["y.com"], 0);
        g.focus = true;
        let both = day_cfg(vec![limited("a", &["x.com"], 30), g]);
        let out = step(&both, true, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, "back\nok\n");
        assert_eq!(out.wait, Some(ACTIVE_WAIT));
    }

    #[test]
    fn a_front_browsers_first_window_counts_and_a_second_does_not() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![limited("a", &["x.com"], 30), limited("b", &["y.com"], 30)]);
        let read = "front\n1\u{1f}https://x.com/\n2\u{1f}https://y.com/\nok\n";
        // The first read after an idle stretch has nothing to add.
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, read);
        assert!(allow.usage.is_empty());
        step(&c, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, read);
        step(&c, false, NOW + 10 * SEC, &mut track, &mut allow, &mut calls, read);
        assert_eq!(allow.usage.used_ms(DAY0, "a"), 10 * SEC);
        assert_eq!(allow.usage.used_ms(DAY0, "b"), 0);
        assert!(writes(&calls).is_empty());
    }

    #[test]
    fn a_window_that_could_not_be_read_in_front_counts_nothing() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        let read = "front\n0\u{1f}\n1\u{1f}https://x.com/\nok\n";
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, read);
        step(&c, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, read);
        assert!(allow.usage.is_empty());
    }

    #[test]
    fn back_counts_nothing() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        let read = "back\n1\u{1f}https://x.com/\nok\n";
        for k in 0..4 {
            step(&c, false, NOW + k * 5 * SEC, &mut track, &mut allow, &mut calls, read);
        }
        assert!(allow.usage.is_empty());
        assert_eq!(calls.len(), 4);
    }

    #[test]
    fn a_host_in_two_groups_counts_for_both() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![
            limited("a", &["x.com"], 30),
            limited("b", &["y.com", "x.com"], 60),
            limited("c", &["x.com"], 0),
        ]);
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        step(&c, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.usage.used_ms(DAY0, "a"), 5 * SEC);
        assert_eq!(allow.usage.used_ms(DAY0, "b"), 5 * SEC);
        // No allowance, no count.
        assert_eq!(allow.usage.used_ms(DAY0, "c"), 0);
    }

    #[test]
    fn the_elapsed_time_is_capped_at_10_s() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        // The Mac slept for an hour.
        step(&c, false, NOW + 60 * MIN, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.usage.used_ms(DAY0, "a"), 10 * SEC);
    }

    #[test]
    fn a_tab_that_is_blocked_already_counts_nothing() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let mut g = limited("a", &["x.com"], 30);
        g.focus = true;
        let c = day_cfg(vec![g]);
        step(&c, true, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        step(&c, true, NOW + 2 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert!(allow.usage.is_empty());
        assert_eq!(writes(&calls).len(), 2);
        assert_eq!(writes(&calls)[0].1[2], format!("{BLOCKED_PAGE}#focus"));
    }

    #[test]
    fn the_pass_that_reaches_the_limit_redirects_in_the_same_pass() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance {
            usage: used("a", 2 * MIN - 7 * SEC),
            ..Allowance::default()
        };
        let c = day_cfg(vec![limited("a", &["x.com"], 2)]);
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        let out = step(&c, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert!(writes(&calls).is_empty());
        assert!(!out.save);
        assert_eq!(out.wait, Some(TRACK_WAIT));
        // 5 s more: 2 min 3 s of 2 min.
        let out = step(&c, false, NOW + 10 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(
            writes(&calls)[0].1,
            vec!["1".to_string(), "https://x.com/".to_string(), format!("{BLOCKED_PAGE}#limit")]
        );
        assert!(out.save);
        // Blocking now: the 2 s cadence, and nothing more is counted.
        assert_eq!(out.wait, Some(ACTIVE_WAIT));
        let at = allow.usage.used_ms(DAY0, "a");
        step(&c, false, NOW + 12 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.usage.used_ms(DAY0, "a"), at);
        assert_eq!(writes(&calls).len(), 2);
    }

    #[test]
    fn the_file_is_due_when_a_whole_minute_passes() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance {
            usage: used("a", MIN - 7 * SEC),
            ..Allowance::default()
        };
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        assert!(!step(&c, false, NOW, &mut track, &mut allow, &mut calls, FRONT_X).save);
        assert!(!step(&c, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, FRONT_X).save);
        assert!(step(&c, false, NOW + 10 * SEC, &mut track, &mut allow, &mut calls, FRONT_X).save);
        assert!(!step(&c, false, NOW + 15 * SEC, &mut track, &mut allow, &mut calls, FRONT_X).save);
    }

    #[test]
    fn warn_now_sets_the_warning_once() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance {
            usage: used("a", 3 * MIN - 7 * SEC),
            ..Allowance::default()
        };
        let c = day_cfg(vec![limited("a", &["x.com"], 8)]);
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        let out = step(&c, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert!(!out.warned);
        assert_eq!(allow.warning, None);
        let out = step(&c, false, NOW + 10 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert!(out.warned);
        assert_eq!(
            allow.warning,
            Some(Warning { id: "a".into(), name: "Group a".into(), minutes_left: 5 })
        );
        // It stays up, and is not given again.
        let out = step(&c, false, NOW + 15 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert!(!out.warned);
        assert!(allow.warning.is_some());
        // Dismissed, then a larger allowance crossed a second time: no second warning today.
        allow.warning = None;
        allow.usage = used("a", 5 * MIN - 2 * SEC);
        let wider = day_cfg(vec![limited("a", &["x.com"], 10)]);
        let out = step(&wider, false, NOW + 20 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert!(!out.warned);
        assert_eq!(allow.warning, None);
    }

    #[test]
    fn the_warning_clears_when_the_limit_is_reached() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance {
            usage: used("a", 8 * MIN - 3 * SEC),
            day: Some(DAY0),
            warned: vec!["a".into()],
            warning: Some(Warning { id: "a".into(), name: "Group a".into(), minutes_left: 5 }),
            ..Allowance::default()
        };
        let c = day_cfg(vec![limited("a", &["x.com"], 8)]);
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        assert!(allow.warning.is_some());
        step(&c, false, NOW + 5 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.warning, None);
        assert_eq!(writes(&calls).len(), 1);
    }

    #[test]
    fn the_warning_clears_when_its_group_goes() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance {
            warning: Some(Warning { id: "a".into(), name: "Group a".into(), minutes_left: 5 }),
            ..Allowance::default()
        };
        let c = day_cfg(vec![limited("b", &["x.com"], 8)]);
        step(&c, false, NOW, &mut track, &mut allow, &mut calls, "back\nok");
        assert_eq!(allow.warning, None);
    }

    #[test]
    fn a_day_change_resets_the_count_and_the_warning() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![limited("a", &["x.com"], 2)]);
        let late = DAY0 + DAY_MS - 20 * SEC;
        allow.usage = used("a", 2 * MIN);
        step(&c, false, late, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.day, Some(DAY0));
        assert_eq!(writes(&calls).len(), 1);
        allow.warned = vec!["a".into()];
        allow.warning = Some(Warning { id: "a".into(), name: "Group a".into(), minutes_left: 5 });
        // Past midnight: yesterday's count is gone, the site opens again.
        let out = step(&c, false, DAY0 + DAY_MS + SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.day, Some(DAY0 + DAY_MS));
        assert!(out.save);
        assert_eq!(allow.usage.used_ms(DAY0, "a"), 0);
        assert!(allow.warned.is_empty());
        assert_eq!(allow.warning, None);
        assert_eq!(writes(&calls).len(), 1);
        assert_eq!(out.wait, Some(TRACK_WAIT));
        // The new day counts from nothing.
        step(&c, false, DAY0 + DAY_MS + 6 * SEC, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.usage.used_ms(DAY0 + DAY_MS, "a"), 5 * SEC);
    }

    #[test]
    fn the_first_pass_keeps_todays_count_from_the_file() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance {
            usage: used("a", 2 * MIN),
            ..Allowance::default()
        };
        // Before the first configuration: no midnights, nothing is dropped.
        let out = step(&Config::default(), false, NOW, &mut track, &mut allow, &mut calls, FRONT_X);
        assert_eq!(allow.usage.used_ms(DAY0, "a"), 2 * MIN);
        assert!(!out.save);
        assert!(calls.is_empty());
        // Configured, the same day: kept, and nothing to write.
        let c = day_cfg(vec![limited("a", &["x.com"], 4)]);
        let out = step(&c, false, NOW, &mut track, &mut allow, &mut calls, "back\nok");
        assert_eq!(allow.usage.used_ms(DAY0, "a"), 2 * MIN);
        assert!(!out.save);
    }

    #[test]
    fn a_closed_browser_keeps_its_10_s_back_off_while_tracking() {
        let mut calls = Calls::new();
        let mut track = Track::default();
        let mut allow = Allowance::default();
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        for k in [0, 5, 9] {
            let out = step(&c, false, NOW + k * SEC, &mut track, &mut allow, &mut calls, "");
            assert_eq!(out.wait, Some(TRACK_WAIT));
        }
        assert_eq!(calls.len(), 1);
        assert_eq!(track.statuses[0], Status::NotRunning);
        step(&c, false, NOW + 10 * SEC, &mut track, &mut allow, &mut calls, "");
        assert_eq!(calls.len(), 2);
        // Denied: 30 s, as while blocking.
        let mut track = Track::default();
        let mut calls = Calls::new();
        let denied = |_: &str| Run::Failed("(-1743)".into());
        for k in [0, 5, 29] {
            super::pass(&c, false, NOW + k * SEC, CHROME_ONLY, &mut track, &mut allow, &mut runner(&mut calls, denied));
        }
        assert_eq!(calls.len(), 1);
        super::pass(&c, false, NOW + 30 * SEC, CHROME_ONLY, &mut track, &mut allow, &mut runner(&mut calls, denied));
        assert_eq!(calls.len(), 2);
    }

    // ---- validate ----

    fn lists() -> Lists {
        Lists {
            ids: vec!["g-1".into()],
            names: vec!["Social".into()],
            domains: vec![vec!["x.com".into()]],
            focus: vec![false],
            starts: vec![vec![]],
            ends: vec![vec![]],
            limits: vec![30],
            midnights: vec![NOW - 1, NOW + DAY_MS - 1],
        }
    }

    #[test]
    fn validate_takes_ids_limits_and_midnights() {
        let c = validate(true, lists(), NOW).unwrap();
        assert_eq!(c.groups[0].id, "g-1");
        assert_eq!(c.groups[0].limit_ms, 30 * MIN);
        assert_eq!(c.midnights, vec![NOW - 1, NOW + DAY_MS - 1]);
        let mut l = lists();
        l.limits = vec![0];
        assert_eq!(validate(true, l, NOW).unwrap().groups[0].limit_ms, 0);
        let mut l = lists();
        l.limits = vec![1440];
        l.midnights = vec![NOW - 2 * DAY_MS, NOW + 17 * DAY_MS];
        assert!(validate(true, l, NOW).is_ok());
    }

    #[test]
    fn validate_rejects_ids_of_a_different_length() {
        let mut l = lists();
        l.ids.push("g-2".into());
        assert!(validate(true, l, NOW).is_err());
        let mut l = lists();
        l.ids.clear();
        assert!(validate(true, l, NOW).is_err());
    }

    #[test]
    fn validate_rejects_limits_of_a_different_length() {
        let mut l = lists();
        l.limits.push(5);
        assert!(validate(true, l, NOW).is_err());
        let mut l = lists();
        l.limits.clear();
        assert!(validate(true, l, NOW).is_err());
    }

    #[test]
    fn validate_rejects_a_bad_id() {
        for bad in ["", "a b", "a\tb", "https://x.com/", &"a".repeat(65)] {
            let mut l = lists();
            l.ids = vec![bad.to_string()];
            assert!(validate(true, l, NOW).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn validate_rejects_duplicate_ids() {
        let mut l = lists();
        l.ids = vec!["g-1".into(), "g-1".into()];
        l.names.push("News".into());
        l.domains.push(vec![]);
        l.focus.push(true);
        l.starts.push(vec![]);
        l.ends.push(vec![]);
        l.limits.push(0);
        assert_eq!(validate(true, l.clone(), NOW), Err("duplicate group id".into()));
        l.ids[1] = "g-2".into();
        assert!(validate(true, l, NOW).is_ok());
    }

    #[test]
    fn validate_rejects_a_limit_over_1440() {
        let mut l = lists();
        l.limits = vec![1441];
        assert!(validate(true, l, NOW).is_err());
    }

    #[test]
    fn validate_rejects_empty_midnights() {
        let mut l = lists();
        l.midnights.clear();
        assert!(validate(true, l, NOW).is_err());
        // And more than 20.
        let mut l = lists();
        l.midnights = (0..21).map(|i| NOW + i * 1_000).collect();
        assert!(validate(true, l, NOW).is_err());
    }

    #[test]
    fn validate_rejects_unsorted_midnights() {
        let mut l = lists();
        l.midnights = vec![NOW + DAY_MS, NOW];
        assert!(validate(true, l, NOW).is_err());
        let mut l = lists();
        l.midnights = vec![NOW, NOW];
        assert!(validate(true, l, NOW).is_err());
    }

    #[test]
    fn validate_rejects_midnights_out_of_range() {
        let mut l = lists();
        l.midnights = vec![NOW - 2 * DAY_MS - 1];
        assert!(validate(true, l, NOW).is_err());
        let mut l = lists();
        l.midnights = vec![NOW + 17 * DAY_MS + 1];
        assert!(validate(true, l, NOW).is_err());
    }

    // ---- state_json ----

    #[test]
    fn state_json_golden_with_usage() {
        let c = day_cfg(vec![
            limited("g-1", &["x.com"], 30),
            limited("g-2", &["y.com"], 0),
            limited("g-3", &["z.com"], 2),
        ]);
        let mut u = used("g-1", 13 * MIN - 1);
        u.add(DAY0, "g-3", 2 * MIN + 4 * SEC);
        u.add(DAY0 + DAY_MS, "g-1", 29 * MIN);
        let s = [Status::Ok, Status::NotInstalled, Status::NotInstalled, Status::NotInstalled];
        assert_eq!(
            super::state_json(&c, true, &s, &u, DAY0, None),
            "{\"enabled\":true,\"active\":true,\"browsers\":[\
{\"name\":\"Google Chrome\",\"status\":\"ok\"},\
{\"name\":\"Safari\",\"status\":\"not_installed\"},\
{\"name\":\"Brave Browser\",\"status\":\"not_installed\"},\
{\"name\":\"Microsoft Edge\",\"status\":\"not_installed\"}],\
\"usage\":[{\"id\":\"g-1\",\"usedMinutes\":12,\"limitMinutes\":30},\
{\"id\":\"g-3\",\"usedMinutes\":2,\"limitMinutes\":2}],\
\"warning\":null}"
        );
    }

    #[test]
    fn state_json_used_minutes_round_down() {
        let c = day_cfg(vec![limited("a", &["x.com"], 30)]);
        let s = [Status::Unknown; 4];
        for (ms, want) in [(0, 0), (MIN - 1, 0), (MIN, 1), (2 * MIN - 1, 1), (29 * MIN + 59 * SEC, 29)] {
            let json = super::state_json(&c, false, &s, &used("a", ms), DAY0, None);
            assert!(json.contains(&format!("\"usedMinutes\":{want},")), "{ms}: {json}");
        }
    }

    #[test]
    fn state_json_golden_with_a_warning() {
        let c = day_cfg(vec![limited("a", &["x.com"], 8)]);
        let w = Warning { id: "a".into(), name: "So \"cial\"".into(), minutes_left: 5 };
        let json = super::state_json(&c, false, &[Status::Unknown; 4], &used("a", 3 * MIN), DAY0, Some(&w));
        assert!(json.ends_with(
            "\"usage\":[{\"id\":\"a\",\"usedMinutes\":3,\"limitMinutes\":8}],\
\"warning\":{\"id\":\"a\",\"name\":\"So \\\"cial\\\"\",\"minutesLeft\":5}}"
        ), "{json}");
        // Never a URL or a domain.
        assert!(!json.contains("x.com"));
    }
}
