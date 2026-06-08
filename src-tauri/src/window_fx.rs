// window_fx.rs — translucent material + corners, the reliable way.
//
// Two regimes, because Windows can't blur AND clip to an arbitrary radius:
//   • Blur materials (Mica / Mica Alt / Acrylic): the modern DWM system-backdrop.
//     Real blur, NO window chrome, corners fixed at DWM's ~8px round. (The
//     legacy composition-attribute acrylic is avoided — it exposes a caption bar
//     and a square backdrop on focus.)
//   • Glass / None: a plain transparent window clipped to a rounded *region* at
//     the user's chosen radius. No native blur, but the corner tracks the slider.

use tauri::WebviewWindow;

#[cfg(windows)]
mod win {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::WebviewWindow;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMSBT_NONE, DWMWA_SYSTEMBACKDROP_TYPE,
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND,
    };
    use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};

    type Hwnd = *mut core::ffi::c_void;

    fn hwnd(window: &WebviewWindow) -> Option<Hwnd> {
        match window.window_handle().ok()?.as_raw() {
            RawWindowHandle::Win32(w) => Some(w.hwnd.get() as Hwnd),
            _ => None,
        }
    }

    fn set_attr(h: Hwnd, attr: u32, value: i32) {
        unsafe {
            DwmSetWindowAttribute(
                h,
                attr,
                &value as *const i32 as *const core::ffi::c_void,
                core::mem::size_of::<i32>() as u32,
            );
        }
    }

    pub fn apply_region(window: &WebviewWindow, radius_logical: f64) {
        let Some(h) = hwnd(window) else { return };
        let Ok(size) = window.inner_size() else { return };
        let scale = window.scale_factor().unwrap_or(1.0);
        let r = ((radius_logical * scale).round() as i32).max(0);
        let w = size.width as i32;
        let ht = size.height as i32;
        if w <= 0 || ht <= 0 {
            return;
        }
        unsafe {
            let rgn = CreateRoundRectRgn(0, 0, w + 1, ht + 1, r * 2, r * 2);
            SetWindowRgn(h, rgn, 1);
        }
    }

    /// Modern system backdrop (real blur, no chrome). DWM rounds the corners
    /// (~8px); any window region is removed.
    pub fn apply_backdrop(window: &WebviewWindow, sbt: i32) {
        let Some(h) = hwnd(window) else { return };
        unsafe {
            SetWindowRgn(h, core::ptr::null_mut(), 1);
        }
        set_attr(h, DWMWA_SYSTEMBACKDROP_TYPE as u32, sbt);
        set_attr(h, DWMWA_WINDOW_CORNER_PREFERENCE as u32, DWMWCP_ROUND);
    }

    /// No backdrop — clip the transparent window to a rounded region at `radius`.
    pub fn apply_glass(window: &WebviewWindow, radius: f64) {
        let Some(h) = hwnd(window) else { return };
        set_attr(h, DWMWA_SYSTEMBACKDROP_TYPE as u32, DWMSBT_NONE);
        set_attr(h, DWMWA_WINDOW_CORNER_PREFERENCE as u32, DWMWCP_DONOTROUND);
        apply_region(window, radius);
    }

    /// Native DWM rounded corners for an opaque window (settings panel).
    pub fn dwm_round(window: &WebviewWindow) {
        if let Some(h) = hwnd(window) {
            set_attr(h, DWMWA_WINDOW_CORNER_PREFERENCE as u32, DWMWCP_ROUND);
        }
    }
}

pub const BACKDROP_KINDS: [&str; 3] = ["mica", "acrylic", "tabbed"];
pub fn is_backdrop(kind: &str) -> bool {
    BACKDROP_KINDS.contains(&kind)
}

#[cfg(windows)]
pub fn apply_material(window: &WebviewWindow, kind: &str, radius: f64) {
    use windows_sys::Win32::Graphics::Dwm::{
        DWMSBT_MAINWINDOW, DWMSBT_TABBEDWINDOW, DWMSBT_TRANSIENTWINDOW,
    };
    match kind {
        "mica" => win::apply_backdrop(window, DWMSBT_MAINWINDOW),
        "tabbed" => win::apply_backdrop(window, DWMSBT_TABBEDWINDOW),
        "acrylic" => win::apply_backdrop(window, DWMSBT_TRANSIENTWINDOW),
        _ => win::apply_glass(window, radius), // glass | none
    }
    eprintln!("[chrona] material: {kind}");
}

#[cfg(windows)]
pub fn apply_round_region(window: &WebviewWindow, radius: f64) {
    win::apply_region(window, radius);
}

#[cfg(windows)]
pub fn dwm_round(window: &WebviewWindow) {
    win::dwm_round(window);
}

#[cfg(not(windows))]
pub fn apply_material(_window: &WebviewWindow, _kind: &str, _radius: f64) {}
#[cfg(not(windows))]
pub fn apply_round_region(_window: &WebviewWindow, _radius: f64) {}
#[cfg(not(windows))]
pub fn dwm_round(_window: &WebviewWindow) {}
