// weather.rs — Chrona's data layer.
//
// Strategy: Open-Meteo is the structured backbone (geocoding + hi/lo + sunrise/
// sunset + is_day + a base condition), worldwide. For US locations the National
// Weather Service (api.weather.gov) is layered on top as the authoritative
// source: current observations (temp/humidity/wind + condition text) and — most
// importantly — *active alerts*, which drive the severe-weather scenes
// (tornado / flood / blizzard / ice / heat / wind) from official warnings rather
// than guessed thresholds. Everything degrades gracefully to a mock payload so
// the UI never breaks offline.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

// NWS requires a descriptive User-Agent with contact info. A project URL is an
// acceptable contact; add an email here if you want NWS to be able to reach you.
const USER_AGENT: &str = "Chrona/0.1 (https://github.com/qBitnaut/chrona)";

pub const WEATHER_UPDATED: &str = "weather-updated";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherData {
    pub place: String,
    pub region: String,
    pub temp_f: i64,
    pub feels_like_f: i64,
    pub hi_f: i64,
    pub lo_f: i64,
    pub condition: String,
    pub is_day: bool,
    pub humidity: i64,
    pub wind_mph: i64,
    pub sunrise: String,
    pub sunset: String,
    pub updated: i64, // epoch millis
    pub mock: bool,
    pub source: String, // "nws" | "open-meteo" | "mock"
}

impl WeatherData {
    fn mock() -> Self {
        WeatherData {
            place: "Fort Worth".into(),
            region: "TX".into(),
            temp_f: 81,
            feels_like_f: 84,
            hi_f: 88,
            lo_f: 67,
            condition: "partly".into(),
            is_day: true,
            humidity: 41,
            wind_mph: 9,
            sunrise: "6:21 AM".into(),
            sunset: "8:34 PM".into(),
            updated: now_millis(),
            mock: true,
            source: "mock".into(),
        }
    }
}

pub struct WeatherState {
    pub data: Mutex<WeatherData>,
    pub client: reqwest::Client,
    pub notify: Notify,
}

impl WeatherState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .unwrap_or_default();
        WeatherState {
            data: Mutex::new(WeatherData::mock()),
            client,
            notify: Notify::new(),
        }
    }
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── settings (read straight from the tauri-plugin-store JSON) ────────────────
struct WxSettings {
    detect: bool,
    place: String,
    region: String,
    lat: Option<f64>,
    lon: Option<f64>,
    refresh_min: u64,
}

fn read_settings(app: &AppHandle) -> WxSettings {
    use tauri_plugin_store::StoreExt;
    let mut s = WxSettings {
        detect: false,
        place: "Fort Worth".into(),
        region: "TX".into(),
        lat: None,
        lon: None,
        refresh_min: 30,
    };
    if let Ok(store) = app.store("settings.json") {
        if let Some(v) = store.get("detect") {
            s.detect = v.as_bool().unwrap_or(false);
        }
        if let Some(v) = store.get("place") {
            if let Some(p) = v.as_str() {
                if !p.trim().is_empty() {
                    s.place = p.to_string();
                }
            }
        }
        if let Some(v) = store.get("region") {
            if let Some(r) = v.as_str() {
                s.region = r.to_string();
            }
        }
        s.lat = store.get("lat").and_then(|v| v.as_f64());
        s.lon = store.get("lon").and_then(|v| v.as_f64());
        if let Some(v) = store.get("refreshMin") {
            s.refresh_min = v.as_u64().unwrap_or(30).max(5);
        }
    }
    s
}

// Rough US bounding boxes (CONUS + AK + HI) — used when the user picked exact
// coordinates so we know whether to layer NWS on top.
fn us_bounds(lat: f64, lon: f64) -> bool {
    (24.0..=49.5).contains(&lat) && (-125.0..=-66.5).contains(&lon)
        || (51.0..=72.0).contains(&lat) && (-170.0..=-129.0).contains(&lon)
        || (18.0..=23.0).contains(&lat) && (-161.0..=-154.0).contains(&lon)
}

pub fn refresh_minutes(app: &AppHandle) -> u64 {
    read_settings(app).refresh_min.max(5)
}

