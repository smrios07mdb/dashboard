//! Daily allowance (chunk 100): how long each block group's sites have been
//! in front today, on this Mac.
//!
//! `blocker.rs` does the counting (it is the one that reads the browsers);
//! this file holds what it counts into, the rules that read the count, and
//! the file that keeps it across a quit. All pure and unit-tested, apart
//! from `persist`.
//!
//! The file is `usage.tsv` in the app data folder: the shell's third file,
//! after the LaunchAgent plist (`login.rs`) and the sessions ledger
//! (`sessions.rs`). It holds a day start, a group id and milliseconds per
//! line — never a URL, a domain or a group name. It is rewritten through a
//! temp file and a rename when a group's whole-minute count changes, when a
//! limit is reached and at a day change; an empty map removes it.

use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::Path;

pub const FILE_NAME: &str = "usage.tsv";
const MINUTE_MS: u64 = 60_000;
/// D5: the warning is given when this much, or less, is left.
pub const WARN_MS: u64 = 5 * MINUTE_MS;
/// D2: one pass adds at most this much, so sleep adds nothing.
pub const MAX_STEP_MS: u64 = 10_000;

/// D3: the day `now` belongs to — the greatest midnight at or before it.
/// With none (every midnight is ahead), the first. The midnights are the
/// web view's (the Mac's local days); the shell never works out a date.
pub fn day_start(midnights: &[u64], now: u64) -> u64 {
    midnights
        .iter()
        .copied()
        .filter(|&m| m <= now)
        .max()
        .or_else(|| midnights.first().copied())
        .unwrap_or(0)
}

/// A group id as `blocker_configure` and the file accept it: 1–64 characters
/// of `[A-Za-z0-9-]` (a UUID fits).
pub fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Milliseconds in front, by `(day start, group id)`.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Usage(BTreeMap<(u64, String), u64>);

impl Usage {
    pub fn add(&mut self, day: u64, id: &str, ms: u64) {
        if ms == 0 {
            return;
        }
        let slot = self.0.entry((day, id.to_string())).or_insert(0);
        *slot = slot.saturating_add(ms);
    }

    pub fn used_ms(&self, day: u64, id: &str) -> u64 {
        self.0.get(&(day, id.to_string())).copied().unwrap_or(0)
    }

