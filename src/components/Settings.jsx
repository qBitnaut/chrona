// Settings.jsx — the Chrona Settings window: custom themed title bar (frameless),
// a section nav on the left, controls on the right, following light/dark.
import React from "react";
import {
  TweakSection, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakButton,
} from "./controls.jsx";
import { ZONES, PHASES } from "./clock-widget.jsx";
import { useSettings } from "../lib/settings.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";

const SECTIONS = [
  { id: "general", label: "General", icon: "M3 5h14M3 10h14M3 15h9" },
  { id: "appearance", label: "Appearance", icon: "M10 2a8 8 0 100 16 3 3 0 003-3 2 2 0 012-2h0a3 3 0 003-3 8 8 0 00-11-5z" },
  { id: "glass", label: "Glass & Material", icon: "M4 4h12v12H4zM4 9h12M9 4v12" },
  { id: "clock", label: "Clock", icon: "M10 2a8 8 0 100 16 8 8 0 000-16zM10 6v4l3 2" },
  { id: "weather", label: "Location & Weather", icon: "M6 13a3 3 0 010-6 4 4 0 017.7 1.3A2.5 2.5 0 0114 13z" },
  { id: "zones", label: "World Clocks", icon: "M10 2a8 8 0 100 16 8 8 0 000-16zM2 10h16M10 2c2.5 2 2.5 14 0 16M10 2c-2.5 2-2.5 14 0 16" },
  { id: "preview", label: "Preview", icon: "M10 4C5 4 2 10 2 10s3 6 8 6 8-6 8-6-3-6-8-6zm0 4a2 2 0 100 4 2 2 0 000-4z" },
];