// ── Open-Meteo weather_code → internal condition ─────────────────────────────
fn code_to_condition(code: i64) -> &'static str {
    match code {
        0 => "clear",
        1 | 2 => "partly",
        3 => "overcast",
        45 | 48 => "fog",
        51..=55 => "drizzle",
        56 | 57 => "sleet",
        61 | 63 => "rain",
        65 => "heavy-rain",
        66 | 67 => "sleet",
        71..=75 | 77 => "snow",
        80 | 81 => "rain",
        82 => "heavy-rain",
        85 | 86 => "snow",
        c if c >= 95 => "thunder",
        _ => "partly",
    }
}

// NWS observation text → internal condition (best-effort substring match).
fn nws_text_to_condition(text: &str) -> Option<&'static str> {
    let t = text.to_lowercase();
    let has = |k: &str| t.contains(k);
    let cond = if has("tornado") {
        "tornado"
    } else if has("blizzard") {
        "blizzard"
    } else if has("thunder") {
        "thunder"
    } else if has("freezing") || has("sleet") || has("ice pellets") {
        "sleet"
    } else if has("snow") || has("flurries") || has("wintry") {
        "snow"
    } else if has("heavy rain") {
        "heavy-rain"
    } else if has("drizzle") {
        "drizzle"
    } else if has("rain") || has("showers") || has("shower") {
        "rain"
    } else if has("fog") || has("mist") || has("haze") || has("smoke") {
        "fog"
    } else if has("overcast") {
        "overcast"
    } else if has("partly") || has("mostly sunny") || has("few clouds") || has("scattered") {
        "partly"
    } else if has("mostly cloudy") || has("broken clouds") || has("cloudy") {
        "overcast"
    } else if has("windy") || has("breezy") || has("blustery") {
        "windy"
    } else if has("clear") || has("sunny") || has("fair") {
        "clear"
    } else {
        return None;
    };
    Some(cond)
}

