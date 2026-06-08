// clock-widget.jsx — theming, clock hook, timezone formatting, widget pieces.
// Ported from the prototype to an ES module. The live-weather data hook now
// lives in ../lib/weather.js (it talks to the Rust backend over IPC); this file
// keeps the pure presentational + theming logic.
import React from "react";
import { WeatherScene, conditionLabel } from "./weather-fx.jsx";

// ── Time-of-day phases ───────────────────────────────────────────────────────
export const PHASES = [
  { key: "night",     range: [0, 5],   label: "Night" },
  { key: "dawn",      range: [5, 7],   label: "Dawn" },
  { key: "sunrise",   range: [7, 9],   label: "Sunrise" },
  { key: "morning",   range: [9, 11],  label: "Morning" },
  { key: "midday",    range: [11, 15], label: "Midday" },
  { key: "afternoon", range: [15, 17], label: "Afternoon" },
  { key: "golden",    range: [17, 19], label: "Golden hour" },
  { key: "dusk",      range: [19, 21], label: "Dusk" },
  { key: "evening",   range: [21, 24], label: "Evening" },
];

const THEME = {
  night:     { wall: ["#0a0f24", "#141a36", "#070b1c"], bloom: "#2a3566", accent: "#8a9bff", day: false },
  dawn:      { wall: ["#241f44", "#5e3f63", "#c08a6e"], bloom: "#7a5a8e", accent: "#ff9e7a", day: false },
  sunrise:   { wall: ["#4a5ea0", "#d98f70", "#ffd29a"], bloom: "#ffc98a", accent: "#ff9a4e", day: true },
  morning:   { wall: ["#5a93d6", "#9cc6ee", "#d7eafb"], bloom: "#eaf5ff", accent: "#2f7fd8", day: true },
  midday:    { wall: ["#3f86dd", "#74b8f3", "#c6e6ff"], bloom: "#ffffff", accent: "#1f74d8", day: true },
  afternoon: { wall: ["#5a98d4", "#9ec3e6", "#ecd3a6"], bloom: "#fff0d0", accent: "#ef9a36", day: true },
  golden:    { wall: ["#b78858", "#e07e48", "#a8506e"], bloom: "#ffcf8a", accent: "#ff7e44", day: true },
  dusk:      { wall: ["#332e5e", "#6f4474", "#c86e60"], bloom: "#9a5a7e", accent: "#ff7686", day: false },
  evening:   { wall: ["#12173400", "#222855", "#0c1026"], bloom: "#2c3566", accent: "#94a3ff", day: false },
};

export function phaseForHour(h) {
  return (PHASES.find((p) => h >= p.range[0] && h < p.range[1]) || PHASES[0]).key;
}

// Per-zone tone — the time-of-day accent for a timezone's current local hour, so
// each world-clock row can take on the feel of its own time of day.
export function zoneTone(tzId, date) {
  const hour = parseInt(fmtTimeParts(date, { tz: tzId, h24: true }).hour, 10);
  const base = THEME[phaseForHour(Number.isFinite(hour) ? hour : 0)] || THEME.midday;
  return { accent: base.accent, isDay: base.day };
}

