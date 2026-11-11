//! Saved sessions (chunk 98): the shell's ledger of finished focus phases and
//! breathing sessions.
//!
//! Rust records, the web view writes. The hidden web view is throttled or
//! suspended and can miss an event, so every finished session is kept here —
//! in memory and in one small file — until the web view says it has written
//! it to Supabase (or into its outbox). The web view asks with
//! `sessions_pending`, writes, and answers with `sessions_ack`.
//!
//! Top half: pure and tested — what is kept, the JSON the web view reads and
//! the ledger file's text. Bottom half: the Tauri glue — the managed ledger,
//! its file and the three commands.
//!
//! The file is `sessions-ledger.tsv` in the app data folder: the shell's
//! second file, after the LaunchAgent plist (`login.rs`). It exists only
//! while something is waiting; an empty ledger removes it.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager};

use crate::pomodoro::json_string;

/// A session shorter than this (active time) is dropped silently (D1).
pub const MIN_ACTIVE_MS: u64 = 60_000;
/// The ledger holds at most this many entries; past that the oldest goes.
pub const MAX_ENTRIES: usize = 500;
const FILE_NAME: &str = "sessions-ledger.tsv";
/// "No task" in the ledger file.
const NONE: &str = "-";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Focus,
    Meditation,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Focus => "focus",
            Kind::Meditation => "meditation",
        }
    }

    fn parse(s: &str) -> Option<Kind> {
        match s {
            "focus" => Some(Kind::Focus),
            "meditation" => Some(Kind::Meditation),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    /// Reached its scheduled end (focus or breathing).
    Completed,
    /// Focus: Skip to break.
    Skipped,
    /// Focus: End, or sign-out's stop.
    Stopped,
    /// Breathing: Esc, `meditation_end` or sign-out.
    Ended,
}

impl Outcome {
    fn name(self) -> &'static str {
        match self {
            Outcome::Completed => "completed",
            Outcome::Skipped => "skipped",
            Outcome::Stopped => "stopped",
            Outcome::Ended => "ended",
        }
    }

    fn parse(s: &str) -> Option<Outcome> {
        match s {
            "completed" => Some(Outcome::Completed),
            "skipped" => Some(Outcome::Skipped),
            "stopped" => Some(Outcome::Stopped),
            "ended" => Some(Outcome::Ended),
            _ => None,
        }
    }
}

/// One finished session. Every time is epoch ms.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Record {
    pub kind: Kind,
    pub started_at: u64,
    pub ended_at: u64,
    pub planned_ms: u64,
    /// Time actually spent: pauses excluded.
    pub active_ms: u64,
    pub outcome: Outcome,
    /// `(id, title)` — focus only, and none for a bare session.
    pub task: Option<(String, String)>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Entry {
    pub seq: u64,
    pub record: Record,
}

/// At least a minute of active time (D1).
pub fn keep(r: &Record) -> bool {
    r.active_ms >= MIN_ACTIVE_MS
}

/// The `seq` the next entry gets: one past the highest in the ledger.
pub fn next_seq(entries: &[Entry]) -> u64 {
    entries.iter().map(|e| e.seq).max().map_or(1, |m| m + 1)
}

/// Append, dropping the oldest entries past the cap.
pub fn push(entries: &mut Vec<Entry>, entry: Entry) {
    entries.push(entry);
    if entries.len() > MAX_ENTRIES {
        let extra = entries.len() - MAX_ENTRIES;
        entries.drain(..extra);
    }
}

/// What the web view reads, written by hand like the other snapshots.
pub fn entries_json(entries: &[Entry]) -> String {
    let items: Vec<String> = entries
        .iter()
        .map(|e| {
            let r = &e.record;
            let (id, title) = match &r.task {
                Some((id, title)) => (json_string(id), json_string(title)),
                None => ("null".to_string(), "null".to_string()),
            };
            format!(
                "{{\"seq\":{},\"kind\":\"{}\",\"startedAt\":{},\"endedAt\":{},\"plannedMs\":{},\
                 \"activeMs\":{},\"outcome\":\"{}\",\"taskId\":{},\"taskTitle\":{}}}",
                e.seq,
                r.kind.name(),
                r.started_at,
                r.ended_at,
                r.planned_ms,
                r.active_ms,
                r.outcome.name(),
                id,
                title
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

/// A task field for the ledger: `\`, tab and newline escaped, so a field
/// never holds a separator. A text that is exactly `-` is written `\-`, which
/// keeps it apart from "none".
fn escape_field(s: &str) -> String {
    if s == NONE {
        return "\\-".to_string();
    }
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            c => out.push(c),
        }
    }
    out
}

/// The inverse of `escape_field`. An unknown escape keeps its character.
fn unescape_field(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some(c) => out.push(c),
            None => out.push('\\'),
        }
    }
    out
}

