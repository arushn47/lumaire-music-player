use serde::{Deserialize, Serialize};
use std::{sync::{Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::Duration};
use tauri::{Emitter, Manager, State, WebviewWindow};

const LABEL: &str = "lyrics-overlay";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    title: String,
    artist: String,
    status: String,
    message: String,
    lines: Vec<Line>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Line {
    text: String,
    secondary: String,
    active: bool,
}

impl Snapshot {
    fn validate(&self) -> Result<(), String> {
        if self.lines.len() > 3
            || [&self.title, &self.artist, &self.status, &self.message]
                .iter().any(|text| text.len() > 4096)
            || self.lines.iter().any(|line| line.text.len() > 8192 || line.secondary.len() > 8192)
        {
            return Err("Floating lyric content exceeds its display limits.".into());
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct Overlay {
    snapshot: Mutex<Snapshot>,
    locked: AtomicBool,
    hovered: AtomicBool,
    shortcut: AtomicBool,
    generation: AtomicU64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { open: bool, locked: bool, hovered: bool, shortcut_available: bool }

fn status(app: &tauri::AppHandle, open: bool) {
    let state = app.state::<Overlay>();
    for label in ["main", LABEL] {
        let _ = app.emit_to(label, "lyric-overlay-status", Status { open, locked: open && state.locked.load(Ordering::SeqCst),
            hovered: state.hovered.load(Ordering::SeqCst), shortcut_available: state.shortcut.load(Ordering::SeqCst) });
    }
}

fn set_locked(window: &WebviewWindow, locked: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(locked).map_err(|e| e.to_string())?;
    if let Err(error) = window.set_focusable(!locked) {
        let _ = window.set_ignore_cursor_events(!locked);
        return Err(error.to_string());
    }
    window.state::<Overlay>().locked.store(locked, Ordering::SeqCst);
    status(window.app_handle(), true);
    Ok(())
}

fn pointer_region(x: f64, y: f64, width: f64, height: f64) -> (bool, bool) {
    let hovered = x >= 0.0 && y >= 0.0 && x < width && y < height;
    (hovered, hovered && x >= width - 54.0 && x < width - 6.0 && (6.0..50.0).contains(&y))
}

fn watch_overlay(app: tauri::AppHandle) {
    let generation = app.state::<Overlay>().generation.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        use windows_sys::Win32::{Foundation::POINT, UI::{Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT}, WindowsAndMessaging::{GetCursorPos, PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY}}};
        let state = app.state::<Overlay>();
        let mut registered = false;
        for _ in 0..10 {
            if state.generation.load(Ordering::SeqCst) != generation { return; }
            // A thread-owned hotkey needs no keyboard hook and is released when the overlay closes.
            registered = unsafe { RegisterHotKey(std::ptr::null_mut(), 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, u32::from(b'L')) != 0 };
            if registered { break; }
            std::thread::sleep(Duration::from_millis(80));
        }
        state.shortcut.store(registered, Ordering::SeqCst);
        status(&app, true);
        let mut ignored = None;
        while state.generation.load(Ordering::SeqCst) == generation {
            let Some(window) = app.get_webview_window(LABEL) else { break; };
            let mut message: MSG = unsafe { std::mem::zeroed() };
            while unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), WM_HOTKEY, WM_HOTKEY, PM_REMOVE) } != 0 {
                if let Err(error) = set_locked(&window, !state.locked.load(Ordering::SeqCst)) { let _ = app.emit_to(LABEL, "lyric-overlay-error", error); }
                ignored = None;
            }
            let locked = state.locked.load(Ordering::SeqCst);
            if locked {
                let mut point = POINT { x: 0, y: 0 };
                let region = if unsafe { GetCursorPos(&mut point) } != 0 {
                    match (window.outer_position(), window.inner_size(), window.scale_factor()) {
                        (Ok(position), Ok(size), Ok(scale)) => pointer_region(f64::from(point.x - position.x) / scale, f64::from(point.y - position.y) / scale, f64::from(size.width) / scale, f64::from(size.height) / scale),
                        _ => (false, false),
                    }
                } else { (false, false) };
                let ignore = !region.1;
                if ignored != Some(ignore) {
                    if let Err(error) = window.set_ignore_cursor_events(ignore) { let _ = app.emit_to(LABEL, "lyric-overlay-error", error.to_string()); }
                    ignored = Some(ignore);
                }
                if state.hovered.swap(region.0, Ordering::SeqCst) != region.0 { status(&app, true); }
            } else {
                if ignored != Some(false) { let _ = window.set_ignore_cursor_events(false); ignored = Some(false); }
                state.hovered.store(false, Ordering::SeqCst);
            }
            std::thread::sleep(Duration::from_millis(80));
        }
        if registered { unsafe { UnregisterHotKey(std::ptr::null_mut(), 1); } }
    });
}

