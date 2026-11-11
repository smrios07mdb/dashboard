//! Open at login (chunk 97, D12): a LaunchAgent plist written by the shell.
//!
//! No crate, no plugin, no `launchctl`, no AppleScript. On writes
//! `~/Library/LaunchAgents/net.mdblabs.hupomnemata.menubar.plist`, which
//! macOS reads at the next login and runs `/usr/bin/open -a <this bundle>`;
//! off removes it. That file is the only one the shell ever writes.
//!
//! The top half is pure and tested: finding the bundle from the binary's
//! path, the plist text, reading the bundle path back, and the state JSON.
//! Known limit: switching the item off in System Settings leaves the file in
//! place, so the switch still reads on (detecting that needs `SMAppService`).

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tauri::ipc::Response;

use crate::pomodoro::json_string;

/// The bundle id, and the LaunchAgent's `Label`.
pub const LABEL: &str = "net.mdblabs.hupomnemata.menubar";
const FILE_NAME: &str = "net.mdblabs.hupomnemata.menubar.plist";
const OPEN: &str = "/usr/bin/open";

/// The nearest ancestor of the running binary whose name ends in `.app`;
/// `None` outside a bundle (`tauri dev`, `cargo run`).
pub fn bundle_path(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.len() > 4 && n.ends_with(".app"))
        })
        .map(Path::to_path_buf)
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

/// The inverse of `xml_escape` (and only of it): `&amp;` last, so `&amp;lt;`
/// reads back as `&lt;`.
fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// The LaunchAgent, written by hand. `open -a` starts the app the way a
/// double-click does, so macOS treats it as a normal launch.
pub fn plist_text(bundle: &Path) -> String {
    let path = xml_escape(&bundle.to_string_lossy());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{OPEN}</string>
		<string>-a</string>
		<string>{path}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
</dict>
</plist>
"#
    )
}

/// The `<string>` values in `text`, in order.
fn strings(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("<string>") {
        rest = &rest[start + "<string>".len()..];
        let Some(end) = rest.find("</string>") else { break };
        out.push(&rest[..end]);
        rest = &rest[end + "</string>".len()..];
    }
    out
}

