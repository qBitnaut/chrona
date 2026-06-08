// weather.js — live-weather hook backed by the Rust data layer.
// Rust owns fetching/caching/refresh (NWS primary in the US, Open-Meteo
// fallback + geocoding). The frontend just asks for the current snapshot and
// listens for `weather-updated` pushes from the background refresh task.
import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MOCK } from "../components/clock-widget.jsx";

const WEATHER_UPDATED = "weather-updated";

export function useWeather() {
  const [data, setData] = React.useState(MOCK);
  const [status, setStatus] = React.useState("loading"); // loading | live | mock

  const apply = React.useCallback((payload) => {
    if (!payload) return;
    setData(payload);
    setStatus(payload.mock ? "mock" : "live");
  }, []);

  React.useEffect(() => {
    let un = null, alive = true;
    // Initial snapshot (Rust kicks a background refresh if the cache is cold).
    invoke("get_weather").then(apply).catch(() => { if (alive) setStatus("mock"); });
    listen(WEATHER_UPDATED, (e) => { if (alive) apply(e.payload); })
      .then((u) => { un = u; if (!alive) u(); });
    return () => { alive = false; if (un) un(); };
  }, [apply]);

  const refresh = React.useCallback(() => {
    setStatus("loading");
    invoke("refresh_weather").then(apply).catch(() => setStatus("mock"));
  }, [apply]);

  return { data, status, refresh };
}
