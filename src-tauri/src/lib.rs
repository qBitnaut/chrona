// lib.rs — Chrona's Tauri entrypoint: plugins, state, window material, tray,
// menus, the settings bridge, and the background weather loop.

mod actions;
mod menu;
mod updater;
mod weather;
mod window_fx;

use tauri::{Listener, Manager};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance MUST be registered first: a second launch focuses the
        // running widget instead of spawning a duplicate.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window(actions::MAIN_WINDOW) {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        // we own the window size (size% + auto-fit height); let the plugin own
        // only the position so it handles multi-monitor / DPI clamping.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(weather::WeatherState::new())
        .invoke_handler(tauri::generate_handler![
            weather::get_weather,
            weather::refresh_weather,
            weather::geocode_search,
            actions::show_context_menu,
            actions::reset_position,
            actions::check_for_updates,
        ])
        // context-menu (popup) events route here
        .on_menu_event(|app, event| menu::handle_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();

            // native backdrop material (Mica / Acrylic / Blur, from settings)
            actions::apply_material(&handle);

            // system tray
            menu::create_tray(&handle)?;

            // apply persisted native settings (always-on-top, taskbar, autostart)
            actions::apply_all(&handle);

            // honour "start hidden"
            if actions::get_bool(&handle, "startHidden", false) {
                if let Some(win) = app.get_webview_window(actions::MAIN_WINDOW) {
                    let _ = win.hide();
                }
            }

            // bridge: settings changes (from any window or menu) apply live
            let h = handle.clone();
            app.listen(actions::SETTINGS_CHANGED, move |event| {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    actions::on_settings_changed(&h, &payload);
                }
            });

            // background weather refresh (NWS + Open-Meteo)
            weather::spawn_refresh_loop(handle.clone());

            // automatic update check (best effort; gated by the autoUpdate setting)
            updater::check_on_startup(handle.clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle().clone();
            let label = window.label();
            match event {
                // re-clip the widget's rounded region whenever it resizes
                tauri::WindowEvent::Resized(_) => {
                    if label == actions::MAIN_WINDOW {
                        actions::apply_region(&app);
                    }
                }
                // closing the widget hides it to the tray (configurable)
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if label == actions::MAIN_WINDOW {
                        actions::save_geometry(&app);
                        if actions::get_bool(&app, "closeToTray", true) {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                }
                // persist position whenever the widget loses focus (covers
                // drag-to-move then click-away, even on non-graceful exits)
                tauri::WindowEvent::Focused(false) => {
                    if label == actions::MAIN_WINDOW {
                        actions::save_geometry(&app);
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Chrona");
}
