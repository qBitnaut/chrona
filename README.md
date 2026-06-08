# Chrona

A frameless, Mica-blurred desktop **clock + live-weather glass widget** for Windows,
built with **Tauri 2** (Rust backend) and a bundled **React + Canvas** frontend.

Left side: a large tabular clock. Right side: a living, animated weather scene
(sun, moon, clouds, rain/snow/sleet, fog, thunderstorm, and severe modes —
windy, freeze, heat, tornado, flood, blizzard). Below: a seamless stack of
world-clock rows. The whole card is translucent glass over a real native
backdrop material, with a time-of-day accent that shifts from dawn → night.

<p align="center">
  <img src="docs/screenshot.png" alt="Chrona widget — clock, weather, and time-of-day-tinted world clocks" width="320" />
</p>

---

## Features

- **Clock** — 12/24h, optional seconds, AM/PM, tabular figures (no jitter).
- **Live weather** — fetched natively in Rust. **NWS (api.weather.gov)** is the
  authoritative source in the US (current conditions + official severe-weather
  **alerts** that drive the tornado/flood/blizzard/ice/heat/wind scenes);
  **Open-Meteo** is the structured backbone (geocoding, hi/lo, sunrise/sunset,
  is-day) worldwide and the offline-graceful fallback. A mock payload keeps the
  UI alive when fully offline (a "Sample data" dot shows the state).
- **World clocks** — up to 5 zones; each row is washed in the accent of *its
  own* time of day (golden-hour amber, dusk pink, night blue, …), with an
  adjustable time-text size.
- **Readout strip** — Feels-like / humidity / wind / sunrise-sunset flow in a
  full-width row below the clock.
- **Location search** — type a city and pick the exact match (precise lat/lon),
  or use IP auto-detect.
- **Adaptive theme** — Auto / Light / Dark glass; accent + tint shift with time
  of day, modulated by weather.
- **Tunable** — adjustable corner radius (the real window corner is clipped to
  it), and an adjustable world-clock time-text size.
