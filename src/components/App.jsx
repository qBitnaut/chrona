// App.jsx — the widget window. Composes the clock + weather scene + world
// clocks, drives the native Tauri window (drag / resize / auto-fit height),
// resolves the time-of-day theme, and opens the native right-click menu.
import React from "react";
import {
  useClock, resolveTheme, phaseForHour, PHASES,
  TimeBlock, MetaLine, TZExt, WeatherBlock, WxStats,
} from "./clock-widget.jsx";
import { codeToCondition, useLightning } from "./weather-fx.jsx";
import { useWeather } from "../lib/weather.js";
import { useSettings, setSetting, DEFAULTS } from "../lib/settings.js";
import {
  widthForSize, sizeForWidth, setWindowSize, startDragging, showContextMenu,
  MIN_WIDTH, MAX_WIDTH,
} from "../lib/window.js";

const FONT = {
  geometric: "'Jost', sans-serif",
  modern: "'Sora', sans-serif",
  bold: "'Space Grotesk', sans-serif",
  elegant: "'Cormorant Garamond', serif",
  mono: "'JetBrains Mono', monospace",
};
const WEIGHT = { thin: 300, light: 300, regular: 400, medium: 500, bold: 700 };
const DAY_PHASES = ["sunrise", "morning", "midday", "afternoon", "golden"];

// Upgrade a base condition to a severe-weather advisory from live readings.
// (The Rust layer already applies official NWS alert overrides; this catches
// the threshold cases that have no active alert. It's idempotent on conditions
// that are already severe.)
function deriveLive(cond, d) {
  const t = d.tempF, w = d.windMph;
  if (cond === "snow" && w >= 28) return "blizzard";
  if ((cond === "clear" || cond === "partly") && t >= 100) return "heat";
  if (t <= 30 && ["clear", "partly", "overcast", "fog"].includes(cond)) return "icy";
  if (cond === "heavy-rain" && w >= 30) return "flood";
  if (["clear", "partly", "overcast"].includes(cond) && w >= 25) return "windy";
  return cond;
}

function glassVars(dark, bgOp, accent) {
  const a = Math.max(0, Math.min(1, bgOp / 100));
  if (dark) {
    return {
      "--glass": `rgba(14,18,30,${a})`,
      "--glass-solid": "#0e121e",
      "--ink": "#f3f6fb",
      "--ink-2": "rgba(243,246,251,.6)",
      "--edge": "rgba(255,255,255,.15)",
      "--edge-hi": "rgba(255,255,255,.22)",
      "--tz-bg": "rgba(255,255,255,.07)",
      "--accent": accent,
    };
  }
  return {
    "--glass": `rgba(248,251,255,${Math.min(1, a + 0.06)})`,
    "--glass-solid": "#eef3fa",
    "--ink": "#19212e",
    "--ink-2": "rgba(25,33,46,.6)",
    "--edge": "rgba(255,255,255,.7)",
    "--edge-hi": "rgba(255,255,255,.9)",
    "--tz-bg": "rgba(20,32,54,.06)",
    "--accent": accent,
  };
}