// Mix two hex colors
function mix(a, b, t) {
  const pa = a.replace("#", ""), pb = b.replace("#", "");
  const ca = [0, 2, 4].map((i) => parseInt(pa.slice(i, i + 2) || "0", 16));
  const cb = [0, 2, 4].map((i) => parseInt(pb.slice(i, i + 2) || "0", 16));
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
function desat(hex, amt) {
  const p = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(p.slice(i, i + 2) || "0", 16));
  const g = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const o = c.map((v) => Math.round(v + (g - v) * amt));
  return "#" + o.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// resolveTheme — phase + weather → wallpaper + accent + dark flag
export function resolveTheme(phaseKey, condition, isDay) {
  const base = THEME[phaseKey] || THEME.midday;
  let wall = base.wall.slice();
  let bloom = base.bloom;
  let accent = base.accent;

  const wet = ["rain", "heavy-rain", "drizzle", "flood"].includes(condition);
  const grey = ["overcast", "fog", "windy"].includes(condition);
  const snowy = ["snow", "sleet", "blizzard", "icy"].includes(condition);

  if (condition === "thunder" || condition === "tornado") {
    wall = wall.map((c) => mix(c, "#161a2c", 0.5));
    accent = desat(mix(accent, "#9aa2b4", 0.35), 0.25);
  } else if (wet) {
    wall = wall.map((c) => desat(mix(c, "#2b3346", 0.32), 0.45));
    bloom = desat(mix(bloom, "#3a4459", 0.4), 0.5);
    accent = mix(desat(accent, 0.25), "#6ea8d8", 0.35);
  } else if (grey) {
    wall = wall.map((c) => desat(mix(c, "#5a6472", 0.3), 0.5));
    bloom = desat(bloom, 0.55);
    accent = desat(accent, 0.3);
  } else if (snowy) {
    wall = wall.map((c) => mix(c, "#cdd8e6", 0.28));
    bloom = mix(bloom, "#eef4fb", 0.4);
    accent = mix(accent, "#8fb6e8", 0.42);
  } else if (condition === "heat") {
    accent = mix(accent, "#ff6a30", 0.55);
  }

  const grad =
    `radial-gradient(120% 90% at 72% 8%, ${bloom}cc 0%, transparent 46%),` +
    `radial-gradient(90% 80% at 12% 96%, ${wall[0]}aa 0%, transparent 55%),` +
    `linear-gradient(155deg, ${wall[0]} 0%, ${wall[1]} 52%, ${wall[2]} 100%)`;

  return { grad, accent, dark: !isDay, wall };
}

// ── Multi-timezone catalog ────────────────────────────────────────────────────
export const ZONES = [
  { id: "UTC",                 abbr: "Z",   city: "Zulu / UTC" },
  { id: "America/Los_Angeles", abbr: "LAX", city: "Los Angeles" },
  { id: "America/Denver",      abbr: "DEN", city: "Denver" },
  { id: "America/Chicago",     abbr: "CHI", city: "Chicago" },
  { id: "America/New_York",    abbr: "NYC", city: "New York" },
  { id: "America/Sao_Paulo",   abbr: "SAO", city: "São Paulo" },
  { id: "Europe/London",       abbr: "LON", city: "London" },
  { id: "Europe/Paris",        abbr: "PAR", city: "Paris" },
  { id: "Europe/Moscow",       abbr: "MOW", city: "Moscow" },
  { id: "Asia/Dubai",          abbr: "DXB", city: "Dubai" },
  { id: "Asia/Kolkata",        abbr: "DEL", city: "India" },
  { id: "Asia/Singapore",      abbr: "SIN", city: "Singapore" },
  { id: "Asia/Tokyo",          abbr: "TYO", city: "Tokyo" },
  { id: "Australia/Sydney",    abbr: "SYD", city: "Sydney" },
];
export const zoneById = (id) => ZONES.find((z) => z.id === id);

// ── Time formatting ───────────────────────────────────────────────────────────
export function fmtTimeParts(date, { tz, h24, seconds }) {
  const opts = { hour: "numeric", minute: "2-digit", hour12: !h24 };
  if (seconds) opts.second = "2-digit";
  if (tz && tz !== "local") opts.timeZone = tz;
  const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(date);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return {
    hour: get("hour"), minute: get("minute"), second: get("second"),
    period: get("dayPeriod"),
  };
}

// ── Clock hook (ticks ~4x/second, pauses when the window is hidden) ───────────
export function useClock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    let raf;
    const tick = () => {
      if (!document.hidden) setNow(new Date());
      raf = setTimeout(tick, 250);
    };
    raf = setTimeout(tick, 250);
    return () => clearTimeout(raf);
  }, []);
  return now;
}

// ── Mock data (used until the first live payload arrives / offline fallback) ──
export const MOCK = {
  place: "Fort Worth", region: "TX",
  tempF: 81, feelsLikeF: 84, hiF: 88, loF: 67, code: 2, condition: "partly", isDay: true,
  humidity: 41, windMph: 9, sunrise: "6:21 AM", sunset: "8:34 PM",
  updated: Date.now(), mock: true,
};

// ── Presentational: big time ──────────────────────────────────────────────────
export function TimeBlock({ now, h24, seconds }) {
  const p = fmtTimeParts(now, { h24, seconds });
  const showSide = seconds || (!h24 && p.period);
  return (
    <div className="time">
      <span className="time-hm">
        <span className="t-h">{p.hour}</span>
        <span className="t-colon">:</span>
        <span className="t-m">{p.minute}</span>
      </span>
      {showSide && (
        <span className="time-side">
          {!h24 && p.period && <span className="time-period">{p.period}</span>}
          {seconds && <span className="time-sec">{p.second}</span>}
        </span>
      )}
    </div>
  );
}