/// The ledger file: one line per entry, tab-separated, in the order of the
/// JSON keys. `-` in both task fields means no task.
pub fn ledger_text(entries: &[Entry]) -> String {
    let mut out = String::new();
    for e in entries {
        let r = &e.record;
        let (id, title) = match &r.task {
            Some((id, title)) => (escape_field(id), escape_field(title)),
            None => (NONE.to_string(), NONE.to_string()),
        };
        out.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            e.seq,
            r.kind.name(),
            r.started_at,
            r.ended_at,
            r.planned_ms,
            r.active_ms,
            r.outcome.name(),
            id,
            title
        ));
    }
    out
}

fn parse_line(line: &str) -> Option<Entry> {
    let f: Vec<&str> = line.split('\t').collect();
    if f.len() != 9 {
        return None;
    }
    let task = if f[7] == NONE {
        None
    } else {
        Some((unescape_field(f[7]), unescape_field(f[8])))
    };
    Some(Entry {
        seq: f[0].parse().ok()?,
        record: Record {
            kind: Kind::parse(f[1])?,
            started_at: f[2].parse().ok()?,
            ended_at: f[3].parse().ok()?,
            planned_ms: f[4].parse().ok()?,
            active_ms: f[5].parse().ok()?,
            outcome: Outcome::parse(f[6])?,
            task,
        },
    })
}

