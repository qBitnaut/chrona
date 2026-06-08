// Generates a 1024x1024 source icon (icon-src.png) for `tauri icon`.
// A rounded indigo glass tile with a clock ring + two hands and a warm accent.
// No external deps — hand-rolls a minimal PNG encoder (zlib via node:zlib).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const buf = Buffer.alloc(S * S * 4); // RGBA

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function px(x, y, r, g, b, a = 255) {
  const i = (y * S + x) * 4;
  // simple source-over against existing
  const ea = buf[i + 3] / 255, na = a / 255;
  const oa = na + ea * (1 - na);
  if (oa <= 0) return;
  buf[i] = (r * na + buf[i] * ea * (1 - na)) / oa;
  buf[i + 1] = (g * na + buf[i + 1] * ea * (1 - na)) / oa;
  buf[i + 2] = (b * na + buf[i + 2] * ea * (1 - na)) / oa;
  buf[i + 3] = oa * 255;
}

const cx = S / 2, cy = S / 2;
const radiusCorner = 190;

// rounded-rect coverage (anti-aliased) for the tile
function tileAlpha(x, y) {
  const m = 40; // margin (transparent border)
  const x0 = m, y0 = m, x1 = S - m, y1 = S - m, r = radiusCorner;
  // distance outside the rounded rect
  let dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  let dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  // corner regions use circle distance; edges use straight
  const inCornerX = x < x0 + r || x > x1 - r;
  const inCornerY = y < y0 + r || y > y1 - r;
  let d;
  if (inCornerX && inCornerY) d = Math.hypot(dx, dy) - r;
  else d = Math.max(x0 - x, x - x1, y0 - y, y - y1);
  return clamp(0.5 - d, 0, 1);
}

// hand / segment distance
function distSeg(px0, py0, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px0 - ax, wy = py0 - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(px0 - (ax + t * vx), py0 - (ay + t * vy));
}

const ringR = 300, ringW = 26;
// hands
const hourAng = (-150 * Math.PI) / 180; // ~10 o'clock
const minAng = (60 * Math.PI) / 180; // ~2 o'clock
const hourLen = 170, minLen = 250;
const hourEnd = [cx + Math.cos(hourAng) * hourLen, cy + Math.sin(hourAng) * hourLen];
const minEnd = [cx + Math.cos(minAng) * minLen, cy + Math.sin(minAng) * minLen];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const ta = tileAlpha(x, y);
    if (ta <= 0) continue;

    // background gradient (indigo top -> deep navy bottom) + top-right glow
    const t = y / S;
    let r = lerp(27, 12, t), g = lerp(36, 19, t), b = lerp(82, 46, t);
    const glow = clamp(1 - Math.hypot(x - S * 0.74, y - S * 0.2) / (S * 0.6), 0, 1);
    r += glow * 36; g += glow * 44; b += glow * 70;
    px(x, y, r, g, b, ta * 255);

    const dC = Math.hypot(x - cx, y - cy);

    // clock face fill (subtle)
    if (dC < ringR - ringW / 2) {
      const fa = clamp((ringR - ringW / 2 - dC) / 30, 0, 1) * 0.5;
      px(x, y, 36, 48, 102, fa * 255 * ta);
    }
    // clock ring (accent indigo)
    const ringD = Math.abs(dC - ringR);
    if (ringD < ringW / 2 + 1) {
      const a = clamp(ringW / 2 + 0.5 - ringD, 0, 1);
      px(x, y, 138, 155, 255, a * 255 * ta);
    }
    // minute hand (warm accent)
    const dm = distSeg(x, y, cx, cy, minEnd[0], minEnd[1]);
    if (dm < 13) px(x, y, 255, 200, 110, clamp(13 - dm, 0, 1) * 255 * ta);
    // hour hand
    const dh = distSeg(x, y, cx, cy, hourEnd[0], hourEnd[1]);
    if (dh < 17) px(x, y, 255, 177, 61, clamp(17 - dh, 0, 1) * 255 * ta);
    // center hub
    if (dC < 26) px(x, y, 255, 245, 220, clamp(26 - dC, 0, 1) * 255 * ta);
  }
}

// ── encode PNG ───────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
// raw scanlines with filter byte 0
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const idat = deflateSync(raw, { level: 9 });
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../icon-src.png", import.meta.url), png);
console.log("wrote icon-src.png", png.length, "bytes");