// NWS alert "event" → severe condition. Returns a severity rank so the worst
// active alert wins.
fn alert_to_condition(event: &str) -> Option<(u8, &'static str)> {
    let e = event.to_lowercase();
    if e.contains("tornado") {
        Some((6, "tornado"))
    } else if e.contains("flash flood") || e.contains("flood") {
        Some((5, "flood"))
    } else if e.contains("blizzard") {
        Some((4, "blizzard"))
    } else if e.contains("ice storm")
        || e.contains("winter storm")
        || e.contains("freeze")
        || e.contains("frost")
        || e.contains("winter weather")
    {
        Some((3, "icy"))
    } else if e.contains("excessive heat") || e.contains("extreme heat") || e.contains("heat advisory")
    {
        Some((2, "heat"))
    } else if e.contains("high wind") || e.contains("wind advisory") || e.contains("wind warning") {
        Some((1, "windy"))
    } else {
        None
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────
async fn get_json(client: &reqwest::Client, url: &str) -> Option<Value> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>().await.ok()
}

// Format an Open-Meteo local ISO time ("2026-06-07T06:21") as "6:21 AM".
fn fmt_clock(iso: &str) -> String {
    // take the HH:MM after 'T'
    let time = iso.split('T').nth(1).unwrap_or("");
    let mut it = time.split(':');
    let h: i64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let m: &str = it.next().unwrap_or("00");
    let (h12, ap) = match h {
        0 => (12, "AM"),
        1..=11 => (h, "AM"),
        12 => (12, "PM"),
        _ => (h - 12, "PM"),
    };
    format!("{}:{} {}", h12, &m[..m.len().min(2)], ap)
}

fn round(v: f64) -> i64 {
    v.round() as i64
}

// ── location ─────────────────────────────────────────────────────────────────
struct Location {
    lat: f64,
    lon: f64,
    name: String,
    region: String,
    is_us: bool,
}

// Open-Meteo's geocoder matches a bare city name; "City, ST" returns nothing.
// Split off the region/state hint so we query "City" and then prefer the match
// whose admin1/country matches the hint.
fn split_place(place: &str) -> (String, Option<String>) {
    match place.split_once(',') {
        Some((city, hint)) => {
            let hint = hint.trim();
            (
                city.trim().to_string(),
                if hint.is_empty() { None } else { Some(hint.to_string()) },
            )
        }
        None => (place.trim().to_string(), None),
    }
}

fn matches_hint(r: &Value, hint: &str) -> bool {
    let h = hint.to_lowercase();
    let f = |k: &str| {
        r.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase()
    };
    f("admin1_code") == h
        || f("country_code") == h
        || f("admin1") == h
        || f("country") == h
        || f("admin1").starts_with(&h)
        || f("country").starts_with(&h)
}

async fn geocode(client: &reqwest::Client, place: &str) -> Option<Location> {
    let (city, hint) = split_place(place);
    if city.is_empty() {
        return None;
    }
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=5&language=en&format=json",
        urlencoding(&city)
    );
    let j = get_json(client, &url).await?;
    let arr = j.get("results")?.as_array()?;
    if arr.is_empty() {
        return None;
    }
    let r = match &hint {
        Some(h) => arr.iter().find(|r| matches_hint(r, h)).unwrap_or(&arr[0]),
        None => &arr[0],
    };
    let lat = r.get("latitude")?.as_f64()?;
    let lon = r.get("longitude")?.as_f64()?;
    let name = r
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Here")
        .to_string();
    let country = r
        .get("country_code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let region = r
        .get("admin1_code")
        .and_then(|v| v.as_str())
        .or_else(|| r.get("admin1").and_then(|v| v.as_str()))
        .unwrap_or(&country)
        .to_string();
    Some(Location {
        lat,
        lon,
        name,
        region,
        is_us: country.eq_ignore_ascii_case("US"),
    })
}

async fn ip_locate(client: &reqwest::Client) -> Option<Location> {
    let j = get_json(client, "https://ipapi.co/json/").await?;
    let lat = j.get("latitude")?.as_f64()?;
    let lon = j.get("longitude")?.as_f64()?;
    let name = j
        .get("city")
        .and_then(|v| v.as_str())
        .unwrap_or("My location")
        .to_string();
    let country = j
        .get("country_code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let region = j
        .get("region_code")
        .and_then(|v| v.as_str())
        .or_else(|| j.get("region").and_then(|v| v.as_str()))
        .unwrap_or(&country)
        .to_string();
    Some(Location {
        lat,
        lon,
        name,
        region,
        is_us: country.eq_ignore_ascii_case("US"),
    })
}

// ── Open-Meteo forecast (structured base) ────────────────────────────────────
async fn open_meteo(client: &reqwest::Client, lat: f64, lon: f64) -> Option<WeatherData> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}\
&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m\
&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset\
&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1"
    );
    let j = get_json(client, &url).await?;
    let cur = j.get("current")?;
    let day = j.get("daily")?;
    let arr0 = |k: &str| -> Option<&Value> { day.get(k)?.as_array()?.first() };

    let code = cur.get("weather_code").and_then(|v| v.as_i64()).unwrap_or(2);
    let temp_f = round(cur.get("temperature_2m").and_then(|v| v.as_f64()).unwrap_or(70.0));
    Some(WeatherData {
        place: String::new(),
        region: String::new(),
        temp_f,
        feels_like_f: cur
            .get("apparent_temperature")
            .and_then(|v| v.as_f64())
            .map(round)
            .unwrap_or(temp_f),
        hi_f: round(arr0("temperature_2m_max").and_then(|v| v.as_f64()).unwrap_or(75.0)),
        lo_f: round(arr0("temperature_2m_min").and_then(|v| v.as_f64()).unwrap_or(60.0)),
        condition: code_to_condition(code).to_string(),
        is_day: cur.get("is_day").and_then(|v| v.as_i64()).unwrap_or(1) == 1,
        humidity: round(cur.get("relative_humidity_2m").and_then(|v| v.as_f64()).unwrap_or(50.0)),
        wind_mph: round(cur.get("wind_speed_10m").and_then(|v| v.as_f64()).unwrap_or(5.0)),
        sunrise: arr0("sunrise").and_then(|v| v.as_str()).map(fmt_clock).unwrap_or_default(),
        sunset: arr0("sunset").and_then(|v| v.as_str()).map(fmt_clock).unwrap_or_default(),
        updated: now_millis(),
        mock: false,
        source: "open-meteo".into(),
    })
}

// ── NWS (US authoritative layer) ─────────────────────────────────────────────
struct NwsPoints {
    stations_url: String,
    city: Option<String>,
    state: Option<String>,
}