/// Read a ledger back. A malformed line is skipped, never a panic; more
/// than the cap keeps the newest.
pub fn parse_ledger(text: &str) -> Vec<Entry> {
    let mut out = Vec::new();
    for line in text.split('\n') {
        if let Some(entry) = parse_line(line) {
            push(&mut out, entry);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Tauri glue
// ---------------------------------------------------------------------------

struct Inner {
    entries: Vec<Entry>,
    /// Never reused within a run, even after the ledger empties: an ack still
    /// on its way must not match a newer entry.
    next_seq: u64,
    /// `None` until `load` (and in a run with no app data folder): the ledger
    /// then lives in memory only.
    file: Option<PathBuf>,
}

/// The managed ledger. **Its lock is a leaf:** never taken while the pomodoro
/// or meditation lock is held, and never held across an emit. The file is
/// rewritten under it, so writes land in the order of the changes.
pub struct Sessions {
    inner: Mutex<Inner>,
}

impl Default for Sessions {
    fn default() -> Self {
        Sessions {
            inner: Mutex::new(Inner {
                entries: Vec::new(),
                next_seq: 1,
                file: None,
            }),
        }
    }
}

/// Rewrite the file from `entries`: a temp file in the same folder, then a
/// rename (the `login.rs` pattern). An empty ledger removes the file.
fn persist(file: &Path, entries: &[Entry]) -> Result<(), String> {
    if entries.is_empty() {
        return match std::fs::remove_file(file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    let dir = file.parent().ok_or("no folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{FILE_NAME}.tmp"));
    std::fs::write(&tmp, ledger_text(entries)).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

impl Inner {
    /// A failed write leaves the entries in memory; the next change tries
    /// again.
    fn persist(&self) {
        if let Some(file) = self.file.as_deref() {
            if let Err(e) = persist(file, &self.entries) {
                eprintln!("sessions ledger: {e}");
            }
        }
    }
}

impl Sessions {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Read the ledger a previous run left, once, in `setup`. `seq` continues
    /// from the highest found.
    pub fn load(&self, dir: PathBuf) {
        let file = dir.join(FILE_NAME);
        let found = match std::fs::read_to_string(&file) {
            Ok(text) => parse_ledger(&text),
            Err(_) => Vec::new(),
        };
        let mut g = self.lock();
        // Anything recorded before `load` (nothing, in practice) stays, after
        // what the file held.
        let mut entries = found;
        let mut seq = next_seq(&entries);
        for mut e in std::mem::take(&mut g.entries) {
            e.seq = seq;
            seq += 1;
            push(&mut entries, e);
        }
        g.entries = entries;
        g.next_seq = seq;
        g.file = Some(file);
    }

    /// Keep a finished session until the web view has written it. Never
    /// called while the pomodoro or meditation lock is held.
    pub fn record(&self, app: &AppHandle, record: Record) {
        if !keep(&record) {
            return;
        }
        let pending = {
            let mut g = self.lock();
            let seq = g.next_seq;
            g.next_seq += 1;
            push(&mut g.entries, Entry { seq, record });
            g.persist();
            g.entries.len()
        };
        let _ = app.emit("sessions", pending.to_string());
    }

    fn pending_json(&self) -> String {
        entries_json(&self.lock().entries)
    }

    fn ack(&self, seqs: &[u64]) -> String {
        let mut g = self.lock();
        let before = g.entries.len();
        g.entries.retain(|e| !seqs.contains(&e.seq));
        if g.entries.len() != before {
            g.persist();
        }
        entries_json(&g.entries)
    }

    fn clear(&self) {
        let mut g = self.lock();
        g.entries.clear();
        g.persist();
    }
}

/// Hand a finished session to the ledger, if there is one. For the pomodoro
/// and meditation glue, after their own lock is released.
pub fn record(app: &AppHandle, record: Option<Record>) {
    if let Some(record) = record {
        if let Some(sessions) = app.try_state::<Sessions>() {
            sessions.record(app, record);
        }
    }
}

/// Every session still waiting to be written, oldest first.
#[tauri::command]
pub fn sessions_pending(app: AppHandle) -> Result<Response, String> {
    Ok(Response::new(app.state::<Sessions>().pending_json()))
}

/// The web view wrote these: drop them, and answer what is still waiting.
#[tauri::command]
pub fn sessions_ack(app: AppHandle, seqs: Vec<u64>) -> Result<Response, String> {
    Ok(Response::new(app.state::<Sessions>().ack(&seqs)))
}

/// Signed out: the next account never receives this one's entries.
#[tauri::command]
pub fn sessions_clear(app: AppHandle) {
    app.state::<Sessions>().clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: u64 = 1_800_000_000_000;

    fn focus(active_ms: u64, task: Option<(&str, &str)>) -> Record {
        Record {
            kind: Kind::Focus,
            started_at: T0,
            ended_at: T0 + active_ms,
            planned_ms: 1_500_000,
            active_ms,
            outcome: Outcome::Completed,
            task: task.map(|(id, title)| (id.to_string(), title.to_string())),
        }
    }

    fn breathing() -> Record {
        Record {
            kind: Kind::Meditation,
            started_at: T0 + 5,
            ended_at: T0 + 70_005,
            planned_ms: 300_000,
            active_ms: 70_000,
            outcome: Outcome::Ended,
            task: None,
        }
    }

    fn entry(seq: u64, record: Record) -> Entry {
        Entry { seq, record }
    }

    // ---- keep ----

    #[test]
    fn keep_needs_a_full_minute_of_active_time() {
        assert!(!keep(&focus(59_999, None)));
        assert!(keep(&focus(60_000, None)));
    }

    // ---- entries_json ----

    #[test]
    fn entries_json_without_a_task() {
        assert_eq!(entries_json(&[]), "[]");
        assert_eq!(
            entries_json(&[entry(7, breathing())]),
            "[{\"seq\":7,\"kind\":\"meditation\",\"startedAt\":1800000000005,\
             \"endedAt\":1800000070005,\"plannedMs\":300000,\"activeMs\":70000,\
             \"outcome\":\"ended\",\"taskId\":null,\"taskTitle\":null}]"
        );
    }

    #[test]
    fn entries_json_with_a_task_and_a_title_that_needs_escaping() {
        let r = focus(1_500_000, Some(("t-1", "Say \"hi\" \\ twice\nnow")));
        let skipped = Record {
            outcome: Outcome::Skipped,
            ..focus(90_000, Some(("t-2", "Plain")))
        };
        assert_eq!(
            entries_json(&[entry(1, r), entry(2, skipped)]),
            "[{\"seq\":1,\"kind\":\"focus\",\"startedAt\":1800000000000,\
             \"endedAt\":1800001500000,\"plannedMs\":1500000,\"activeMs\":1500000,\
             \"outcome\":\"completed\",\"taskId\":\"t-1\",\
             \"taskTitle\":\"Say \\\"hi\\\" \\\\ twice\\nnow\"},\
             {\"seq\":2,\"kind\":\"focus\",\"startedAt\":1800000000000,\
             \"endedAt\":1800000090000,\"plannedMs\":1500000,\"activeMs\":90000,\
             \"outcome\":\"skipped\",\"taskId\":\"t-2\",\"taskTitle\":\"Plain\"}]"
        );
    }

    #[test]
    fn entries_json_names_every_outcome() {
        let stopped = Record {
            outcome: Outcome::Stopped,
            ..focus(60_000, None)
        };
        let json = entries_json(&[entry(1, stopped)]);
        assert!(json.contains("\"outcome\":\"stopped\""), "{json}");
    }

    // ---- the ledger text ----

    #[test]
    fn ledger_text_is_one_tab_separated_line_per_entry() {
        let text = ledger_text(&[
            entry(3, focus(60_000, Some(("t-1", "Write")))),
            entry(4, breathing()),
        ]);
        assert_eq!(
            text,
            "3\tfocus\t1800000000000\t1800000060000\t1500000\t60000\tcompleted\tt-1\tWrite\n\
             4\tmeditation\t1800000000005\t1800000070005\t300000\t70000\tended\t-\t-\n"
        );
        assert_eq!(ledger_text(&[]), "");
    }

    #[test]
    fn ledger_round_trips_including_a_tab_and_a_newline_in_the_title() {
        let entries = vec![
            entry(1, focus(60_000, Some(("t\t1", "a\tb\nc \\ d\\n")))),
            entry(2, breathing()),
            entry(
                9,
                Record {
                    outcome: Outcome::Stopped,
                    ..focus(61_000, Some(("t-3", "ends with a return\r")))
                },
            ),
            // A title that is exactly the "none" mark stays a title.
            entry(10, focus(62_000, Some(("-", "-")))),
            entry(
                11,
                Record {
                    outcome: Outcome::Skipped,
                    ..focus(63_000, None)
                },
            ),
        ];
        let text = ledger_text(&entries);
        assert_eq!(text.matches('\n').count(), entries.len());
        assert_eq!(parse_ledger(&text), entries);
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let good = ledger_text(&[entry(5, breathing())]);
        let text = format!(
            "\n\
             not a ledger line\n\
             1\tfocus\t1\t2\t3\n\
             x\tfocus\t1\t2\t3\t4\tcompleted\t-\t-\n\
             2\tnap\t1\t2\t3\t4\tcompleted\t-\t-\n\
             3\tfocus\t1\t2\t3\t4\twon\t-\t-\n\
             4\tfocus\t-1\t2\t3\t4\tcompleted\t-\t-\n\
             6\tfocus\t1\t2\t3\t4\tcompleted\t-\t-\textra\n\
             {good}\
             \u{0}\u{1}garbage"
        );
        assert_eq!(parse_ledger(&text), vec![entry(5, breathing())]);
        assert_eq!(parse_ledger(""), vec![]);
    }

    // ---- the cap and seq ----

    #[test]
    fn the_cap_drops_the_oldest() {
        let mut entries = Vec::new();
        for seq in 1..=(MAX_ENTRIES as u64 + 2) {
            push(&mut entries, entry(seq, breathing()));
        }
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries.first().unwrap().seq, 3);
        assert_eq!(entries.last().unwrap().seq, MAX_ENTRIES as u64 + 2);
        // A file holding more than the cap reads back as its newest 500.
        let mut long = entries.clone();
        long.insert(0, entry(2, breathing()));
        let parsed = parse_ledger(&ledger_text(&long));
        assert_eq!(parsed.len(), MAX_ENTRIES);
        assert_eq!(parsed.first().unwrap().seq, 3);
    }

    #[test]
    fn seq_continues_past_the_highest_parsed() {
        assert_eq!(next_seq(&[]), 1);
        let parsed = parse_ledger(&ledger_text(&[
            entry(41, breathing()),
            entry(7, focus(60_000, None)),
        ]));
        assert_eq!(next_seq(&parsed), 42);
    }

    // ---- the file ----

    #[test]
    fn the_file_is_written_whole_and_removed_when_empty() {
        let dir = std::env::temp_dir().join(format!("hup-sessions-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join(FILE_NAME);
        let entries = vec![entry(1, focus(60_000, Some(("t-1", "Write"))))];

        persist(&file, &entries).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), ledger_text(&entries));
        // No temp file is left beside it.
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);

        persist(&file, &[]).unwrap();
        assert!(!file.exists());
        // Removing a file that is not there is not an error.
        persist(&file, &[]).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_reads_the_file_and_continues_its_seq() {
        let dir =
            std::env::temp_dir().join(format!("hup-sessions-load-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let entries = vec![entry(12, breathing())];
        persist(&dir.join(FILE_NAME), &entries).unwrap();

        let sessions = Sessions::default();
        sessions.load(dir.clone());
        assert_eq!(sessions.pending_json(), entries_json(&entries));
        assert_eq!(sessions.lock().next_seq, 13);

        // Acking an unknown seq changes nothing; acking the entry empties
        // the ledger and removes the file.
        assert_eq!(sessions.ack(&[99]), entries_json(&entries));
        assert!(dir.join(FILE_NAME).exists());
        assert_eq!(sessions.ack(&[12]), "[]");
        assert!(!dir.join(FILE_NAME).exists());
        // The seq is not reused after the ledger empties.
        assert_eq!(sessions.lock().next_seq, 13);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