// tiny line icons
const WxIcon = ({ kind }) => {
  const c = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  if (kind === "humidity") return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path {...c} d="M8 2.2C8 2.2 3.8 7 3.8 10A4.2 4.2 0 0 0 12.2 10C12.2 7 8 2.2 8 2.2Z" /></svg>);
  if (kind === "wind") return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path {...c} d="M2 5.5h7.2a2 2 0 1 0-2-2M2 10h9.5a2.1 2.1 0 1 1-2.1 2.1" /></svg>);
  if (kind === "sunrise") return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path {...c} d="M2 13h12M8 9.5a3 3 0 0 1 3 3H5a3 3 0 0 1 3-3ZM8 6.5V3.2M5.4 5.4 4 4M10.6 5.4 12 4" /></svg>);
  if (kind === "sunset") return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path {...c} d="M2 13h12M8 9.5a3 3 0 0 1 3 3H5a3 3 0 0 1 3-3ZM8 3v3.3M5.4 6.6 4 8M10.6 6.6 12 8" /></svg>);
  if (kind === "feels") return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path {...c} d="M9.4 8.6V4.1a1.6 1.6 0 0 0-3.2 0v4.5a3 3 0 1 0 3.2 0ZM7.8 6.3v3.4" /></svg>);
  return null;
};

export function MetaLine({ now, place, region, tempF, useC, showTemp }) {
  const wd = now.toLocaleDateString("en-US", { weekday: "short" });
  const dd = now.toLocaleDateString("en-US", { day: "2-digit" });
  const mo = now.toLocaleDateString("en-US", { month: "short" });
  const temp = useC ? Math.round((tempF - 32) * 5 / 9) : tempF;
  return (
    <div className="meta">
      <span className="meta-main">
        <span className="meta-date">{wd}, {dd} {mo}</span>
        <span className="meta-sep">·</span>
        {place}{region ? `, ${region}` : ""}
      </span>
      {showTemp && <span className="meta-temp">{temp}°</span>}
    </div>
  );
}

// ── Presentational: world-clock extension cards (below the widget) ───────────
export function TZExt({ now, zoneIds, seconds, accent }) {
  if (!zoneIds || !zoneIds.length) return null;
  return (
    <div className="tz-ext">
      {zoneIds.map((id) => {
        const z = zoneById(id);
        if (!z) return null;
        const p = fmtTimeParts(now, { tz: z.id, h24: true, seconds });
        const isZulu = z.id === "UTC";
        const t = `${p.hour}:${p.minute}${seconds ? ":" + p.second : ""}${isZulu ? "Z" : ""}`;
        const tone = zoneTone(z.id, now);
        return (
          <div className={`tzx-card${isZulu ? " tzx-zulu" : ""}`} key={id}
               data-day={tone.isDay ? 1 : 0} style={{ "--za": tone.accent }}>
            <span className="tzx-tab">{z.abbr}</span>
            <span className="tzx-time">{t}</span>
            <span className="tzx-city">{z.city}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Presentational: weather block (scene + temp/condition/hi-lo) ──────────────
export function WeatherBlock({ condition, isDay, level, dark, accent, data, useC, flash }) {
  const conv = (f) => useC ? Math.round((f - 32) * 5 / 9) : f;
  return (
    <div className="weather">
      <div className="wx-stage">
        <WeatherScene condition={condition} isDay={isDay} level={level} dark={dark} flash={flash} />
      </div>
      <div className="wx-info">
        <div className="wx-temp" style={{ "--ac": accent }}>
          {conv(data.tempF)}<span className="wx-deg">°</span>
        </div>
        <div className="wx-cond">{conditionLabel(condition, isDay)}</div>
        <div className="wx-hilo">
          <span className="wx-hi">H {conv(data.hiF)}°</span>
          <span className="wx-lo">L {conv(data.loF)}°</span>
        </div>
      </div>
    </div>
  );
}

// ── Presentational: full-width readout strip (feels / humidity / wind / sun) ──
// Flows horizontally across the whole card so the narrow weather column stays
// uncluttered; wraps onto more lines only when it truly runs out of width.
export function WxStats({ data, useC, opts, isDay }) {
  if (!(opts.showFeels || opts.showHumidity || opts.showWind || opts.showSun)) return null;
  const conv = (f) => useC ? Math.round((f - 32) * 5 / 9) : f;
  const wind = opts.units === "metric" ? `${Math.round(data.windMph * 1.609)} km/h` : `${data.windMph} mph`;
  return (
    <div className="wx-stats">
      {opts.showFeels && <span title="Feels like"><WxIcon kind="feels" />Feels {conv(data.feelsLikeF ?? data.tempF)}°</span>}
      {opts.showHumidity && <span title="Humidity"><WxIcon kind="humidity" />{data.humidity}%</span>}
      {opts.showWind && <span title="Wind"><WxIcon kind="wind" />{wind}</span>}
      {opts.showSun && <span title={isDay ? "Sunset" : "Sunrise"}><WxIcon kind={isDay ? "sunset" : "sunrise"} />{isDay ? data.sunset : data.sunrise}</span>}
    </div>
  );
}
