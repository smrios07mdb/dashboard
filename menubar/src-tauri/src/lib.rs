//! Hupomnemata menu bar companion — the macOS shell (chunk 91).
//!
//! One tray icon, one frameless popover window. The web view (`menubar/src`)
//! owns everything the user reads; this file owns what only the shell can do:
//! the tray and its title, showing / hiding / placing / sizing the window,
//! opening the dashboard and quitting. The global hotkey (chunk 93) is
//! registered from the web view through `tauri-plugin-global-shortcut`; the
//! shell only places and shows the window for it (`show_popover`).
//!
//! Commands are named in `menubar/src/native.ts` — keep the two in step.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewWindow,
    WindowEvent,
};

const TRAY_ID: &str = "main";
const WINDOW: &str = "main";
const DASHBOARD_URL: &str = "https://smrios07mdb.github.io/dashboard/";

/// Popover width in points; the web view's card is the same width.
const WIDTH: f64 = 340.0;
const MIN_HEIGHT: f64 = 60.0;
const MAX_HEIGHT: f64 = 560.0;
/// Gap between the menu bar and the popover, in points.
const GAP: f64 = 4.0;
/// Keep the popover this far from a screen edge, in points.
const EDGE: f64 = 8.0;
/// The menu bar's height, in points — only for the no-tray-rect fallback.
const MENU_BAR: f64 = 24.0;

/// A click on the tray icon while the popover is open reaches us as a blur
/// (which hides it) followed by the click. Without this the click would
/// re-open what the blur just closed.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

#[derive(Default)]
struct Popover {
    hidden_by_blur_at: Mutex<Option<Instant>>,
    /// The tray icon's rect from the last click — the hotkey's fallback when
    /// the tray API gives none.
    last_tray_rect: Mutex<Option<Rect>>,
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW)
}

fn hide(app: &AppHandle) {
    if let Some(w) = window(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            let _ = app.emit("popover-hidden", ());
        }
    }
}

/// Put the window under the tray icon, centred on it, inside its screen.
fn place_under(w: &WebviewWindow, tray: &Rect) {
    // The tray rect arrives in physical pixels; scale 1.0 is the identity for
    // that case, and `monitor_from_point` then gives the real factor.
    let at: PhysicalPosition<f64> = tray.position.to_physical(1.0);
    let size = tray.size.to_physical::<f64>(1.0);
    let monitor = w.monitor_from_point(at.x, at.y).ok().flatten();
    let scale = monitor
        .as_ref()
        .map(|m| m.scale_factor())
        .or_else(|| w.scale_factor().ok())
        .unwrap_or(1.0);

    let width = WIDTH * scale;
    let mut x = at.x + size.width / 2.0 - width / 2.0;
    if let Some(m) = monitor.as_ref() {
        let left = m.position().x as f64 + EDGE * scale;
        let right = m.position().x as f64 + m.size().width as f64 - EDGE * scale - width;
        x = x.clamp(left, right.max(left));
    }
    let y = at.y + size.height + GAP * scale;
    let _ = w.set_position(PhysicalPosition::new(x.round(), y.round()));
}

fn show(app: &AppHandle, tray: &Rect) {
    if let Some(w) = window(app) {
        place_under(&w, tray);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("popover-shown", ());
    }
}

fn toggle(app: &AppHandle, tray: &Rect) {
    let Some(w) = window(app) else { return };
    if w.is_visible().unwrap_or(false) {
        hide(app);
        return;
    }
    let just_closed = app
        .state::<Popover>()
        .hidden_by_blur_at
        .lock()
        .ok()
        .and_then(|mut at| at.take())
        .is_some_and(|at| at.elapsed() < REOPEN_GUARD);
    if !just_closed {
        show(app, tray);
    }
}

/// Where the popover goes when no click says: the tray icon's rect, else the
/// last rect a click gave, else the top-right corner of the main display.
fn tray_rect(app: &AppHandle, w: &WebviewWindow) -> Option<Rect> {
    if let Some(rect) = app
        .tray_by_id(TRAY_ID)
        .and_then(|t| t.rect().ok().flatten())
    {
        return Some(rect);
    }
    if let Some(rect) = app
        .state::<Popover>()
        .last_tray_rect
        .lock()
        .ok()
        .and_then(|r| *r)
    {
        return Some(rect);
    }
    let m = w.primary_monitor().ok().flatten()?;
    let scale = m.scale_factor();
    let right = m.position().x as f64 + m.size().width as f64 - EDGE * scale;
    Some(Rect {
        position: PhysicalPosition::new(right, m.position().y as f64).into(),
        size: PhysicalSize::new(0.0, MENU_BAR * scale).into(),
    })
}

/// Show the popover under the tray icon without a click (the hotkey, D6).
/// Already shown: it only takes focus.
#[tauri::command]
fn show_popover(app: AppHandle) -> Result<(), String> {
    let w = window(&app).ok_or("no window")?;
    if w.is_visible().unwrap_or(false) {
        return w.set_focus().map_err(|e| e.to_string());
    }
    let rect = tray_rect(&app, &w).ok_or("no tray rect")?;
    show(&app, &rect);
    Ok(())
}

/// The tray title: the open Today count. Anything but a short number is
/// dropped — the web view is the only caller, but the bar is not its to fill.
#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("no tray icon")?;
    let title = title.trim();
    let ok = !title.is_empty() && title.len() <= 4 && title.bytes().all(|b| b.is_ascii_digit());
    tray.set_title(if ok { Some(title) } else { None })
        .map_err(|e| e.to_string())
}

/// Size the window to the card's height, clamped.
#[tauri::command]
fn set_popover_height(app: AppHandle, height: f64) -> Result<(), String> {
    let w = window(&app).ok_or("no window")?;
    if !height.is_finite() {
        return Err("bad height".into());
    }
    w.set_size(LogicalSize::new(WIDTH, height.clamp(MIN_HEIGHT, MAX_HEIGHT)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_popover(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
fn popover_is_shown(app: AppHandle) -> bool {
    window(&app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Open the live dashboard in the default browser. The URL is fixed here; the
/// web view cannot ask for another.
#[tauri::command]
fn open_dashboard(app: AppHandle) -> Result<(), String> {
    hide(&app);
    std::process::Command::new("/usr/bin/open")
        .arg(DASHBOARD_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .manage(Popover::default())
        .invoke_handler(tauri::generate_handler![
            set_tray_title,
            set_popover_height,
            hide_popover,
            show_popover,
            popover_is_shown,
            open_dashboard,
            quit_app
        ])
        .on_window_event(|w, event| {
            // Hidden on blur (D7).
            if let WindowEvent::Focused(false) = event {
                if w.label() == WINDOW && w.is_visible().unwrap_or(false) {
                    let app = w.app_handle();
                    if let Ok(mut at) = app.state::<Popover>().hidden_by_blur_at.lock() {
                        *at = Some(Instant::now());
                    }
                    hide(app);
                }
            }
        })
        .setup(|app| {
            // No Dock icon, no app switcher entry (D7). Info.plist's
            // LSUIElement covers launch; this covers `tauri dev`.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // The scratchpad hotkey (chunk 93). Bindings are registered from
            // the web view (`menubar/src/hotkeys.ts`), never chosen here.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .tooltip("Hupomnemata")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Ok(mut last) = app.state::<Popover>().last_tray_rect.lock() {
                            *last = Some(rect);
                        }
                        toggle(app, &rect);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Hupomnemata menu bar app");
}
