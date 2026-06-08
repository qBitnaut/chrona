// updater.rs — automatic (silent) update on launch + a manual "Check for
// updates" flow that prompts with current/new version and Install Now / Later.

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// On launch: if automatic updates are enabled, quietly check, download, install
/// the latest signed bundle and relaunch. Best effort; no-ops if the endpoint is
/// unreachable or there's nothing newer.
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

/// Manual check (from Settings): prompt the user with current + available
/// version and let them Install Now or Do it Later. Spawns so the command
/// returns immediately.
#[tauri::command]
pub fn check_for_updates(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let current = app.package_info().version.to_string();

        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                show_info(&app, MessageDialogKind::Error, "Update check failed",
                    &format!("Couldn't start the updater.\n\n{e}"));
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let new_v = update.version.clone();
                let app2 = app.clone();
                app.dialog()
                    .message(format!(
                        "Chrona {new_v} is available.\nYou have {current}.\n\nInstall it now? \
                         Chrona will briefly restart."
                    ))
                    .title("Update available")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Install Now".to_string(),
                        "Do it Later".to_string(),
                    ))
                    .show(move |install_now| {
                        if install_now {
                            tauri::async_runtime::spawn(async move {
                                if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                                    app2.restart();
                                }
                            });
                        }
                    });
            }
            Ok(None) => show_info(&app, MessageDialogKind::Info, "You're up to date",
                &format!("Chrona {current} is the latest version.")),
            Err(e) => show_info(&app, MessageDialogKind::Error, "Update check failed",
                &format!("Couldn't check for updates.\n\n{e}")),
        }
    });
}

fn show_info(app: &AppHandle, kind: MessageDialogKind, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .show(|_| {});
}