function NavIcon({ d }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZonePicker({ value, onChange }) {
  const sel = value || [];
  const toggle = (id) => {
    if (sel.includes(id)) onChange(sel.filter((z) => z !== id));
    else if (sel.length < 5) onChange([...sel, id]);
  };
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>Cities & zones</span><span className="twk-val">{sel.length}/5</span></div>
      <div className="zp-grid">
        {ZONES.map((z) => {
          const on = sel.includes(z.id);
          const dis = !on && sel.length >= 5;
          return (
            <button key={z.id} type="button" className="zp-chip" data-on={on ? 1 : 0}
                    disabled={dis} onClick={() => toggle(z.id)} title={z.city}>
              <b>{z.abbr}</b><span>{z.city}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LocationPicker({ place, onPick }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  const search = async () => {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    try {
      const r = await invoke("geocode_search", { query });
      setResults(r || []);
    } catch { setResults([]); }
    setBusy(false);
    setSearched(true);
  };

  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>Location</span><span className="twk-val">{place}</span></div>
      <div className="loc-search">
        <input className="twk-field" type="text" value={q} placeholder="Search a city…"
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
        <button className="twk-btn" onClick={search} disabled={busy}>{busy ? "…" : "Search"}</button>
      </div>
      {results.length > 0 && (
        <div className="loc-results">
          {results.map((r, i) => (
            <button key={i} type="button" className="loc-result"
                    onClick={() => { onPick(r); setResults([]); setQ(""); setSearched(false); }}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {searched && results.length === 0 && q.trim() && (
        <button type="button" className="loc-result"
                onClick={() => { onPick({ name: q.trim(), region: "", lat: null, lon: null }); setSearched(false); setQ(""); }}>
          Use “{q.trim()}” as typed
        </button>
      )}
    </div>
  );
}

function resolveDark(theme) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export default function Settings() {
  const [t, setTweak] = useSettings();
  const [active, setActive] = React.useState("general");
  const [version, setVersion] = React.useState("");
  React.useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);
  if (!t) return <div className="settings-shell" data-theme="dark" />;

  const set = (k) => (v) => setTweak(k, v);
  const dark = resolveDark(t.theme);
  const closeWin = () => getCurrentWindow().close();

  const sections = {
    general: (
      <>
        <TweakSection label="Startup & window" />
        <TweakToggle label="Run at startup" value={t.runAtStartup} onChange={set("runAtStartup")} />
        <TweakToggle label="Start hidden" value={t.startHidden} onChange={set("startHidden")} />
        <TweakToggle label="Show in taskbar" value={t.showInTaskbar} onChange={set("showInTaskbar")} />
        <TweakToggle label="Always on top" value={t.alwaysOnTop} onChange={set("alwaysOnTop")} />
        <TweakToggle label="Pin (lock position)" value={t.pinned} onChange={set("pinned")} />
        <TweakToggle label="Close to tray" value={t.closeToTray} onChange={set("closeToTray")} />
        <TweakToggle label="Pause animation on battery saver" value={t.pauseOnBattery} onChange={set("pauseOnBattery")} />
        <TweakToggle label="Automatic updates" value={t.autoUpdate} onChange={set("autoUpdate")} />
      </>
    ),
    appearance: (
      <>
        <TweakSection label="Theme & type" />
        <TweakRadio label="Theme" value={t.theme}
                    options={[{ value: "auto", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
                    onChange={set("theme")} />
        <TweakSelect label="Font" value={t.font} onChange={set("font")}
                     options={[
                       { value: "geometric", label: "Geometric · Jost" },
                       { value: "modern", label: "Modern · Sora" },
                       { value: "bold", label: "Bold · Space Grotesk" },
                       { value: "elegant", label: "Elegant · Cormorant" },
                       { value: "mono", label: "Technical · JetBrains" },
                     ]} />
        <TweakSelect label="Weight" value={t.weight} onChange={set("weight")}
                     options={[
                       { value: "thin", label: "Thin" }, { value: "light", label: "Light" },
                       { value: "regular", label: "Regular" }, { value: "medium", label: "Medium" },
                       { value: "bold", label: "Bold" },
                     ]} />
        <TweakSlider label="Widget size" value={t.size} min={40} max={140} unit="%" onChange={set("size")} />
      </>
    ),
    glass: (
      <>
        <TweakSection label="Backdrop & glass" />
        <TweakSelect label="Backdrop material" value={t.material} onChange={set("material")}
                     options={[
                       { value: "mica", label: "Mica · blurred wallpaper (Win11)" },
                       { value: "acrylic", label: "Acrylic · blurred apps behind" },
                       { value: "tabbed", label: "Mica Alt" },
                       { value: "glass", label: "Glass · adjustable corners (no blur)" },
                       { value: "none", label: "None (tint only)" },
                     ]} />
        <TweakSlider label="Widget opacity" value={t.widgetOpacity} min={30} max={100} unit="%" onChange={set("widgetOpacity")} />
        <TweakSlider label="Background opacity" value={t.bgOpacity} min={0} max={100} unit="%" onChange={set("bgOpacity")} />
        <TweakSlider label="Corner radius" value={t.radius} min={0} max={40} unit="px"
                     disabled={["mica", "acrylic", "tabbed"].includes(t.material)}
                     note="fixed (blur)" onChange={set("radius")} />
        <TweakToggle label="Mica grain texture" value={t.mica} onChange={set("mica")} />
      </>
    ),
    clock: (
      <>
        <TweakSection label="Time display" />
        <TweakRadio label="Format" value={t.h24 ? "24" : "12"}
                    options={[{ value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }]}
                    onChange={(v) => setTweak("h24", v === "24")} />
        <TweakToggle label="Show seconds" value={t.seconds} onChange={set("seconds")} />
        <TweakToggle label="Temp on date line" value={t.showTemp} onChange={set("showTemp")} />
      </>
    ),
    weather: (
      <>
        <TweakSection label="Location" />
        <TweakToggle label="Detect my location (IP)" value={t.detect} onChange={set("detect")} />
        {!t.detect && (
          <LocationPicker
            place={`${t.place}${t.region ? `, ${t.region}` : ""}`}
            onPick={(r) => setTweak({ place: r.name, region: r.region || "", lat: r.lat, lon: r.lon })} />
        )}
        <TweakRadio label="Units" value={t.units}
                    options={[{ value: "imperial", label: "°F · mph" }, { value: "metric", label: "°C · km/h" }]}
                    onChange={set("units")} />
        <TweakSection label="Data & display" />
        <TweakSlider label="Refresh interval" value={t.refreshMin} min={5} max={120} step={5} unit=" min"
                     onChange={set("refreshMin")} />
        <TweakSelect label="Animation level" value={t.animLevel} onChange={set("animLevel")}
                     options={[
                       { value: "off", label: "Off" }, { value: "low", label: "Low" },
                       { value: "med", label: "Medium" }, { value: "max", label: "Maximum" },
                     ]} />
        <TweakToggle label="Feels like temperature" value={t.showFeels} onChange={set("showFeels")} />
        <TweakToggle label="Show humidity" value={t.showHumidity} onChange={set("showHumidity")} />
        <TweakToggle label="Show wind speed" value={t.showWind} onChange={set("showWind")} />
        <TweakToggle label="Sunrise / sunset" value={t.showSun} onChange={set("showSun")} />
        <TweakToggle label="Show last updated" value={t.showUpdated} onChange={set("showUpdated")} />
      </>
    ),
    zones: (
      <>
        <TweakSection label="World clocks" />
        <TweakToggle label="Show zone row" value={t.showZones} onChange={set("showZones")} />
        {t.showZones && <>
          <ZonePicker value={t.zones} onChange={set("zones")} />
          <TweakSlider label="Time text size" value={t.zoneTimeScale} min={60} max={180} step={5} unit="%"
                       onChange={set("zoneTimeScale")} />
          <TweakToggle label="Seconds on zones" value={t.zoneSeconds} onChange={set("zoneSeconds")} />
        </>}
      </>
    ),
    preview: (
      <>
        <TweakSection label="Demo overrides" />
        <TweakSelect label="Weather" value={t.wxDemo} onChange={set("wxDemo")}
                     options={[
                       { value: "live", label: "Live data" }, { value: "clear", label: "Clear" },
                       { value: "partly", label: "Partly cloudy" }, { value: "overcast", label: "Overcast" },
                       { value: "fog", label: "Fog" }, { value: "drizzle", label: "Drizzle" },
                       { value: "rain", label: "Rain" }, { value: "heavy-rain", label: "Heavy rain" },
                       { value: "snow", label: "Snow" }, { value: "sleet", label: "Sleet" },
                       { value: "thunder", label: "Thunderstorm" }, { value: "windy", label: "Windy" },
                       { value: "icy", label: "Freeze warning" }, { value: "heat", label: "Heat advisory" },
                       { value: "tornado", label: "Tornado warning" }, { value: "flood", label: "Flood warning" },
                       { value: "blizzard", label: "Blizzard" },
                     ]} />
        <TweakRadio label="Day / night" value={t.dayNight}
                    options={[{ value: "auto", label: "Auto" }, { value: "day", label: "Day" }, { value: "night", label: "Night" }]}
                    onChange={set("dayNight")} />
        <TweakSelect label="Time of day" value={t.tod} onChange={set("tod")}
                     options={[{ value: "auto", label: "Auto (now)" }, ...PHASES.map((p) => ({ value: p.key, label: p.label }))]} />
        <TweakSection label="Maintenance" />
        <div style={{ display: "flex", gap: 8 }}>
          <TweakButton label="Reset position" secondary
                       onClick={() => invoke("reset_position").catch(() => {})} />
          <TweakButton label="Check for updates"
                       onClick={() => invoke("check_for_updates").catch(() => {})} />
        </div>
      </>
    ),
  };

  return (
    <div className="settings-shell" data-theme={dark ? "dark" : "light"}>
      <div className="title-bar" data-tauri-drag-region>
        <span className="tb-title" data-tauri-drag-region>Chrona — Settings</span>
        <button className="tb-close" onClick={closeWin} title="Close" aria-label="Close">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="settings-main">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="nav-item"
                    data-active={active === s.id ? 1 : 0}
                    onClick={() => setActive(s.id)}>
              <NavIcon d={s.icon} />
              <span>{s.label}</span>
            </button>
          ))}
          <div className="nav-version">Chrona{version ? ` v${version}` : ""}</div>
        </nav>
        <div className="settings-panel">
          {sections[active]}
        </div>
      </div>
    </div>
  );
}