    /// Drop every other day. Whether anything went.
    pub fn prune(&mut self, day: u64) -> bool {
        let before = self.0.len();
        self.0.retain(|(d, _), _| *d == day);
        self.0.len() != before
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// D1: the allowance is used up. No allowance (`0`) never is.
pub fn exhausted(limit_ms: u64, used_ms: u64) -> bool {
    limit_ms > 0 && used_ms >= limit_ms
}

/// D5: this step crossed to five minutes or less left, with some still left,
/// on an allowance of more than five minutes.
pub fn warn_now(limit_ms: u64, before_ms: u64, after_ms: u64) -> bool {
    limit_ms > WARN_MS
        && after_ms < limit_ms
        && limit_ms - after_ms <= WARN_MS
        && limit_ms.saturating_sub(before_ms) > WARN_MS
}

/// Whether the whole-minute count changed: when the file is rewritten and,
/// with it, when the state JSON changes.
pub fn minute_changed(before_ms: u64, after_ms: u64) -> bool {
    before_ms / MINUTE_MS != after_ms / MINUTE_MS
}

/// The file: one line per entry, `day start` TAB `group id` TAB `ms`.
pub fn usage_text(usage: &Usage) -> String {
    usage
        .0
        .iter()
        .map(|((day, id), ms)| format!("{day}\t{id}\t{ms}\n"))
        .collect()
}

fn parse_line(line: &str) -> Option<(u64, &str, u64)> {
    let mut fields = line.trim_end_matches('\r').split('\t');
    let day = fields.next()?.parse().ok()?;
    let id = fields.next()?;
    let ms = fields.next()?.parse().ok()?;
    (fields.next().is_none() && valid_id(id)).then_some((day, id, ms))
}

/// Read the file back. A malformed line is skipped, never a panic.
pub fn parse_usage(text: &str) -> Usage {
    let mut usage = Usage::default();
    for (day, id, ms) in text.lines().filter_map(parse_line) {
        usage.add(day, id, ms);
    }
    usage
}

/// Rewrite the file from `usage`: a temp file in the same folder, then a
/// rename (the `sessions.rs` pattern). An empty map removes the file.
pub fn persist(file: &Path, usage: &Usage) -> Result<(), String> {
    if usage.is_empty() {
        return match std::fs::remove_file(file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    let dir = file.parent().ok_or("no folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{FILE_NAME}.tmp"));
    std::fs::write(&tmp, usage_text(usage)).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const D1: u64 = 1_800_000_000_000;
    const DAY: u64 = 24 * 60 * MINUTE_MS;
    const D2: u64 = D1 + DAY;
    const D3: u64 = D2 + DAY;

    // ---- day_start ----

    #[test]
    fn day_start_before_the_first_is_the_first() {
        assert_eq!(day_start(&[D1, D2, D3], D1 - 1), D1);
    }

    #[test]
    fn day_start_between_two_is_the_earlier() {
        assert_eq!(day_start(&[D1, D2, D3], D2 - 1), D1);
        assert_eq!(day_start(&[D1, D2, D3], D2 + 1), D2);
    }

    #[test]
    fn day_start_exactly_on_one_is_that_one() {
        assert_eq!(day_start(&[D1, D2, D3], D2), D2);
    }

    #[test]
    fn day_start_past_the_last_is_the_last() {
        assert_eq!(day_start(&[D1, D2, D3], D3 + 9 * DAY), D3);
    }

    #[test]
    fn day_start_with_no_midnights_is_zero() {
        assert_eq!(day_start(&[], D1), 0);
    }

    // ---- Usage ----

    #[test]
    fn add_sums_by_day_and_group() {
        let mut u = Usage::default();
        assert_eq!(u.used_ms(D1, "a"), 0);
        u.add(D1, "a", 2_000);
        u.add(D1, "a", 5_000);
        u.add(D1, "b", 1_000);
        u.add(D2, "a", 9_000);
        assert_eq!(u.used_ms(D1, "a"), 7_000);
        assert_eq!(u.used_ms(D1, "b"), 1_000);
        assert_eq!(u.used_ms(D2, "a"), 9_000);
        // Nothing added, nothing kept.
        let mut empty = Usage::default();
        empty.add(D1, "a", 0);
        assert!(empty.is_empty());
    }

    #[test]
    fn prune_drops_other_days() {
        let mut u = Usage::default();
        u.add(D1, "a", 1_000);
        u.add(D2, "a", 2_000);
        u.add(D2, "b", 3_000);
        assert!(u.prune(D2));
        assert_eq!(u.used_ms(D1, "a"), 0);
        assert_eq!(u.used_ms(D2, "a"), 2_000);
        assert_eq!(u.used_ms(D2, "b"), 3_000);
        assert!(!u.prune(D2));
        assert!(u.prune(D3));
        assert!(u.is_empty());
    }

    // ---- exhausted ----

    #[test]
    fn exhausted_from_the_limit_on() {
        let limit = 30 * MINUTE_MS;
        assert!(!exhausted(limit, limit - 1));
        assert!(exhausted(limit, limit));
        assert!(exhausted(limit, limit + 1));
    }

    #[test]
    fn exhausted_never_without_a_limit() {
        assert!(!exhausted(0, 0));
        assert!(!exhausted(0, 99 * MINUTE_MS));
    }

    // ---- warn_now ----

    #[test]
    fn warn_now_when_the_step_crosses_five_minutes_left() {
        let limit = 30 * MINUTE_MS;
        let edge = limit - WARN_MS;
        assert!(warn_now(limit, edge - 1, edge));
        assert!(warn_now(limit, edge - 2_000, edge + 3_000));
        // Not yet there.
        assert!(!warn_now(limit, edge - 5_000, edge - 1));
    }

    #[test]
    fn warn_now_false_once_inside() {
        let limit = 30 * MINUTE_MS;
        let edge = limit - WARN_MS;
        assert!(!warn_now(limit, edge, edge + 2_000));
        assert!(!warn_now(limit, edge + 2_000, edge + 4_000));
    }

    #[test]
    fn warn_now_never_for_a_five_minute_allowance() {
        let limit = 5 * MINUTE_MS;
        assert!(!warn_now(limit, 0, 2_000));
        assert!(!warn_now(2 * MINUTE_MS, 0, 2_000));
        // Six minutes: at one minute used.
        assert!(warn_now(6 * MINUTE_MS, MINUTE_MS - 1, MINUTE_MS));
    }

    #[test]
    fn warn_now_false_at_the_limit() {
        let limit = 30 * MINUTE_MS;
        assert!(!warn_now(limit, limit - WARN_MS - 1, limit));
        assert!(!warn_now(limit, limit - WARN_MS - 1, limit + 1));
    }

    #[test]
    fn minute_changed_on_a_whole_minute_only() {
        assert!(!minute_changed(0, MINUTE_MS - 1));
        assert!(minute_changed(MINUTE_MS - 1, MINUTE_MS));
        assert!(!minute_changed(MINUTE_MS, MINUTE_MS + 5_000));
    }

    // ---- the file's text ----

    #[test]
    fn usage_text_is_one_tab_separated_line_per_entry() {
        let mut u = Usage::default();
        u.add(D2, "b-2", 61_000);
        u.add(D1, "a-1", 120_000);
        assert_eq!(
            usage_text(&u),
            format!("{D1}\ta-1\t120000\n{D2}\tb-2\t61000\n")
        );
        assert_eq!(usage_text(&Usage::default()), "");
    }

    #[test]
    fn usage_round_trips() {
        let mut u = Usage::default();
        u.add(D1, "0b9c2d2e-7c1a-4f0e-9d53-1c2f3a4b5c6d", 1_234_567);
        u.add(D1, "b", 1);
        u.add(D2, "b", 86_400_000);
        assert_eq!(parse_usage(&usage_text(&u)), u);
        assert_eq!(parse_usage(""), Usage::default());
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let text = format!(
            "{D1}\tgood\t1000\n\
             not a line\n\
             {D1}\tgood\n\
             {D1}\tgood\t1000\textra\n\
             x\tgood\t1000\n\
             {D1}\tgood\t-5\n\
             {D1}\thttps://x.com/\t1000\n\
             {D1}\t\t1000\n\
             \n\
             {D1}\tother\t7\r\n"
        );
        let mut want = Usage::default();
        want.add(D1, "good", 1_000);
        want.add(D1, "other", 7);
        assert_eq!(parse_usage(&text), want);
    }

    #[test]
    fn valid_id_takes_letters_digits_and_hyphens() {
        assert!(valid_id("a"));
        assert!(valid_id("0b9c2d2e-7c1a-4f0e-9d53-1c2f3a4b5c6d"));
        assert!(valid_id(&"a".repeat(64)));
        for bad in ["", "a b", "a\tb", "a/b", "a.b", "é"] {
            assert!(!valid_id(bad), "{bad:?}");
        }
        assert!(!valid_id(&"a".repeat(65)));
    }

    // ---- the file ----

    #[test]
    fn the_file_is_written_whole_and_removed_when_empty() {
        let dir = std::env::temp_dir().join(format!("allowance-test-{}", std::process::id()));
        let file = dir.join("nested").join(FILE_NAME);
        let mut u = Usage::default();
        u.add(D1, "a", 120_000);
        persist(&file, &u).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), usage_text(&u));
        assert!(!file.with_file_name(format!(".{FILE_NAME}.tmp")).exists());
        persist(&file, &Usage::default()).unwrap();
        assert!(!file.exists());
        // Removing a file that is not there is fine.
        persist(&file, &Usage::default()).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }
}