async fn nws_points(client: &reqwest::Client, lat: f64, lon: f64) -> Option<NwsPoints> {
    let url = format!("https://api.weather.gov/points/{:.4},{:.4}", lat, lon);
    let j = get_json(client, &url).await?;
    let props = j.get("properties")?;
    let stations_url = props
        .get("observationStations")
        .and_then(|v| v.as_str())?
        .to_string();
    let rel = props.get("relativeLocation").and_then(|r| r.get("properties"));
    let city = rel
        .and_then(|p| p.get("city"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let state = rel
        .and_then(|p| p.get("state"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(NwsPoints {
        stations_url,
        city,
        state,
    })
}

struct NwsObs {
    temp_f: Option<i64>,
    feels_f: Option<i64>,
    humidity: Option<i64>,
    wind_mph: Option<i64>,
    condition: Option<&'static str>,
}

async fn nws_obs(client: &reqwest::Client, stations_url: &str) -> Option<NwsObs> {
    let stations = get_json(client, stations_url).await?;
    let first = stations.get("features")?.as_array()?.first()?;
    let station_id = first.get("properties")?.get("stationIdentifier")?.as_str()?;
    let obs_url = format!(
        "https://api.weather.gov/stations/{}/observations/latest",
        station_id
    );
    let j = get_json(client, &obs_url).await?;
    let p = j.get("properties")?;

    // temperature: unitCode wmoUnit:degC
    let temp_f = p
        .get("temperature")
        .and_then(|t| t.get("value"))
        .and_then(|v| v.as_f64())
        .map(|c| round(c * 9.0 / 5.0 + 32.0));
    let humidity = p
        .get("relativeHumidity")
        .and_then(|t| t.get("value"))
        .and_then(|v| v.as_f64())
        .map(round);
    // windSpeed: usually km/h
    let wind_mph = p
        .get("windSpeed")
        .and_then(|t| {
            let val = t.get("value").and_then(|v| v.as_f64());
            let unit = t.get("unitCode").and_then(|v| v.as_str()).unwrap_or("");
            val.map(|v| {
                if unit.contains("m_s") {
                    v * 2.23694
                } else if unit.contains("km_h") {
                    v / 1.609
                } else {
                    v
                }
            })
        })
        .map(round);
    // apparent temperature: heat index (warm) or wind chill (cold), in degC
    let feels_f = p
        .get("heatIndex")
        .and_then(|t| t.get("value"))
        .and_then(|v| v.as_f64())
        .or_else(|| {
            p.get("windChill")
                .and_then(|t| t.get("value"))
                .and_then(|v| v.as_f64())
        })
        .map(|c| round(c * 9.0 / 5.0 + 32.0));
    let condition = p
        .get("textDescription")
        .and_then(|v| v.as_str())
        .and_then(nws_text_to_condition);

    Some(NwsObs {
        temp_f,
        feels_f,
        humidity,
        wind_mph,
        condition,
    })
}

async fn nws_alert(client: &reqwest::Client, lat: f64, lon: f64) -> Option<&'static str> {
    let url = format!(
        "https://api.weather.gov/alerts/active?point={:.4},{:.4}",
        lat, lon
    );
    let j = get_json(client, &url).await?;
    let feats = j.get("features")?.as_array()?;
    let mut best: Option<(u8, &'static str)> = None;
    for f in feats {
        if let Some(ev) = f
            .get("properties")
            .and_then(|p| p.get("event"))
            .and_then(|v| v.as_str())
        {
            if let Some((rank, cond)) = alert_to_condition(ev) {
                if best.map(|(r, _)| rank > r).unwrap_or(true) {
                    best = Some((rank, cond));
                }
            }
        }
    }
    best.map(|(_, c)| c)
}

// ── top-level fetch ──────────────────────────────────────────────────────────
pub async fn fetch_weather(app: &AppHandle) -> WeatherData {
    let state = app.state::<WeatherState>();
    let client = state.client.clone();
    let cfg = read_settings(app);

    // 1. resolve location: IP-detect, exact picked coordinates, or geocode text
    let loc = if cfg.detect {
        ip_locate(&client).await
    } else if let (Some(lat), Some(lon)) = (cfg.lat, cfg.lon) {
        Some(Location {
            lat,
            lon,
            name: cfg.place.clone(),
            region: cfg.region.clone(),
            is_us: us_bounds(lat, lon),
        })
    } else {
        geocode(&client, &cfg.place).await
    };
    let Some(loc) = loc else {
        return WeatherData::mock();
    };

    // 2. structured base from Open-Meteo
    let Some(mut wd) = open_meteo(&client, loc.lat, loc.lon).await else {
        return WeatherData::mock();
    };
    wd.place = loc.name.clone();
    wd.region = loc.region.clone();

    // 3. US: overlay NWS current obs + authoritative alert override
    if loc.is_us {
        if let Some(points) = nws_points(&client, loc.lat, loc.lon).await {
            if let Some(c) = &points.city {
                wd.place = c.clone();
            }
            if let Some(s) = &points.state {
                wd.region = s.clone();
            }
            if let Some(obs) = nws_obs(&client, &points.stations_url).await {
                if let Some(v) = obs.temp_f {
                    wd.temp_f = v;
                }
                if let Some(v) = obs.feels_f {
                    wd.feels_like_f = v;
                }
                if let Some(v) = obs.humidity {
                    wd.humidity = v;
                }
                if let Some(v) = obs.wind_mph {
                    wd.wind_mph = v;
                }
                if let Some(c) = obs.condition {
                    wd.condition = c.to_string();
                }
                wd.source = "nws".into();
            }
        }
        if let Some(severe) = nws_alert(&client, loc.lat, loc.lon).await {
            wd.condition = severe.to_string();
            wd.source = "nws".into();
        }
    }

    wd
}

fn urlencoding(s: &str) -> String {
    // minimal percent-encoding for query values
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// ── background refresh loop ──────────────────────────────────────────────────
pub fn spawn_refresh_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let data = fetch_weather(&app).await;
            {
                let state = app.state::<WeatherState>();
                *state.data.lock().unwrap() = data.clone();
            }
            let _ = app.emit(WEATHER_UPDATED, &data);

            let mins = refresh_minutes(&app);
            let state = app.state::<WeatherState>();
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(mins * 60)) => {}
                _ = state.notify.notified() => {}
            }
        }
    });
}

