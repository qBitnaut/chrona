// menu.rs — the right-click context menu and the system-tray icon/menu.

use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::actions;

pub const TRAY_ID: &str = "main-tray";

// item ids (shared by context menu + tray)
const ID_PIN: &str = "pin";
const ID_SETTINGS: &str = "settings";
const ID_AUTOSTART: &str = "autostart";
const ID_AOT: &str = "always_on_top";
const ID_RESET: &str = "reset_position";
const ID_TOGGLE: &str = "toggle_visibility";
const ID_QUIT: &str = "quit";

// ── right-click context menu (rebuilt each time so checkmarks are fresh) ─────
pub fn build_context_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let pinned = actions::get_bool(app, "pinned", false);
    let autostart = actions::get_bool(app, "runAtStartup", false);
    let aot = actions::get_bool(app, "alwaysOnTop", false);

    let pin = CheckMenuItemBuilder::with_id(ID_PIN, "Pin to desktop")
        .checked(pinned)
        .build(app)?;
    let settings = MenuItemBuilder::with_id(ID_SETTINGS, "Settings…").build(app)?;
    let run = CheckMenuItemBuilder::with_id(ID_AUTOSTART, "Run at startup")
        .checked(autostart)
        .build(app)?;
    let on_top = CheckMenuItemBuilder::with_id(ID_AOT, "Always on top")
        .checked(aot)
        .build(app)?;
    let reset = MenuItemBuilder::with_id(ID_RESET, "Reset position").build(app)?;
    let quit = MenuItemBuilder::with_id(ID_QUIT, "Quit").build(app)?;

    MenuBuilder::new(app)
        .item(&pin)
        .item(&settings)
        .item(&run)
        .item(&on_top)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&reset)
        .item(&quit)
        .build()
}

// ── system tray ──────────────────────────────────────────────────────────────
fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let pinned = actions::get_bool(app, "pinned", false);
    let autostart = actions::get_bool(app, "runAtStartup", false);

    let toggle = MenuItemBuilder::with_id(ID_TOGGLE, "Show / Hide widget").build(app)?;
    let settings = MenuItemBuilder::with_id(ID_SETTINGS, "Settings…").build(app)?;
    let pin = CheckMenuItemBuilder::with_id(ID_PIN, "Pin to desktop")
        .checked(pinned)
        .build(app)?;
    let run = CheckMenuItemBuilder::with_id(ID_AUTOSTART, "Run at startup")
        .checked(autostart)
        .build(app)?;
    let quit = MenuItemBuilder::with_id(ID_QUIT, "Quit").build(app)?;

    MenuBuilder::new(app)
        .item(&toggle)
        .item(&settings)
        .item(&pin)
        .item(&run)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;
    // NOTE: no .on_menu_event here — menu events are handled by the single
    // global handler (Builder::on_menu_event). Registering it here too made
    // every menu event fire twice (toggles cancelled themselves out).
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Chrona")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            // left-click toggles the widget's visibility
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                actions::toggle_visibility(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// Rebuild the tray menu so its checkmarks track the current settings.
pub fn refresh_tray_menu(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

// ── shared menu-event handler (context menu + tray) ──────────────────────────
pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        ID_PIN => actions::toggle_bool(app, "pinned", false),
        ID_SETTINGS => actions::open_settings(app),
        ID_AUTOSTART => actions::toggle_bool(app, "runAtStartup", false),
        ID_AOT => actions::toggle_bool(app, "alwaysOnTop", false),
        ID_RESET => {
            if let Some(win) = app.get_webview_window(actions::MAIN_WINDOW) {
                let _ = win.center();
            }
        }
        ID_TOGGLE => actions::toggle_visibility(app),
        ID_QUIT => {
            actions::save_geometry(app);
            app.exit(0);
        }
        _ => {}
    }
}
