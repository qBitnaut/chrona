// weather-fx.jsx — living weather diorama (canvas particles + layered DOM scenes)
// Ported from the prototype to an ES module. Visuals/animations unchanged.
// A <WeatherScene> fills its positioned parent (position:absolute; inset:0).
import React from "react";

// ── Open-Meteo weather_code → internal condition ─────────────────────────────
export function codeToCondition(code) {
  const c = Number(code);
  if (c === 0) return "clear";
  if (c === 1 || c === 2) return "partly";
  if (c === 3) return "overcast";
  if (c === 45 || c === 48) return "fog";
  if (c >= 51 && c <= 55) return "drizzle";
  if (c === 56 || c === 57) return "sleet";
  if (c === 61 || c === 63) return "rain";
  if (c === 65) return "heavy-rain";
  if (c === 66 || c === 67) return "sleet";
  if (c >= 71 && c <= 75) return "snow";
  if (c === 77) return "snow";
  if (c >= 80 && c <= 81) return "rain";
  if (c === 82) return "heavy-rain";
  if (c === 85 || c === 86) return "snow";
  if (c >= 95) return "thunder";
  return "partly";
}

export function conditionLabel(cond, isDay) {
  const m = {
    clear: isDay ? "Clear" : "Clear night",
    partly: "Partly cloudy",
    overcast: "Overcast",
    fog: "Fog",
    drizzle: "Drizzle",
    rain: "Rain",
    "heavy-rain": "Heavy rain",
    sleet: "Sleet",
    snow: "Snow",
    thunder: "Thunderstorm",
    windy: "Windy",
    icy: "Freeze warning",
    heat: "Heat advisory",
    tornado: "Tornado warning",
    flood: "Flood warning",
    blizzard: "Blizzard",
  };
  return m[cond] || "Partly cloudy";
}

