// actions.rs — the effectful side of settings: reading/writing the store,
// applying window effects (always-on-top, taskbar, pin), autostart, opening the
// settings window, and the small commands the frontend calls.

use tauri::menu::ContextMenu;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::weather;

pub const SETTINGS_CHANGED: &str = "settings-changed";
pub const MAIN_WINDOW: &str = "main";
pub const SETTINGS_WINDOW: &str = "settings";

// ── store helpers ────────────────────────────────────────────────────────────
pub fn get_bool(app: &AppHandle, key: &str, default: bool) -> bool {
    use tauri_plugin_store::StoreExt;
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

pub fn get_string(app: &AppHandle, key: &str, default: &str) -> String {
    use tauri_plugin_store::StoreExt;
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get(key))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| default.to_string())
}

pub fn get_number(app: &AppHandle, key: &str, default: f64) -> f64 {
    use tauri_plugin_store::StoreExt;
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get(key))
        .and_then(|v| v.as_f64())
        .unwrap_or(default)
}

/// (Re)apply the backdrop material (and, for glass/none, the rounded region).
pub fn apply_material(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let kind = get_string(app, "material", "mica");
        crate::window_fx::apply_material(&win, &kind, get_number(app, "radius", 18.0));
    }
}

/// Re-clip the widget to its corner radius (only for non-backdrop materials;
/// blur materials are DWM-rounded and ignore regions).
pub fn apply_region(app: &AppHandle) {
    let kind = get_string(app, "material", "mica");
    if crate::window_fx::is_backdrop(&kind) {
        return;
    }
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        crate::window_fx::apply_round_region(&win, get_number(app, "radius", 18.0));
    }
}

/// Persist a single boolean and broadcast it so every window + the settings
/// listener react. Mirrors the frontend's `setSetting`.
pub fn set_bool(app: &AppHandle, key: &str, val: bool) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        store.set(key, val);
        let _ = store.save();
    }
    let _ = app.emit(SETTINGS_CHANGED, serde_json::json!({ key: val }));
}

pub fn toggle_bool(app: &AppHandle, key: &str, default: bool) {
    let cur = get_bool(app, key, default);
    set_bool(app, key, !cur);
}

// ── window effects ───────────────────────────────────────────────────────────
/// Always-on-top is the union of an explicit "always on top" preference and the
/// pin (a pinned widget is always locked above the desktop).
pub fn apply_always_on_top(app: &AppHandle) {
    let pinned = get_bool(app, "pinned", false);
    let aot = get_bool(app, "alwaysOnTop", false);
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.set_always_on_top(pinned || aot);
    }
}

pub fn apply_taskbar(app: &AppHandle) {
    let show = get_bool(app, "showInTaskbar", false);
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.set_skip_taskbar(!show);
    }
}

pub fn apply_autostart(app: &AppHandle) {
    let enable = get_bool(app, "runAtStartup", false);
    let mgr = app.autolaunch();
    let _ = if enable { mgr.enable() } else { mgr.disable() };
}

/// Apply every persisted setting that has a native side effect. Called at
/// startup and whenever settings change.
pub fn apply_all(app: &AppHandle) {
    apply_always_on_top(app);
    apply_taskbar(app);
    apply_autostart(app);
}

// ── settings window ──────────────────────────────────────────────────────────
pub fn open_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SETTINGS_WINDOW) {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SETTINGS_WINDOW, WebviewUrl::App("settings.html".into()))
        .title("Chrona — Settings")
        .inner_size(620.0, 560.0)
        .min_inner_size(540.0, 460.0)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(false)
        .center()
        .build();
    if let Ok(win) = built {
        // opaque frameless panel with native DWM-rounded corners (no
        // transparency → no white edge leakage)
        crate::window_fx::dwm_round(&win);
    }
}

/// Persist the widget's position now (window-state plugin owns position; we own
/// width via the `size` setting + auto-fit height). Called on focus-loss,
/// close-to-tray, and quit so geometry survives even non-graceful exits.
pub fn save_geometry(app: &AppHandle) {
    let _ = app.save_window_state(StateFlags::POSITION);
}

pub fn toggle_visibility(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        if win.is_visible().unwrap_or(true) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

// ── commands ─────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn show_context_menu(app: AppHandle, window: tauri::Window) {
    if let Ok(menu) = crate::menu::build_context_menu(&app) {
        let _ = menu.popup(window);
    }
}

#[tauri::command]
pub fn reset_position(app: AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.center();
    }
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<bool, String> {
    crate::updater::check_and_install(app).await
}

/// React to a settings change coming from any window (the settings UI or a menu
/// toggle). Applies native effects and wakes the weather loop when needed.
pub fn on_settings_changed(app: &AppHandle, payload: &serde_json::Value) {
    let obj = match payload.as_object() {
        Some(o) => o,
        None => return,
    };
    for key in obj.keys() {
        match key.as_str() {
            "alwaysOnTop" | "pinned" => apply_always_on_top(app),
            "showInTaskbar" => apply_taskbar(app),
            "runAtStartup" => apply_autostart(app),
            "material" => apply_material(app),
            "radius" => apply_region(app),
            "detect" | "place" | "lat" | "lon" | "refreshMin" => weather::nudge_refresh(app),
            _ => {}
        }
    }
    // keep the tray menu's checkmarks in sync with the new state
    crate::menu::refresh_tray_menu(app);
}