export default function App() {
  const [settings] = useSettings();
  const t = settings || DEFAULTS;
  const now = useClock();
  const { data, status, refresh } = useWeather();

  // condition + day/night + phase resolution (live or preview)
  const base = data.condition || codeToCondition(data.code);
  const liveCond = deriveLive(base, data);
  const condition = t.wxDemo === "live" ? liveCond : t.wxDemo;
  const autoPhase = phaseForHour(now.getHours());
  const phaseKey = t.tod === "auto" ? autoPhase : t.tod;
  let isDay;
  if (t.dayNight !== "auto") isDay = t.dayNight === "day";
  else if (t.tod !== "auto") isDay = DAY_PHASES.includes(phaseKey);
  else isDay = data.isDay;

  const theme = resolveTheme(phaseKey, condition, isDay);
  const dark = t.theme === "auto" ? !isDay : t.theme === "dark";
  const useC = t.units === "metric";
  const flash = useLightning(condition === "thunder" && t.animLevel !== "off");

  // ── native window: width from size%, auto-fit height to content ──────────
  const rootRef = React.useRef(null);
  const widthRef = React.useRef(widthForSize(t.size));
  const heightRef = React.useRef(0);
  const draggingRef = React.useRef(false);

  // Apply width whenever the size% setting changes (e.g. from Settings window).
  React.useEffect(() => {
    if (draggingRef.current) return;
    const w = widthForSize(t.size);
    widthRef.current = w;
    setWindowSize(w, heightRef.current || (rootRef.current?.offsetHeight ?? 200));
  }, [t.size]);

  // Auto-fit window height to the widget's content height — but stay out of the
  // way while the user is actively resizing (the resize handle owns sizing then).
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (draggingRef.current) return;
      const h = el.offsetHeight;
      if (h && Math.abs(h - heightRef.current) >= 1) {
        heightRef.current = h;
        setWindowSize(widthRef.current, h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── interaction ─────────────────────────────────────────────────────────
  // Suppress the WebView2 default context menu everywhere and open our native
  // menu instead. Capture phase so it beats the webview's default.
  React.useEffect(() => {
    const onCtx = (e) => {
      e.preventDefault();
      showContextMenu();
    };
    document.addEventListener("contextmenu", onCtx, true);
    return () => document.removeEventListener("contextmenu", onCtx, true);
  }, []);

  const onPointerDown = (e) => {
    if (t.pinned || e.button !== 0) return;
    if (e.target.closest(".resize, .wctl, button, a, input, select, textarea")) return;
    startDragging();
  };

  // Proportional resize: drag scales the whole widget. We lock the aspect ratio
  // captured at drag-start and set width+height together (one setSize per frame,
  // rAF-coalesced) so it stays smooth and never fights the height observer.
  const onResizeStart = (e) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.screenX;
    const startW = widthRef.current;
    const startH = heightRef.current || (rootRef.current?.offsetHeight ?? Math.round(startW * 0.5));
    const aspect = startH / startW;
    let pending = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending == null) return;
      const nw = pending;
      pending = null;
      const nh = Math.round(nw * aspect);
      widthRef.current = nw;
      heightRef.current = nh;
      setWindowSize(nw, nh);
    };
    const move = (ev) => {
      pending = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + (ev.screenX - startX)));
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      flush();
      draggingRef.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // persist the new width as size% (effect won't re-fire for the same value)
      setSetting("size", sizeForWidth(widthRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── style vars ────────────────────────────────────────────────────────────
  const weight = WEIGHT[t.weight] || 300;
  const cfWeight = t.font === "elegant" ? Math.min(weight, 600) : weight;
  // blur materials (Mica/Acrylic/Mica Alt) are DWM-rounded at ~8px; the CSS card
  // matches that. Glass/None are clipped to a region at the chosen radius.
  const isBackdrop = ["mica", "acrylic", "tabbed"].includes(t.material);
  const effRadius = isBackdrop ? 8 : t.radius;
  const widgetStyle = {
    ...glassVars(dark, t.bgOpacity, theme.accent),
    "--radius": `${effRadius}px`,
    "--blur": `${t.blur}px`,
    "--widget-op": t.widgetOpacity / 100,
    "--grain": t.mica ? (dark ? 0.6 : 0.42) : 0,
    "--cf": FONT[t.font],
    "--cw": cfWeight,
    "--cw-temp": Math.max(400, Math.min(t.font === "elegant" ? 600 : 700, weight + 100)),
    "--tzx-scale": (t.zoneTimeScale ?? 100) / 100,
  };

  const weatherOpts = {
    units: t.units, showFeels: t.showFeels, showHumidity: t.showHumidity,
    showWind: t.showWind, showSun: t.showSun,
  };

  const lastUpd = new Date(data.updated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const lastDate = new Date(data.updated).toLocaleDateString("en-US", { month: "short", day: "2-digit" });

  return (
    <div
      ref={rootRef}
      className={`widget${t.pinned ? " pinned" : ""}`}
      data-dark={dark ? 1 : 0}
      data-font={t.font}
      style={widgetStyle}
      onPointerDown={onPointerDown}
    >
      <div className="wctl">
        <button title="Refresh weather" onPointerDown={(e) => e.stopPropagation()} onClick={refresh}>⟳</button>
      </div>

      <div className="widget-inner">
        <div className="mainrow">
          <div className="timecol">
            <TimeBlock now={now} h24={t.h24} seconds={t.seconds} />
            <MetaLine now={now} place={data.place} region={data.region}
                      tempF={data.tempF} useC={useC} showTemp={t.showTemp} />
          </div>
          <WeatherBlock condition={condition} isDay={isDay} level={t.animLevel}
                        dark={dark} accent={theme.accent} data={data} useC={useC} flash={flash} />
        </div>

        <WxStats data={data} useC={useC} opts={weatherOpts} isDay={isDay} />

        {t.showUpdated && (
          <div className="wfoot">
            <span className="wstatus">
              <span className={`wdot ${status === "mock" ? "mock" : ""}`}></span>
              {status === "live" ? "Live" : status === "loading" ? "Updating…" : "Sample data"}
            </span>
            <span>· {lastDate} @ {lastUpd}</span>
          </div>
        )}
      </div>

      {t.showZones && (
        <TZExt now={now} zoneIds={t.zones} seconds={t.zoneSeconds} accent={theme.accent} />
      )}

      <div className="resize" onPointerDown={onResizeStart}></div>
      <div className="widget-flash" style={{ opacity: flash }} aria-hidden="true"></div>
    </div>
  );
}