// ── Cloud puff (soft layered SVG) ────────────────────────────────────────────
function Cloud({ scale = 1, tint, opacity = 1, dark = false, style }) {
  const base = dark ? "#8b94a6" : "#ffffff";
  const shade = dark ? "#6b7488" : "#dfe6f0";
  return (
    <svg viewBox="0 0 120 70" style={{
      width: `${scale * 100}%`, height: "auto", overflow: "visible",
      filter: "drop-shadow(0 4px 8px rgba(20,28,45,0.18))", opacity, ...style,
    }} aria-hidden="true">
      <defs>
        <linearGradient id={`cg-${scale}-${dark}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tint || base} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
      </defs>
      <g fill={`url(#cg-${scale}-${dark})`}>
        <ellipse cx="40" cy="45" rx="34" ry="22" />
        <ellipse cx="68" cy="38" rx="30" ry="26" />
        <ellipse cx="92" cy="48" rx="24" ry="18" />
        <ellipse cx="58" cy="52" rx="40" ry="16" />
      </g>
    </svg>
  );
}

// ── Particle canvas (rain / drizzle / snow / sleet) ──────────────────────────
function Precip({ kind, level }) {
  const ref = React.useRef(null);
  const rafRef = React.useRef(0);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || kind === "none" || level === "off") return;
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let parts = [];

    const counts = { low: 0.45, med: 0.75, max: 1 };
    const k = counts[level] ?? 0.75;

    const density = {
      drizzle: 0.018, rain: 0.03, "heavy-rain": 0.055, sleet: 0.026, snow: 0.02, blizzard: 0.05,
    }[kind] || 0.03;

    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      w = Math.max(40, r.width); h = Math.max(40, r.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(w * h * density * k / 30);
      parts = Array.from({ length: n }, mk);
    }
    function mk() {
      const snow = kind === "snow" || kind === "sleet" || kind === "blizzard";
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.5 + Math.random() * 0.8,
        r: snow ? 1 + Math.random() * 2.4 : 0,
        len: 6 + Math.random() * 10,
        drift: Math.random() * Math.PI * 2,
        sleetSnow: kind === "sleet" ? Math.random() < 0.5 : snow,
      };
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement);
    resize();

    // pre-rendered soft sprites (feathered edges, drawn once)
    const snowSprite = document.createElement("canvas"); snowSprite.width = snowSprite.height = 24;
    { const g = snowSprite.getContext("2d");
      const rg = g.createRadialGradient(12, 12, 0, 12, 12, 12);
      rg.addColorStop(0, "rgba(255,255,255,1)");
      rg.addColorStop(.5, "rgba(255,255,255,.7)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 24, 24); }
    const rainSprite = document.createElement("canvas"); rainSprite.width = 6; rainSprite.height = 48;
    { const g = rainSprite.getContext("2d");
      const lg = g.createLinearGradient(0, 0, 0, 48);
      lg.addColorStop(0, "rgba(202,224,248,0)");
      lg.addColorStop(.5, "rgba(202,224,248,.95)");
      lg.addColorStop(1, "rgba(202,224,248,0)");
      g.fillStyle = lg;
      if (g.roundRect) { g.beginPath(); g.roundRect(2, 0, 2, 48, 1); g.fill(); }
      else g.fillRect(2, 0, 2, 48); }

    const wind = kind === "heavy-rain" ? 1.1 : kind === "blizzard" ? 1.9 : kind === "rain" ? 0.6 : kind === "drizzle" ? 0.32 : 0.38;
    const speedMul = kind === "heavy-rain" ? 1.4 : kind === "drizzle" ? 0.6 : 1;
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(2.5, ((now || performance.now()) - last) / 16.67); last = now || performance.now();
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        if (p.sleetSnow) { // soft snowflake
          const bz = kind === "blizzard";
          p.drift += 0.012 * dt;
          p.x += (Math.sin(p.drift) * 0.34 + wind * (bz ? 0.55 : 0.16) * p.z) * dt;
          p.y += (0.16 + p.z * 0.34) * (bz ? 1.7 : 1) * dt;
          const s = p.r * p.z * 2.3;
          ctx.globalAlpha = 0.28 + p.z * 0.4;
          ctx.drawImage(snowSprite, p.x - s / 2, p.y - s / 2, s, s);
        } else { // soft rain streak
          const vy = (1.7 + p.z * 2.4) * speedMul;
          p.x += wind * p.z * dt; p.y += vy * dt;
          const len = 12 + p.z * 16;
          ctx.globalAlpha = 0.09 + p.z * 0.2;
          ctx.drawImage(rainSprite, p.x, p.y - len, 2.4 * p.z, len);
        }
        if (p.y > h + 16 || p.x > w + 18) {
          Object.assign(p, mk(), { x: Math.random() * w, y: -14 });
        }
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(frame);
    }
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(rafRef.current);
      else rafRef.current = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [kind, level]);
  if (kind === "none" || level === "off") return null;
  return <canvas ref={ref} className="wx-canvas" />;
}

// ── Lightning timing (lifted to a hook so the flash can span the whole card) ──
export function useLightning(active) {
  const [flash, setFlash] = React.useState(0);
  React.useEffect(() => {
    if (!active) { setFlash(0); return; }
    let timers = [], alive = true;
    const T = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); };
    const strike = () => {
      if (!alive) return;
      const dbl = Math.random() < 0.4; // occasional double-flicker
      setFlash(0.82 + Math.random() * 0.18);
      T(() => alive && setFlash(0.22), 55);
      if (dbl) {
        T(() => alive && setFlash(0.85), 130);
        T(() => alive && setFlash(0.35), 205);
      }
      // soft, slower fade tail so it doesn't snap off
      T(() => alive && setFlash(0.16), dbl ? 330 : 250);
      T(() => alive && setFlash(0.05), dbl ? 520 : 430);
      T(() => alive && setFlash(0), dbl ? 760 : 660);
      T(strike, 5000 + Math.random() * 9500); // irregular 5–14.5s gaps
    };
    T(strike, 1600 + Math.random() * 3200);
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [active]);
  return flash;
}

// ── Stars (clear night) ──────────────────────────────────────────────────────
function Stars({ n = 18 }) {
  const stars = React.useMemo(() => Array.from({ length: n }, (_, i) => ({
    x: 6 + Math.random() * 88, y: 6 + Math.random() * 64,
    s: 0.6 + Math.random() * 1.7, d: Math.random() * 3, dur: 2 + Math.random() * 2.5,
  })), [n]);
  return (
    <div className="wx-stars">
      {stars.map((st, i) => (
        <span key={i} style={{
          left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s,
          animationDelay: `${st.d}s`, animationDuration: `${st.dur}s`,
        }} />
      ))}
    </div>
  );
}

