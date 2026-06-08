// updater.rs — thin wrapper around tauri-plugin-updater. Returns Ok(true) when
// an update was found and installed, Ok(false) when up to date, Err on failure
// (including "updater not configured", so the UI can surface it gracefully).

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

pub async fn check_and_install(app: AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// On launch: if automatic updates are enabled, quietly check, download, install
/// the latest signed bundle and relaunch. No-ops (best effort) if the endpoint
/// is unreachable or there's nothing newer.
pub fn check_on_startup(app: AppHandle) {
    if !crate::actions::get_bool(&app, "autoUpdate", true) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else { return };
        if let Ok(Some(update)) = updater.check().await {
            if update
                .download_and_install(|_, _| {}, || {})
                .await
                .is_ok()
            {
                app.restart();
            }
        }
    });
}