// ── commands ─────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn get_weather(state: tauri::State<'_, WeatherState>) -> WeatherData {
    let data = state.data.lock().unwrap().clone();
    // nudge a refresh if we're still on the cold mock payload
    if data.mock {
        state.notify.notify_one();
    }
    data
}

#[tauri::command]
pub async fn refresh_weather(app: AppHandle) -> WeatherData {
    let data = fetch_weather(&app).await;
    {
        let state = app.state::<WeatherState>();
        *state.data.lock().unwrap() = data.clone();
    }
    let _ = app.emit(WEATHER_UPDATED, &data);
    data
}

// Called when weather-affecting settings change: wake the loop to refetch.
pub fn nudge_refresh(app: &AppHandle) {
    app.state::<WeatherState>().notify.notify_one();
}

// ── location search (so the user can pick a precise place) ───────────────────
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoResult {
    pub label: String,
    pub name: String,
    pub region: String,
    pub lat: f64,
    pub lon: f64,
}

#[tauri::command]
pub async fn geocode_search(app: AppHandle, query: String) -> Vec<GeoResult> {
    let q = query.trim();
    if q.is_empty() {
        return vec![];
    }
    // accept "City, ST" by searching the city part; the results carry their own
    // admin1/country so the user picks the exact one
    let (city, _hint) = split_place(q);
    let client = app.state::<WeatherState>().client.clone();
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=8&language=en&format=json",
        urlencoding(&city)
    );
    let Some(j) = get_json(&client, &url).await else {
        return vec![];
    };
    let Some(arr) = j.get("results").and_then(|r| r.as_array()) else {
        return vec![];
    };
    arr.iter()
        .filter_map(|r| {
            let lat = r.get("latitude")?.as_f64()?;
            let lon = r.get("longitude")?.as_f64()?;
            let name = r.get("name")?.as_str()?.to_string();
            let admin1 = r.get("admin1").and_then(|v| v.as_str()).unwrap_or("");
            let country = r.get("country").and_then(|v| v.as_str()).unwrap_or("");
            let country_code = r.get("country_code").and_then(|v| v.as_str()).unwrap_or("");
            // region the widget shows: the state code in the US, else the country
            let region = if country_code.eq_ignore_ascii_case("US") {
                r.get("admin1_code")
                    .and_then(|v| v.as_str())
                    .unwrap_or(admin1)
                    .to_string()
            } else {
                country_code.to_string()
            };
            let mut label = name.clone();
            if !admin1.is_empty() {
                label.push_str(", ");
                label.push_str(admin1);
            }
            if !country.is_empty() {
                label.push_str(", ");
                label.push_str(country);
            }
            Some(GeoResult {
                label,
                name,
                region,
                lat,
                lon,
            })
        })
        .collect()
}