/// The bundle path from a plist this file wrote; `None` for anything else.
pub fn parse_program(text: &str) -> Option<String> {
    let label = text.split("<key>Label</key>").nth(1)?;
    if strings(label).first() != Some(&LABEL) {
        return None;
    }
    let args = text.split("<key>ProgramArguments</key>").nth(1)?;
    let args = args.trim_start().strip_prefix("<array>")?;
    let args = &args[..args.find("</array>")?];
    match strings(args).as_slice() {
        [open, a, path] if *open == OPEN && *a == "-a" && !path.is_empty() => {
            Some(xml_unescape(path))
        }
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Status {
    /// The file names this bundle.
    On(String),
    Off,
    /// The file names another path (`None`: a file this app did not write).
    Other(Option<String>),
    /// This binary is not inside a `.app` (a dev run).
    Unavailable,
}

/// What the switch shows, from this bundle and the file's text (if any).
pub fn status(bundle: Option<&Path>, file: Option<&str>) -> Status {
    let Some(bundle) = bundle else {
        return Status::Unavailable;
    };
    let Some(text) = file else { return Status::Off };
    let ours = bundle.to_string_lossy();
    match parse_program(text) {
        Some(p) if p == ours => Status::On(p),
        other => Status::Other(other),
    }
}

/// `{ "status": "on" | "off" | "other" | "unavailable", "path": string|null }`.
pub fn state_json(s: &Status) -> String {
    let (name, path) = match s {
        Status::On(p) => ("on", Some(p.as_str())),
        Status::Off => ("off", None),
        Status::Other(p) => ("other", p.as_deref()),
        Status::Unavailable => ("unavailable", None),
    };
    let path = path.map_or_else(|| "null".to_string(), json_string);
    format!(r#"{{"status":"{name}","path":{path}}}"#)
}

// ---- glue: the one file ----

fn agent_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no HOME")?;
    Ok(PathBuf::from(home).join("Library").join("LaunchAgents"))
}

fn current_bundle() -> Option<PathBuf> {
    std::env::current_exe().ok().as_deref().and_then(bundle_path)
}

fn read_status() -> Result<Status, String> {
    let bundle = current_bundle();
    if bundle.is_none() {
        return Ok(Status::Unavailable);
    }
    let file = agent_dir()?.join(FILE_NAME);
    let text = match std::fs::read_to_string(&file) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    Ok(status(bundle.as_deref(), text.as_deref()))
}

/// Write the file for `bundle`: a temp file in the same folder, then a rename,
/// so a half-written plist is never read at login.
fn write_agent(bundle: &Path) -> Result<(), String> {
    let dir = agent_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{FILE_NAME}.tmp"));
    std::fs::write(&tmp, plist_text(bundle)).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(FILE_NAME)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Off: the file goes. A missing file is not an error.
fn remove_agent() -> Result<(), String> {
    match std::fs::remove_file(agent_dir()?.join(FILE_NAME)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn login_item_state() -> Result<Response, String> {
    read_status().map(|s| Response::new(state_json(&s)))
}

/// On writes the file for this bundle (replacing one for another copy); off
/// removes it. Rejected with `unavailable` outside a bundle.
#[tauri::command]
pub fn login_item_set(on: bool) -> Result<Response, String> {
    let bundle = current_bundle().ok_or("unavailable")?;
    if on {
        write_agent(&bundle)?;
    } else {
        remove_agent()?;
    }
    login_item_state()
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: &str = "/Users/s/Applications/Hupomnemata.app";

    #[test]
    fn bundle_path_finds_the_app() {
        let exe = Path::new("/Applications/Hupomnemata.app/Contents/MacOS/hupomnemata-menubar");
        assert_eq!(
            bundle_path(exe),
            Some(PathBuf::from("/Applications/Hupomnemata.app"))
        );
    }

    #[test]
    fn bundle_path_takes_the_nearest_app() {
        // A helper app nested inside another bundle.
        let exe = Path::new(
            "/Applications/Outer.app/Contents/Library/Hupomnemata.app/Contents/MacOS/hupomnemata-menubar",
        );
        assert_eq!(
            bundle_path(exe),
            Some(PathBuf::from(
                "/Applications/Outer.app/Contents/Library/Hupomnemata.app"
            ))
        );
    }

    #[test]
    fn bundle_path_none_outside_a_bundle() {
        let exe = Path::new("/Users/s/dashboard/menubar/src-tauri/target/debug/hupomnemata-menubar");
        assert_eq!(bundle_path(exe), None);
        assert_eq!(bundle_path(Path::new("/x/.app/bin")), None);
    }

    #[test]
    fn plist_text_golden() {
        let want = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>net.mdblabs.hupomnemata.menubar</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/open</string>
		<string>-a</string>
		<string>/Users/s/Applications/Hupomnemata.app</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
</dict>
</plist>
"#;
        assert_eq!(plist_text(Path::new(APP)), want);
    }

    #[test]
    fn plist_text_escapes_the_path() {
        let spaced = plist_text(Path::new("/Users/s/My Apps/Hupomnemata.app"));
        assert!(spaced.contains("<string>/Users/s/My Apps/Hupomnemata.app</string>"));
        let amp = plist_text(Path::new("/Users/s/R&D <new>/Hupomnemata.app"));
        assert!(amp.contains("<string>/Users/s/R&amp;D &lt;new&gt;/Hupomnemata.app</string>"));
        assert!(!amp.contains("R&D"));
    }

    #[test]
    fn parse_program_round_trips() {
        for p in [APP, "/Users/s/My Apps/Hupomnemata.app", "/Users/s/R&D &amp; 'x'/H.app"] {
            assert_eq!(parse_program(&plist_text(Path::new(p))).as_deref(), Some(p));
        }
    }

    #[test]
    fn parse_program_rejects_a_foreign_plist() {
        let other_label = plist_text(Path::new(APP)).replace(LABEL, "com.example.other");
        assert_eq!(parse_program(&other_label), None);
        let other_program = plist_text(Path::new(APP)).replace("/usr/bin/open", "/bin/sh");
        assert_eq!(parse_program(&other_program), None);
        let four_args = plist_text(Path::new(APP)).replace(
            "<string>-a</string>",
            "<string>-a</string>\n\t\t<string>-g</string>",
        );
        assert_eq!(parse_program(&four_args), None);
        assert_eq!(parse_program(""), None);
        assert_eq!(parse_program("not a plist"), None);
    }

    #[test]
    fn status_for_each_case() {
        let ours = Path::new(APP);
        let text = plist_text(ours);
        assert_eq!(status(Some(ours), Some(&text)), Status::On(APP.into()));
        assert_eq!(status(Some(ours), None), Status::Off);
        let theirs = plist_text(Path::new("/Applications/Hupomnemata.app"));
        assert_eq!(
            status(Some(ours), Some(&theirs)),
            Status::Other(Some("/Applications/Hupomnemata.app".into()))
        );
        assert_eq!(status(Some(ours), Some("junk")), Status::Other(None));
        assert_eq!(status(None, Some(&text)), Status::Unavailable);
        assert_eq!(status(None, None), Status::Unavailable);
    }

    #[test]
    fn state_json_for_each_status() {
        assert_eq!(
            state_json(&Status::On(APP.into())),
            r#"{"status":"on","path":"/Users/s/Applications/Hupomnemata.app"}"#
        );
        assert_eq!(state_json(&Status::Off), r#"{"status":"off","path":null}"#);
        assert_eq!(
            state_json(&Status::Other(Some("/A \"b\".app".into()))),
            r#"{"status":"other","path":"/A \"b\".app"}"#
        );
        assert_eq!(state_json(&Status::Other(None)), r#"{"status":"other","path":null}"#);
        assert_eq!(
            state_json(&Status::Unavailable),
            r#"{"status":"unavailable","path":null}"#
        );
    }
}