#[tauri::command]
pub fn lyric_overlay_publish(window: WebviewWindow, state: State<Overlay>, snapshot: Snapshot) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the player can publish lyrics.".into()); }
    snapshot.validate()?;
    *state.snapshot.lock().map_err(|_| "Floating lyric state is unavailable.")? = snapshot.clone();
    window.app_handle().emit_to(LABEL, "lyric-overlay-state", snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lyric_overlay_control(window: WebviewWindow, state: State<'_, Overlay>, action: String) -> Result<Snapshot, String> {
    let main = window.label() == "main";
    if !main && window.label() != LABEL { return Err("Unknown window.".into()); }
    let app = window.app_handle();
    match action.as_str() {
        "open" if main => {
            if let Some(overlay) = app.get_webview_window(LABEL) {
                set_locked(&overlay, false)?;
                overlay.show().map_err(|e| e.to_string())?;
                status(app, true);
            } else {
                #[allow(unused_mut)]
                let mut builder = tauri::WebviewWindowBuilder::new(app, LABEL,
                    tauri::WebviewUrl::App("index.html?overlay=lyrics".into()))
                    .title("Lumaire · Floating lyrics").inner_size(440.0, 116.0)
                    .min_inner_size(280.0, 72.0).decorations(false).transparent(true)
                    .shadow(false).always_on_top(true).skip_taskbar(true)
                    .resizable(true).focused(false).visible(false);
                #[cfg(debug_assertions)]
                if let Some(root) = std::env::var_os("LUMAIRE_DATA_DIR") {
                    builder = builder.data_directory(std::path::PathBuf::from(root).join("webview"));
                }
                builder.build().map_err(|e| e.to_string())?;
                state.locked.store(false, Ordering::SeqCst);
                state.hovered.store(false, Ordering::SeqCst);
                watch_overlay(app.clone());
                status(app, true);
            }
        }
        "ready" if !main => { window.show().map_err(|e| e.to_string())?; status(app, true); }
        "close" => {
            if let Some(overlay) = app.get_webview_window(LABEL) { overlay.destroy().map_err(|e| e.to_string())?; }
        }
        "lock" if !main => {
            set_locked(&window, true)?;
        }
        "unlock" if !main => set_locked(&window, false)?,
        "toggle" | "previous" | "next" if !main => {
            app.emit_to("main", "lyric-overlay-action", &action).map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported floating lyric action.".into()),
    }
    state.snapshot.lock().map(|value| value.clone()).map_err(|_| "Floating lyric state is unavailable.".into())
}

pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if matches!(event, tauri::WindowEvent::Destroyed) {
        if window.label() == "main" {
            if let Some(overlay) = window.app_handle().get_webview_window(LABEL) { let _ = overlay.destroy(); }
        } else if window.label() == LABEL {
            window.state::<Overlay>().generation.fetch_add(1, Ordering::SeqCst);
            status(window.app_handle(), false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_overlay_content() {
        let mut snapshot = Snapshot::default();
        assert!(snapshot.validate().is_ok());
        snapshot.title = "x".repeat(4097);
        assert!(snapshot.validate().is_err());
        snapshot.title.clear();
        snapshot.lines = (0..4).map(|_| Line { text: "line".into(), secondary: String::new(), active: false }).collect();
        assert!(snapshot.validate().is_err());
    }
    #[test]
    fn only_the_corner_accepts_clicks_while_locked() {
        assert_eq!(pointer_region(200.0, 100.0, 460.0, 260.0), (true, false));
        assert_eq!(pointer_region(430.0, 25.0, 460.0, 260.0), (true, true));
        assert_eq!(pointer_region(-1.0, 25.0, 460.0, 260.0), (false, false));
        assert_eq!(pointer_region(460.0, 25.0, 460.0, 260.0), (false, false));
    }
}
