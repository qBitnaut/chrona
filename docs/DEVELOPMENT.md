# Chrona — Development

Built with **Tauri 2** (Rust backend) and a bundled **React + Canvas** frontend
(ported from the original HTML/Canvas prototype). System WebView2 frontend,
small release binary, low idle CPU/RAM (animations pause when hidden).

## Prerequisites (Windows)

| Tool | Notes |
|------|-------|
| **Rust** (stable, MSVC) | `rustup default stable-x86_64-pc-windows-msvc` |
| **Visual Studio Build Tools** | "Desktop development with C++" (MSVC linker) |
| **Bun** | [bun.com](https://bun.com) — the JS runtime / package manager |
| **WebView2 Runtime** | Preinstalled on Win11; [Evergreen installer](https://developer.microsoft.com/microsoft-edge/webview2/) for Win10 |

> Mica needs **Windows 11**; on Windows 10 the app falls back to Acrylic.
> Vibrancy is a no-op on non-Windows platforms.

## Develop

```powershell
bun install
bun run tauri dev
```

`bun run tauri dev` starts Vite on `localhost:1420` and launches the widget
against it.

## Build installers

```powershell
bun run tauri build
```

Produces **MSI** + **NSIS** installers under
`src-tauri/target/release/bundle/`. The frontend bundles to `dist/` first (two
entry points: `index.html` for the widget, `settings.html` for the settings
window).

Regenerate icons after changing the art:

```powershell
bun scripts/gen-icon.mjs          # writes icon-src.png
bun run tauri icon icon-src.png   # regenerates src-tauri/icons/*
```

## Architecture

```
index.html / settings.html      two Vite entry points (widget + settings window)
src/
  main.jsx / settings-main.jsx   React roots
  styles.css / settings.css      widget glass + settings control styles
  components/
    App.jsx                      widget composition, drag/resize, auto-fit height
    Settings.jsx                 settings UI (store-backed)
    clock-widget.jsx             theming, clock hook, tz formatting, presentational
    weather-fx.jsx               canvas particle systems + layered weather scenes
    controls.jsx                 reusable settings controls
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
    window_fx.rs                 Mica/Acrylic material + rounded-corner region
    updater.rs                   update check / auto-update
  tauri.conf.json                window config, bundle, updater
  capabilities/default.json      IPC permissions
.github/workflows/release.yml    tagged-release build + publish
```

### Data flow

- A Rust **background task** (`spawn_refresh_loop`) fetches weather on the
  configured interval, caches it, and emits a `weather-updated` event. The
  frontend `useWeather()` hook renders the pushes and can force a refresh.
- **Settings** live in `tauri-plugin-store` (`settings.json`). Any change (from
  the settings window or a menu toggle) broadcasts a `settings-changed` event;
  every window updates and Rust applies native side effects (material,
  always-on-top, taskbar, autostart) and wakes the weather loop when
  location/units/interval change.
- **Window geometry**: position is persisted by `tauri-plugin-window-state`
  (saved on focus-loss / close-to-tray / quit); width is the `size` setting;
  height auto-fits content.

### Materials & corners

- **Mica / Acrylic / Mica Alt** use the modern DWM system-backdrop (real blur,
  no window chrome) with DWM-rounded corners (~8px); the corner-radius slider is
  disabled for these.
- **Glass / None** use a transparent window clipped to a rounded **region** at
  the chosen radius (no blur, adjustable corners).

### Persisted files

`%APPDATA%\com.chrona.widget\`
- `settings.json` — all user settings
- `.window-state.json` — window position

## Weather APIs & the NWS User-Agent

`api.weather.gov` requires a descriptive `User-Agent` with contact info. It's set
in `src-tauri/src/weather.rs`:

```rust
const USER_AGENT: &str = "Chrona/0.1 (https://github.com/qBitnaut/chrona)";
```

A project URL is accepted; add an email if you want NWS to be able to reach you.
Endpoints used (all keyless): Open-Meteo geocoding + forecast, NWS points /
station observations / active alerts, and `ipapi.co` for optional IP-based
"detect location".

## Releasing & auto-update

Releases are produced by **`.github/workflows/release.yml`** on any `v*` tag:

```powershell
# bump version in package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
git tag v0.1.1
git push origin v0.1.1
```

The workflow builds on Windows, signs the bundles with the updater key, and
publishes a GitHub Release (MSI + NSIS + `latest.json`).

### Signing key

A minisign keypair signs update artifacts:

- **Public key** lives in `tauri.conf.json` → `plugins.updater.pubkey`.
- **Private key** is at `~/.tauri/chrona.key` — **keep it secret; never commit
  it.** It's stored as the repo secret **`TAURI_SIGNING_PRIVATE_KEY`** so CI can
  sign. (The key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is
  unset/empty.)

Generate a fresh keypair with `bun run tauri signer generate -w <path>`.

### How updates reach users

The app checks `plugins.updater.endpoints`
(`https://github.com/qBitnaut/chrona/releases/latest/download/latest.json`),
and if a newer signed version exists it downloads and installs the new bundle in
place, then relaunches. The "Automatic updates" setting (default on) runs this on
launch; the Settings → "Check for updates" button does it manually.