- **Translucent material** (in Settings) in two regimes:
  - **Mica / Acrylic / Mica Alt** — real DWM blur, no window chrome, corners
    fixed at the native ~8px (the radius slider is disabled, since a system
    backdrop can't take an arbitrary radius).
  - **Glass / None** — a transparent window clipped to a rounded **region** at
    the chosen corner radius (no blur, fully adjustable corners).
- **Themed Settings window** — opaque, frameless with a custom title bar, section
  nav on the left, native rounded corners, follows light/dark.
- **Frameless · transparent · draggable · resizable**; **pin** to lock position
  + always-on-top; position & size persist across launches and monitors.
- **Right-click context menu** + **system tray** (pin, settings, run at startup,
  always on top, reset position, show/hide, quit).
- **Settings window** (second WebviewWindow) — every option persisted to a JSON
  store and applied live across windows.
- **Run at startup**, **single instance**, **auto-update** (Tauri updater),
  **idle-friendly** (animations pause when the window is hidden).

---

## Prerequisites (Windows)

| Tool | Notes |
|------|-------|
| **Rust** (stable, MSVC) | `rustup default stable-x86_64-pc-windows-msvc` |
| **Visual Studio Build Tools** | "Desktop development with C++" (MSVC linker) |
| **Node 18+** & **pnpm** | `npm i -g pnpm` |
| **WebView2 Runtime** | Pre-installed on Win11; [Evergreen installer](https://developer.microsoft.com/microsoft-edge/webview2/) for Win10 |

> Mica needs **Windows 11**; on Windows 10 the app automatically falls back to
> Acrylic. Transparency/vibrancy is a no-op on non-Windows platforms.

---

## Develop

```powershell
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts Vite on `localhost:1420` and launches the widget against
it. (Running the compiled `src-tauri/target/debug/chrona.exe` directly also
expects that dev server — a plain `cargo build` is a *dev* profile build.)

## Build installers

```powershell
pnpm tauri build
```

Produces **MSI** and **NSIS** installers under
`src-tauri/target/release/bundle/`. The frontend is bundled to `dist/` first
(both `index.html` and `settings.html` entry points).

To re-generate icons after changing the art:

```powershell
node scripts/gen-icon.mjs        # writes icon-src.png
pnpm tauri icon icon-src.png     # regenerates src-tauri/icons/*
```

---

## Architecture

```
index.html / settings.html      two Vite entry points (widget + settings window)
src/
  main.jsx / settings-main.jsx   React roots
  styles.css / settings.css      ported prototype CSS (widget glass + controls)
  components/
    App.jsx                      widget composition, drag/resize, auto-fit height
    Settings.jsx                 settings UI (store-backed)
    clock-widget.jsx             theming, clock hook, tz formatting, presentational
    weather-fx.jsx               canvas particle systems + layered weather scenes
    controls.jsx                 reusable settings controls (sliders/toggles/etc.)
  lib/
    settings.js                  tauri-plugin-store wrapper + useSettings() hook
    weather.js                   useWeather() — talks to Rust over IPC + events
    window.js                    width<->size%, setSize, drag, context-menu helpers
src-tauri/
  src/
    lib.rs                       plugins, state, setup, window event wiring
    weather.rs                   NWS + Open-Meteo + IP geo, caching, refresh loop
    actions.rs                   settings effects, window control, commands
    menu.rs                      context menu + tray
    window_fx.rs                 Mica/Acrylic/Blur material (window-vibrancy)
    updater.rs                   updater wrapper
  tauri.conf.json                window (frameless/transparent), bundle, updater
  capabilities/default.json      IPC permissions
```

### Data flow

- The Rust **background task** (`spawn_refresh_loop`) fetches weather on the
  configured interval, caches it, and emits a `weather-updated` event. The
  frontend `useWeather()` hook renders pushes and can force `refresh_weather`.
- **Settings** live in `tauri-plugin-store` (`settings.json`). Any change (from
  the settings window *or* a menu toggle) broadcasts a `settings-changed` event;
  every window updates, and Rust applies native side effects (always-on-top,
  taskbar, autostart, backdrop material) and wakes the weather loop when
  location/units/interval change.
- **Window geometry**: position is persisted by `tauri-plugin-window-state`
  (saved on focus-loss, close-to-tray, and quit, so it survives non-graceful
  exits); width is persisted as the `size` setting; height auto-fits content.

### Persisted files

`%APPDATA%\com.chrona.widget\`
- `settings.json` — all user settings
- `.window-state.json` — window position

---

## Weather APIs & the NWS User-Agent

`api.weather.gov` **requires a descriptive `User-Agent` with contact info**. It is
set in `src-tauri/src/weather.rs`:

```rust
const USER_AGENT: &str = "Chrona/0.1 (https://github.com/qBitnaut/chrona)";
```

**Change the contact** if you fork/redistribute (a project URL is accepted; add
an email if you want NWS to be able to reach you). Endpoints used (all keyless):
Open-Meteo geocoding + forecast, NWS `points` / station observations / active
alerts, and `ipapi.co` for the optional IP-based "detect location" mode.

---

## Auto-update

A signing keypair was generated for the updater. The **public** key lives in
`tauri.conf.json` (`plugins.updater.pubkey`). The **private** key is at
`~/.tauri/chrona.key` — **keep it secret; never commit it.**

To ship updates:

1. Host a `latest.json` manifest + signed artifacts at the `endpoints` URL in
   `tauri.conf.json` (currently a GitHub Releases placeholder —
   `https://github.com/qBitnaut/chrona/releases/latest/download/latest.json`).
2. Sign the build by exporting the key before `pnpm tauri build`:
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\chrona.key" -Raw
   # $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<if you set one>"
   pnpm tauri build
   ```
   `createUpdaterArtifacts` is already enabled in the bundle config.

Generate a fresh keypair with `pnpm tauri signer generate -w <path>`.

The Settings window's **Check for updates** button calls the updater; it returns
gracefully (no crash) if the endpoint isn't reachable yet.

---

## Notes

- **Single instance**: launching a second copy focuses the running widget.
- **Close to tray**: the window's close button hides to the tray instead of
  quitting (toggle in Settings); Quit (menu/tray) exits fully.
- **Run at startup** registers/unregisters the HKCU run entry via
  `tauri-plugin-autostart` (default off).
- The original HTML/Canvas prototype that this UI was ported from lives in
  `Clock Desktop/` (not part of the build).