// ── Fog bands ─────────────────────────────────────────────────────────────────
function Fog() {
  return (
    <div className="wx-fog">
      <i style={{ top: "28%", animationDuration: "9s" }} />
      <i style={{ top: "48%", animationDuration: "13s", animationDelay: "-4s" }} />
      <i style={{ top: "66%", animationDuration: "11s", animationDelay: "-7s" }} />
    </div>
  );
}

// ── Wind (flowing gust streaks) ──────────────────────────────────────────────
// Gentle, near-straight curves that fade in/out at both ends (a stroke gradient)
// so they read as streaks of moving air rather than wavy "snakes". A faint curl
// at the leading edge hints at a gust.
function WindStreaks() {
  const lines = [
    { y: "20%", d: "0s",    dur: "2.6s", w: "56%", o: 0.5,  sw: 1.6 },
    { y: "33%", d: "-1.2s", dur: "3.5s", w: "72%", o: 0.4,  sw: 1.9 },
    { y: "47%", d: "-0.6s", dur: "3.0s", w: "48%", o: 0.55, sw: 1.4 },
    { y: "60%", d: "-1.9s", dur: "4.1s", w: "66%", o: 0.36, sw: 2.1 },
    { y: "73%", d: "-1.0s", dur: "3.3s", w: "52%", o: 0.46, sw: 1.6 },
  ];
  return (
    <div className="wx-wind">
      {lines.map((l, i) => (
        <svg key={i} className="wx-wind-line" viewBox="0 0 120 10" preserveAspectRatio="none"
             style={{ top: l.y, width: l.w, "--o": l.o, animationDelay: l.d, animationDuration: l.dur }}
             aria-hidden="true">
          <defs>
            <linearGradient id={`wg${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="rgba(255,255,255,0)" />
              <stop offset="0.42" stopColor="rgba(255,255,255,1)" />
              <stop offset="0.8" stopColor="rgba(255,255,255,1)" />
              <stop offset="1" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          {/* gentle flowing curve ending in a soft upward curl */}
          <path d="M1 6 C 32 5 56 5 82 5 S 110 4.4 116 5.6 q 3 0.6 1 -2.2"
                fill="none" stroke={`url(#wg${i})`} strokeWidth={l.sw}
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
    </div>
  );
}

// ── Ice / freeze (crystals + frost) ──────────────────────────────────────────
function Ice({ level }) {
  const n = level === "max" ? 16 : level === "med" ? 11 : 7;
  const flakes = React.useMemo(() => Array.from({ length: n }, () => ({
    x: 5 + Math.random() * 90, y: 6 + Math.random() * 78, s: 0.5 + Math.random() * 1,
    d: Math.random() * 3, dur: 2.4 + Math.random() * 2,
  })), [n]);
  return (
    <div className="wx-ice">
      <div className="wx-frost" />
      {flakes.map((f, i) => (
        <svg key={i} className="wx-ice-x" viewBox="0 0 10 10"
             style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${4 * f.s}cqw`,
                      animationDelay: `${f.d}s`, animationDuration: `${f.dur}s` }} aria-hidden="true">
          <path d="M5 .5V9.5M.5 5H9.5M2 2l6 6M8 2l-6 6" stroke="rgba(214,238,255,.92)"
                strokeWidth="1" strokeLinecap="round" />
        </svg>
      ))}
    </div>
  );
}

// ── Extreme heat (big sun + rising shimmer) ──────────────────────────────────
function Heat({ level }) {
  return (
    <div className="wx-heat">
      <div className="wx-heat-sun" />
      {level !== "off" && (
        <div className="wx-heat-waves">
          <i style={{ left: "16%", animationDelay: "0s" }} />
          <i style={{ left: "40%", animationDelay: "-1.1s" }} />
          <i style={{ left: "60%", animationDelay: "-2.3s" }} />
          <i style={{ left: "80%", animationDelay: "-1.7s" }} />
        </div>
      )}
    </div>
  );
}

// ── Tornado (animated canvas vortex + base dust) ─────────────────────────────
function TornadoFx({ level }) {
  const ref = React.useRef(null);
  const rafRef = React.useRef(0);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      w = Math.max(40, r.width); h = Math.max(40, r.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement); resize();

    // soft smoke puffs (light / mid / dark) — overlapping, they read as organic texture
    function puff(rgb) {
      const s = 32, c = document.createElement("canvas"); c.width = c.height = s;
      const g = c.getContext("2d");
      const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      rg.addColorStop(0, `rgba(${rgb},0.92)`);
      rg.addColorStop(0.45, `rgba(${rgb},0.4)`);
      rg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = rg; g.fillRect(0, 0, s, s);
      return c;
    }
    const puffLight = puff("204,210,224"), puffMid = puff("118,126,144"), puffDark = puff("28,32,44");

    const COUNT = level === "max" ? 240 : level === "med" ? 155 : 90;
    const P = Array.from({ length: COUNT }, () => ({
      a: Math.random() * Math.PI * 2, av: 0.045 + Math.random() * 0.05,
      f: Math.random(), fr: 0.32 + Math.random() * 0.72,
      rise: 0.0007 + Math.random() * 0.0022, sz: 0.45 + Math.random() * 0.95,
      wob: Math.random() * Math.PI * 2, tone: Math.random(),
    }));
    const OUT = level === "max" ? 44 : level === "med" ? 28 : 15;
    const Po = Array.from({ length: OUT }, () => ({
      a: Math.random() * Math.PI * 2,
      av: (Math.random() < 0.5 ? -1 : 1) * (0.025 + Math.random() * 0.05),
      f: Math.random(), rr: 1.12 + Math.random() * 1.1,
      rise: 0.001 + Math.random() * 0.0032, sz: 0.28 + Math.random() * 0.5,
    }));

    const start = performance.now();
    function frame(now) {
      const t = ((now || performance.now()) - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      const cx = w * 0.5, topY = h * 0.03, botY = h * 1.03, colW = w * 0.26;
      const sway = Math.sin(t * 0.8) * w * 0.02;
      const radAt = (f) => colW * (1 - f * 0.8) * (0.86 + 0.14 * Math.sin(f * 6 - t * 4));
      const bendAt = (f) => Math.sin(f * 2.3 - t * 1.6) * w * 0.05 * f + sway * (0.4 + f)
        + Math.sin(f * 11 - t * 5) * w * 0.012 * f;

      // main vortex — overlapping smoke puffs spiralling up a tapering, bending cone
      for (const p of P) {
        p.a += p.av; p.f -= p.rise;
        if (p.f < 0) p.f = 1;
        const f = p.f, rad = radAt(f);
        const rr = p.fr * (0.85 + 0.15 * Math.sin(p.wob + t * 3));
        const x = cx + bendAt(f) + Math.cos(p.a) * rad * rr;
        const y = topY + (botY - topY) * f + Math.sin(p.a) * rad * 0.24;
        const front = Math.sin(p.a) > 0;
        const fade = Math.min(1, f * 6) * Math.min(1, (1 - f) * 5 + 0.25);
        const sprite = p.tone < 0.45 ? (front ? puffLight : puffMid)
          : p.tone < 0.8 ? puffMid : (front ? puffMid : puffDark);
        const size = rad * (0.55 + p.sz * 0.55) * (front ? 1 : 0.85);
        ctx.globalAlpha = (front ? 0.5 : 0.34) * fade;
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      }
      // scattered debris wisps flung around the outside
      for (const o of Po) {
        o.a += o.av; o.f -= o.rise;
        if (o.f < 0) { o.f = 1; o.a = Math.random() * Math.PI * 2; }
        const f = o.f, rad = radAt(f);
        const x = cx + bendAt(f) + Math.cos(o.a) * rad * o.rr;
        const y = topY + (botY - topY) * f + Math.sin(o.a) * rad * 0.3;
        const size = colW * (0.16 + o.sz * 0.2);
        ctx.globalAlpha = 0.3 * Math.min(1, (1 - f) * 4 + 0.15);
        ctx.drawImage(puffMid, x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(frame);
    }
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(rafRef.current);
      else rafRef.current = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current); ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [level]);
  return <canvas ref={ref} className="wx-canvas" />;
}

function Tornado({ level }) {
  return (
    <div className="wx-tornado">
      <div className="wx-twist-cloud" />
      <TornadoFx level={level} />
      <div className="wx-twist-dust" />
    </div>
  );
}

// ── Flood (rising water with waves) ──────────────────────────────────────────
function Flood() {
  return (
    <div className="wx-flood">
      <svg className="wx-flood-wave wx-flood-w1" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 18 Q25 6 50 18 T100 18 T150 18 T200 18 V40 H0 Z" fill="rgba(96,138,190,.5)" />
      </svg>
      <svg className="wx-flood-wave wx-flood-w2" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 22 Q25 32 50 22 T100 22 T150 22 T200 22 V40 H0 Z" fill="rgba(70,108,158,.55)" />
      </svg>
    </div>
  );
}

// ── Whiteout gusts (blizzard) ────────────────────────────────────────────────
function Whiteout() {
  return (
    <div className="wx-whiteout">
      <i style={{ top: "18%", animationDuration: "5s", animationDelay: "0s" }} />
      <i style={{ top: "46%", animationDuration: "4s", animationDelay: "-2s" }} />
      <i style={{ top: "70%", animationDuration: "6s", animationDelay: "-3.5s" }} />
    </div>
  );
}

// ── Main scene ────────────────────────────────────────────────────────────────
export function WeatherScene({ condition = "partly", isDay = true, level = "max", dark = false, flash = 0 }) {
  const lvl = level; // 'off' | 'low' | 'med' | 'max'
  const showClouds = ["partly", "overcast", "fog", "drizzle", "rain", "heavy-rain", "sleet", "snow", "thunder", "windy", "icy", "flood", "blizzard"].includes(condition);
  const heavyCloud = ["overcast", "rain", "heavy-rain", "thunder", "flood", "blizzard"].includes(condition);
  const precip =
    condition === "drizzle" ? "drizzle" :
    condition === "rain" ? "rain" :
    condition === "heavy-rain" || condition === "thunder" || condition === "flood" ? "heavy-rain" :
    condition === "snow" ? "snow" :
    condition === "sleet" ? "sleet" :
    condition === "blizzard" ? "blizzard" : "none";
  const showSun = isDay && (condition === "clear" || condition === "partly");
  const showMoon = !isDay && (condition === "clear" || condition === "partly");
  const showStars = !isDay && condition === "clear" && lvl !== "off";

  return (
    <div className="wx" data-cond={condition}>
      {/* soft ambient glow behind the scene */}
      <div className="wx-ambient" data-day={isDay ? 1 : 0} />

      {showStars && <Stars n={lvl === "max" ? 22 : 12} />}

      {showSun && (
        <div className="wx-sun" data-anim={lvl === "off" ? 0 : 1}>
          <div className="wx-rays" />
          <div className="wx-sun-core" />
        </div>
      )}
      {showMoon && (
        <div className="wx-moon">
          <div className="wx-moon-core" />
          <div className="wx-moon-shadow" />
        </div>
      )}

      {showClouds && (
        <div className="wx-clouds" data-anim={lvl === "off" ? 0 : 1}>
          <div className="wx-cloud wx-cloud-back">
            <Cloud scale={1} dark={heavyCloud} opacity={heavyCloud ? 0.95 : 0.8} />
          </div>
          <div className="wx-cloud wx-cloud-front">
            <Cloud scale={1} dark={heavyCloud} opacity={0.98} />
          </div>
          {(condition === "overcast" || heavyCloud) && (
            <div className="wx-cloud wx-cloud-extra">
              <Cloud scale={1} dark={heavyCloud} opacity={0.9} />
            </div>
          )}
        </div>
      )}

      {condition === "fog" && lvl !== "off" && <Fog />}

      <Precip kind={precip} level={lvl} />

      {condition === "thunder" && lvl !== "off" && (
        <>
          <div className="wx-flash" style={{ opacity: flash * 0.6 }} />
          <svg className="wx-bolt" viewBox="0 0 40 80" style={{ opacity: flash }} aria-hidden="true">
            <path d="M24 2 9 44h12L16 78l21-46H23z" fill="#fdf6c8"
                  stroke="#fffbe8" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </>
      )}

      {condition === "windy" && lvl !== "off" && <WindStreaks />}
      {condition === "icy" && lvl !== "off" && <Ice level={lvl} />}
      {condition === "heat" && <Heat level={lvl} />}
      {condition === "tornado" && lvl !== "off" && <Tornado level={lvl} />}
      {condition === "flood" && <Flood />}
      {condition === "blizzard" && lvl !== "off" && <Whiteout />}
    </div>
  );
}
