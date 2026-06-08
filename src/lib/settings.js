// settings.js — single source of truth for user settings, persisted via
// tauri-plugin-store (a JSON file on disk), shared live across the widget and
// settings windows. Replaces the prototype's localStorage / host-protocol hook.
import React from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

export const STORE_FILE = "settings.json";
export const SETTINGS_CHANGED = "settings-changed";

// Defaults mirror the prototype, plus the production "General" keys.
export const DEFAULTS = {
  // Appearance
  theme: "auto",          // auto | light | dark
  font: "geometric",      // geometric | modern | bold | elegant | mono
  weight: "light",        // thin | light | regular | medium | bold
  size: 82,               // widget size %
  widgetOpacity: 100,
  bgOpacity: 42,
  blur: 24,
  radius: 18,
  mica: true,
  material: "mica",      // mica | acrylic | blur | none (native backdrop)
  // Clock
  h24: false,
  seconds: true,
  showTemp: true,
  // Location & weather
  detect: false,
  place: "Fort Worth",
  region: "TX",
  lat: null,            // set when a precise location is picked from search
  lon: null,
  units: "imperial",      // imperial | metric
  refreshMin: 30,
  animLevel: "max",       // off | low | med | max
  showFeels: false,
  showHumidity: false,
  showWind: true,
  showSun: true,
  showUpdated: true,
  // World clocks
  showZones: true,
  zones: ["UTC"],
  zoneSeconds: true,
  zoneTimeScale: 100,   // % size of the world-clock time text
  // Preview / demo overrides
  wxDemo: "live",
  dayNight: "auto",
  tod: "auto",
  // General (production)
  runAtStartup: false,
  startHidden: false,
  showInTaskbar: false,
  alwaysOnTop: false,
  pinned: false,
  closeToTray: true,
  pauseOnBattery: true,
  autoUpdate: true,
};

let _storePromise = null;
function store() {
  if (!_storePromise) _storePromise = load(STORE_FILE, { autoSave: false });
  return _storePromise;
}

// Read every key, layering stored values over the defaults.
export async function loadSettings() {
  const s = await store();
  const out = { ...DEFAULTS };
  const entries = await s.entries();
  for (const [k, v] of entries) {
    if (k in DEFAULTS) out[k] = v;
  }
  return out;
}

// Persist one or many keys, then broadcast so every window + the Rust backend
// react in lockstep. Accepts setSetting('key', val) or setSetting({k: v, ...}).
export async function setSetting(keyOrEdits, val) {
  const edits = typeof keyOrEdits === "object" && keyOrEdits !== null
    ? keyOrEdits : { [keyOrEdits]: val };
  const s = await store();
  for (const [k, v] of Object.entries(edits)) await s.set(k, v);
  await s.save();
  await emit(SETTINGS_CHANGED, edits);
}

// React hook: load once, then stay in sync with broadcasts from any window.
export function useSettings() {
  const [settings, setSettings] = React.useState(null);

  React.useEffect(() => {
    let un = null, alive = true;
    loadSettings().then((s) => { if (alive) setSettings(s); });
    listen(SETTINGS_CHANGED, (e) => {
      if (alive && e.payload) setSettings((prev) => ({ ...(prev || DEFAULTS), ...e.payload }));
    }).then((u) => { un = u; if (!alive) u(); });
    return () => { alive = false; if (un) un(); };
  }, []);

  return [settings, setSetting];
}
