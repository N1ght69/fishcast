'use strict';
/* FishCast core: species profiles, sun/moon math, weather fetch and the bite model.
   No DOM code here, so it can be tested on its own. */

// ---------- Species ----------
// opt = water °C where feeding is strongest, tol = outside this they're nearly inactive.
// lowLight 0 = feeds in bright sun … 1 = loves dawn/dusk/overcast. night = activity in darkness.
// wind 0 = likes calm … 1 = likes chop. press = pressure sensitivity. sol = solunar weight.
// Tune these once your catch log shows where the model is wrong.
const SPECIES = {
  pike:    { name: 'Pike',            opt: [10, 19], tol: [1, 26],  lowLight: 0.3,  night: 0.15, wind: 0.6, press: 0.8, sol: 0.6 },
  perch:   { name: 'Perch',           opt: [14, 23], tol: [2, 29],  lowLight: 0.35, night: 0.1,  wind: 0.4, press: 0.7, sol: 0.5 },
  zander:  { name: 'Zander / Walleye',opt: [12, 22], tol: [3, 28],  lowLight: 0.9,  night: 0.7,  wind: 0.7, press: 0.7, sol: 0.6 },
  bass:    { name: 'Largemouth bass', opt: [18, 27], tol: [8, 32],  lowLight: 0.5,  night: 0.3,  wind: 0.5, press: 0.9, sol: 0.6 },
  trout:   { name: 'Trout',           opt: [9, 16],  tol: [3, 21],  lowLight: 0.6,  night: 0.25, wind: 0.5, press: 0.6, sol: 0.5 },
  carp:    { name: 'Carp',            opt: [18, 26], tol: [8, 30],  lowLight: 0.5,  night: 0.7,  wind: 0.3, press: 0.5, sol: 0.4 },
  bream:   { name: 'Bream',           opt: [15, 24], tol: [5, 28],  lowLight: 0.6,  night: 0.6,  wind: 0.3, press: 0.6, sol: 0.4 },
  catfish: { name: 'Catfish (Wels)',  opt: [20, 28], tol: [12, 32], lowLight: 0.8,  night: 1.0,  wind: 0.3, press: 0.6, sol: 0.5 },
};

// ---------- Sun & moon (low precision, a few minutes accuracy) ----------
const RAD = Math.PI / 180;
const OBL = RAD * 23.4397;
const SYNODIC = 29.530588853;
const REF_NEW_MOON = 947182440000; // 2000-01-06 18:14 UTC
const HOUR = 3600000, DAY = 86400000;

const jdays = t => t / DAY - 10957.5;

function horizontal(ra, dec, d, lat, lon) {
  const st = RAD * (280.16 + 360.9856235 * d) + RAD * lon;
  let h = (st - ra) % (2 * Math.PI);
  if (h > Math.PI) h -= 2 * Math.PI;
  if (h < -Math.PI) h += 2 * Math.PI;
  const phi = RAD * lat;
  return { alt: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)), h };
}

/** Sun altitude in degrees. */
function sunAltitude(t, lat, lon) {
  const d = jdays(t);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBL) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
  return horizontal(ra, dec, d, lat, lon).alt / RAD;
}

function moonState(t, lat, lon) {
  const d = jdays(t);
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.229350 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const ra = Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));
  return horizontal(ra, dec, d, lat, lon);
}

function moonAge(t) {
  const r = ((t - REF_NEW_MOON) / DAY) % SYNODIC;
  return r < 0 ? r + SYNODIC : r;
}
const moonIllumination = t => (1 - Math.cos(2 * Math.PI * moonAge(t) / SYNODIC)) / 2;

function moonPhaseName(t) {
  const a = moonAge(t);
  const names = [[1.84, 'New moon'], [5.53, 'Waxing crescent'], [9.22, 'First quarter'], [12.91, 'Waxing gibbous'],
    [16.61, 'Full moon'], [20.30, 'Waning gibbous'], [23.99, 'Last quarter'], [27.68, 'Waning crescent']];
  for (const [limit, n] of names) if (a < limit) return n;
  return 'New moon';
}

/** Moon overhead/underfoot (major) and rise/set (minor) between two times, 5-minute scan. */
function solunarEvents(start, end, lat, lon) {
  const step = 300000, hz = 0.133 * RAD, ev = [];
  const at = (t1, f1, f2) => { const den = f1 - f2; const fr = den === 0 ? 0 : Math.min(1, Math.max(0, f1 / den)); return t1 + step * fr; };
  let t = start, p = moonState(t, lat, lon);
  while (t < end) {
    const t2 = t + step, c = moonState(t2, lat, lon);
    if (p.alt < hz && c.alt >= hz) ev.push({ kind: 'rise', t: at(t, p.alt - hz, c.alt - hz) });
    else if (p.alt >= hz && c.alt < hz) ev.push({ kind: 'set', t: at(t, p.alt - hz, c.alt - hz) });
    if (p.h < 0 && c.h >= 0) ev.push({ kind: 'over', t: at(t, p.h, c.h) });
    if (p.h > 0 && c.h < 0 && p.h - c.h > Math.PI) ev.push({ kind: 'under', t: at(t, p.h - Math.PI, c.h + Math.PI) });
    p = c; t = t2;
  }
  return ev;
}
const isMajor = e => e.kind === 'over' || e.kind === 'under';
const EVENT_LABEL = { over: 'Moon overhead · major', under: 'Moon underfoot · major', rise: 'Moonrise · minor', set: 'Moonset · minor' };

// ---------- Weather (Open-Meteo, free, no key) ----------
async function fetchWeather(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    hourly: 'temperature_2m,surface_pressure,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,precipitation,weather_code',
    past_days: '7', forecast_days: '8', timezone: 'auto', timeformat: 'unixtime',
  });
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + p);
  if (!r.ok) throw new Error('Weather service error (' + r.status + ')');
  return parseWeather(await r.json(), lat, lon);
}

function parseWeather(j, lat, lon) {
  const h = j.hourly;
  const fill = (a, fb) => { let last = a.find(v => v != null); if (last == null) last = fb; return a.map(v => (v != null ? (last = v) : last)); };
  const T = fill(h.temperature_2m, 10), P = fill(h.surface_pressure, 1013), W = fill(h.wind_speed_10m, 10),
        G = fill(h.wind_gusts_10m, 15), C = fill(h.cloud_cover, 50), R = fill(h.precipitation, 0);
  const K = h.weather_code.map(v => v ?? 0);
  const D = fill(h.wind_direction_10m || [], 0);
  const hours = h.time.map((t, i) => ({ t: t * 1000, air: T[i], pres: P[i], wind: W[i], gust: G[i], windDir: D[i] ?? 0, cloud: C[i] / 100, rain: R[i], code: K[i] }));
  if (hours.length < 48) throw new Error('Not enough weather data');
  return { hours, tz: j.timezone || 'UTC', fetched: Date.now(), lat, lon };
}

// ---------- Bite model ----------
/** Lakes lag the air: water ≈ mean air temperature of the previous 5 days. */
function waterTemp(hours, i, offset) {
  const s = Math.max(0, i - 120);
  let sum = 0;
  for (let k = s; k <= i; k++) sum += hours[k].air;
  return Math.max(0.5, sum / (i - s + 1) + offset);
}

function estimatedWaterNow(bundle, now = Date.now()) {
  let idx = -1;
  bundle.hours.forEach((h, i) => { if (h.t <= now) idx = i; });
  return idx < 0 ? 10 : waterTemp(bundle.hours, idx, 0);
}

const smooth = x => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

function fTemp(t, s) {
  const floor = 0.05;
  if (t >= s.opt[0] && t <= s.opt[1]) return 1;
  if (t < s.opt[0]) return floor + (1 - floor) * smooth((t - s.tol[0]) / (s.opt[0] - s.tol[0]));
  return floor + (1 - floor) * smooth((s.tol[1] - t) / (s.tol[1] - s.opt[1]));
}

function fLight(alt, cloud, s) {
  const day = a => {
    const bright = Math.min(1, Math.max(0, (a + 6) / 40)) * (1 - 0.6 * cloud);
    let f = (1 - s.lowLight) + s.lowLight * (0.35 + 0.65 * (1 - bright));
    if (a < 10) f *= 1.2; // dawn / dusk feeding window
    return f;
  };
  if (alt <= -12) return s.night;
  if (alt < -6) return s.night + (day(-6) - s.night) * ((alt + 12) / 6);
  return day(alt);
}

function fPressure(p, dp3, dp24, sens) {
  let r;
  if (dp3 < -3) r = 0.8;          // falling fast: storm coming
  else if (dp3 < -0.5) r = 1;     // falling slowly: classic pre-front feed
  else if (dp3 <= 0.5) r = 0.85;  // stable
  else if (dp3 <= 2) r = 0.7;     // rising
  else r = 0.55;                  // rising fast: post-front
  if (dp24 > 6 && p > 1020) r = Math.min(r, 0.6); // bluebird high after a cold front
  return 1 - sens * (1 - r);
}

function fWind(w, g, s) {
  const ideal = 5 + 15 * s.wind;
  let f = 1 - 0.5 * Math.min(1, Math.abs(w - ideal) / 25);
  if (w > 35 || g > 60) f *= 0.4;
  return f;
}

function fWeather(rain, code) {
  if (code >= 95 && code <= 99) return 0.3; // thunderstorm
  if (rain < 0.1) return 1;
  if (rain < 2) return 1.05;
  if (rain < 5) return 0.85;
  return 0.65;
}

function fSolunar(t, majors, minors, illum, w) {
  const close = (list, win) => { let m = Infinity; for (const x of list) { const d = Math.abs(x - t); if (d < m) m = d; } return Math.max(0, 1 - m / win); };
  return 1 + w * (0.25 * close(majors, 1.5 * HOUR) + 0.12 * close(minors, HOUR) + 0.05 * (illum < 0.1 || illum > 0.9 ? 1 : 0));
}

function hourScores(bundle, speciesKey, lat, lon, waterOffset, events) {
  const s = SPECIES[speciesKey], H = bundle.hours, out = [];
  const majors = events.filter(isMajor).map(e => e.t), minors = events.filter(e => !isMajor(e)).map(e => e.t);
  for (let i = 24; i < H.length; i++) {
    const h = H[i];
    const water = waterTemp(H, i, waterOffset);
    const dp3 = h.pres - H[i - 3].pres, dp24 = h.pres - H[i - 24].pres;
    const alt = sunAltitude(h.t, lat, lon);
    const f = {
      temp: fTemp(water, s),
      light: fLight(alt, h.cloud, s),
      press: fPressure(h.pres, dp3, dp24, s.press),
      wind: fWind(h.wind, h.gust, s),
      weather: fWeather(h.rain, h.code),
      sol: fSolunar(h.t, majors, minors, moonIllumination(h.t), s.sol),
    };
    const raw = Math.pow(f.temp, 1.5) * f.light * f.press * f.wind * f.weather * f.sol;
    const chance = Math.min(0.97, Math.max(0.02, 1 - Math.exp(-1.6 * raw))); // raw 1 → ~80 %
    out.push({ t: h.t, chance, w: h, water, dp3, dp24, alt, f });
  }
  return out;
}

const _dayFmt = {};
function dayKey(t, tz) {
  _dayFmt[tz] = _dayFmt[tz] || new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return _dayFmt[tz].format(t);
}

function buildDays(scores, events, tz, now = Date.now()) {
  const today = dayKey(now, tz), groups = new Map();
  for (const s of scores) {
    const k = dayKey(s.t, tz);
    if (k < today) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const days = [];
  for (const [key, hours] of groups) {
    if (hours.length < 12) continue;
    hours.sort((a, b) => a.t - b.t);
    const top = hours.map(h => h.chance).sort((a, b) => b - a).slice(0, 4);
    const dayChance = top.reduce((a, b) => a + b, 0) / top.length;
    const threshold = top[0] * 0.9;
    const windows = [];
    for (const h of hours) {
      if (h.chance < threshold) continue;
      const last = windows[windows.length - 1];
      if (last && last.end >= h.t) last.end = h.t + HOUR; else windows.push({ start: h.t, end: h.t + HOUR });
    }
    const peak = hours.reduce((a, b) => (b.chance > a.chance ? b : a));
    const mid = hours[Math.floor(hours.length / 2)].t;
    days.push({
      key, start: hours[0].t, hours, dayChance, windows, peak,
      events: events.filter(e => dayKey(e.t, tz) === key).sort((a, b) => a.t - b.t),
      illum: moonIllumination(mid), phase: moonPhaseName(mid),
    });
  }
  return days.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Plain-language reasons for an hour's score. */
function reasons(h, speciesKey) {
  const s = SPECIES[speciesKey], name = s.name.toLowerCase(), out = [];
  const w = Math.round(h.water) + '°C', range = s.opt[0] + '–' + s.opt[1] + '°C';
  const side = h.water < s.opt[0] ? 'cold' : 'warm';
  if (h.water >= s.opt[0] && h.water <= s.opt[1]) out.push({ good: true, text: `Water ~${w} is in the comfort zone (${range})` });
  else if (h.f.temp >= 0.75) out.push({ good: true, text: `Water ~${w} is a little ${side} but still good (best ${range})` });
  else out.push({ good: false, text: `Water ~${w} is ${side} for ${name} (likes ${range})` });

  if (h.dp3 < -3) out.push({ good: false, text: 'Pressure dropping fast – storm risk' });
  else if (h.dp3 < -0.5) out.push({ good: true, text: 'Pressure falling slowly – fish often feed before a front' });
  else if (h.dp3 <= 0.5) out.push({ good: true, text: 'Pressure stable' });
  else out.push({ good: false, text: 'Pressure rising – fish often go quiet after a front' });

  if (h.alt > -6 && h.alt < 10) out.push({ good: true, text: 'Dawn/dusk feeding window' });
  else if (h.alt <= -6) out.push(s.night >= 0.6 ? { good: true, text: 'Night – this species hunts in the dark' } : { good: false, text: 'Night – low activity for this species' });
  else if (s.lowLight >= 0.6) out.push(h.w.cloud > 0.7 ? { good: true, text: 'Overcast helps a light-shy species' } : { good: false, text: 'Bright light – this species prefers dim conditions' });

  if (h.f.sol > 1.08) out.push({ good: true, text: 'Near a major moon period' });
  if (h.w.wind > 35 || h.w.gust > 60) out.push({ good: false, text: 'Strong wind – hard and unsafe fishing' });
  else if (h.f.wind > 0.9) out.push({ good: true, text: 'Wind near ideal for this species' });
  if (h.w.code >= 95 && h.w.code <= 99) out.push({ good: false, text: 'Thunderstorm – stay off the water' });
  return out;
}

/** Conditions + model score at the moment of a catch (catch must be < 6 days old). */
async function catchConditions(lat, lon, t, speciesKey) {
  if (t < Date.now() - 6 * DAY) return null;
  const b = await fetchWeather(lat, lon);
  const H = b.hours;
  const ev = solunarEvents(H[0].t - DAY, H[H.length - 1].t + DAY, lat, lon);
  const sc = hourScores(b, speciesKey, lat, lon, 0, ev);
  let best = null;
  for (const s of sc) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  if (!best || Math.abs(best.t - t) > 1.5 * HOUR) return null;
  return { air: best.w.air, water: best.water, pres: best.w.pres, dp3: best.dp3, wind: best.w.wind, cloud: best.w.cloud, chance: best.chance };
}

// ---------- Depth (Lithuanian inland-water bathymetry, geoportal.lt, public service) ----------
// ~300 lakes, ponds, Kaunas & Curonian lagoons and the coast. Elsewhere there is no free depth data.
const BATHY_URL = 'https://www.geoportal.lt/mapproxy/rest/services/gisc_batimetrija/MapServer';
const BATHY_BOUNDS = [[53.85, 20.9], [56.5, 26.9]]; // Lithuania

/** Depth-band polygons inside a lon/lat box. Each band's value is its shallow edge in metres. */
async function fetchDepthPolygons(west, south, east, north) {
  const q = new URLSearchParams({
    geometry: [west, south, east, north].map(v => v.toFixed(6)).join(','), geometryType: 'esriGeometryEnvelope',
    inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'GYLIS',
    returnGeometry: 'true', maxAllowableOffset: '0.00004', geometryPrecision: '6', f: 'json',
  });
  const r = await fetch(BATHY_URL + '/4/query?' + q);
  if (!r.ok) throw new Error('Depth service error (' + r.status + ')');
  const j = await r.json();
  if (j.error) throw new Error('Depth service error');
  const bands = (j.features || []).filter(f => f.geometry && f.geometry.rings).map(f => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const ring of f.geometry.rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    return { d: +f.attributes.GYLIS, rings: f.geometry.rings, box: [w, s, e, n] };
  });
  const levels = [...new Set(bands.map(b => b.d))].sort((a, b) => a - b);
  return { bands, levels, truncated: !!j.exceededTransferLimit };
}

function pointInRings(x, y, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const xi = r[i][0], yi = r[i][1], xk = r[k][0], yk = r[k][1];
      if ((yi > y) !== (yk > y) && x < (xk - xi) * (y - yi) / (yk - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Depth at a point from fetched bands: {min, max, est} in metres, or null (land / no data). */
function depthFromBands(lon, lat, data) {
  let best = null;
  for (const b of data.bands) {
    if (lon < b.box[0] || lon > b.box[2] || lat < b.box[1] || lat > b.box[3]) continue;
    if (pointInRings(lon, lat, b.rings) && (best === null || b.d > best)) best = b;
  }
  if (best === null) return null;
  const next = data.levels.find(v => v > best.d);
  const step = next != null ? next - best.d : Math.max(1, best.d * 0.2);
  return { min: best.d, max: best.d + step, est: best.d + step / 2 };
}

/** Single-point depth lookup (used for a dropped pin). */
async function depthAtPoint(lat, lon) {
  const q = new URLSearchParams({
    geometry: lon.toFixed(6) + ',' + lat.toFixed(6), geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'GYLIS', returnGeometry: 'false', f: 'json',
  });
  const r = await fetch(BATHY_URL + '/4/query?' + q);
  const j = await r.json();
  const vals = (j.features || []).map(f => +f.attributes.GYLIS);
  return vals.length ? Math.max(...vals) : null;
}

// ---------- Spot predictor ----------
// depth = typical feeding depth (m) in comfortable water. drop = love of drop-offs/edges,
// shore = love of shallow shoreline/weed zone, windward = how much a wind-blown shore helps.
const SPOT_PREFS = {
  pike:    { depth: [1.5, 5],  drop: 0.7, shore: 0.6, windward: 0.5 },
  perch:   { depth: [2, 8],    drop: 0.9, shore: 0.3, windward: 0.6 },
  zander:  { depth: [4, 12],   drop: 1.0, shore: 0.1, windward: 0.7 },
  bass:    { depth: [1, 4],    drop: 0.5, shore: 0.8, windward: 0.4 },
  trout:   { depth: [4, 15],   drop: 0.6, shore: 0.2, windward: 0.3 },
  carp:    { depth: [1, 3],    drop: 0.2, shore: 0.8, windward: 0.5 },
  bream:   { depth: [3, 8],    drop: 0.3, shore: 0.2, windward: 0.3 },
  catfish: { depth: [5, 15],   drop: 0.6, shore: 0.1, windward: 0.2 },
};

/** Preferred depth range adjusted for water temperature (fish go deeper in cold winter water and in summer heat). */
function preferredDepth(speciesKey, water) {
  const s = SPECIES[speciesKey], p = SPOT_PREFS[speciesKey];
  let [lo, hi] = p.depth;
  if (water < s.opt[0] - 3) { lo += 2; hi += 3; }                       // cold: deeper, stable water
  else if (water > s.opt[1] && speciesKey !== 'carp' && speciesKey !== 'bass') { lo += 1.5; hi += 3; } // too warm: cooler depths
  return [lo, hi];
}

/**
 * Score a grid over the given box. ctx: {water, windDir (deg, from), windSpeed (km/h), catches:[{lat,lon,species}]}.
 * Returns {cells:[{lat,lon,score}], spots:[{lat,lon,score,depth,reasons}], cellM}.
 */
function predictSpots(data, box, speciesKey, ctx) {
  const [west, south, east, north] = box;
  const p = SPOT_PREFS[speciesKey];
  const [lo, hi] = preferredDepth(speciesKey, ctx.water);
  const latMid = (south + north) / 2;
  const mPerLat = 111320, mPerLon = 111320 * Math.cos(latMid * RAD);
  const wM = (east - west) * mPerLon, hM = (north - south) * mPerLat;
  const cellM = Math.max(25, Math.max(wM, hM) / 44);
  const nx = Math.max(4, Math.round(wM / cellM)), ny = Math.max(4, Math.round(hM / cellM));
  const dLon = (east - west) / nx, dLat = (north - south) / ny;

  const grid = [];
  for (let iy = 0; iy < ny; iy++) {
    const row = [];
    for (let ix = 0; ix < nx; ix++) {
      const lon = west + (ix + 0.5) * dLon, lat = south + (iy + 0.5) * dLat;
      row.push({ lon, lat, depth: depthFromBands(lon, lat, data) });
    }
    grid.push(row);
  }

  // centre of the water area, for windward-shore direction
  let cx = 0, cy = 0, nWater = 0;
  for (const row of grid) for (const c of row) if (c.depth) { cx += c.lon; cy += c.lat; nWater++; }
  if (!nWater) return { cells: [], spots: [], cellM };
  cx /= nWater; cy /= nWater;
  const toRad = ((ctx.windDir || 0) + 180) * RAD; // direction the wind blows TOWARD
  const wx = Math.sin(toRad), wy = Math.cos(toRad);
  const windStrength = Math.min(1, (ctx.windSpeed || 0) / 20);

  const cells = [];
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const c = grid[iy][ix];
    if (!c.depth) continue;
    const d = c.depth.est;
    // depth fit
    const off = d < lo ? lo - d : d > hi ? d - hi : 0;
    const depthFit = Math.exp(-Math.pow(off / 2.5, 2));
    // drop-off: biggest depth change to a neighbour within 2 cells, per 100 m
    let maxDiff = 0, land = 0, around = 0;
    for (let ky = -2; ky <= 2; ky++) for (let kx = -2; kx <= 2; kx++) {
      if (!kx && !ky) continue;
      const r = grid[iy + ky], n = r && r[ix + kx];
      if (!n) continue;
      around++;
      if (!n.depth) { land++; continue; }
      const dist = Math.hypot(kx, ky) * cellM;
      maxDiff = Math.max(maxDiff, Math.abs(n.depth.est - d) * 100 / dist);
    }
    const drop = Math.min(1, maxDiff / 6);          // 6 m per 100 m = strong drop-off
    const shore = around ? Math.min(1, land / around * 1.5) : 0;
    // windward: cells on the side the wind blows toward
    const vx = (c.lon - cx) * mPerLon, vy = (c.lat - cy) * mPerLat, vl = Math.hypot(vx, vy) || 1;
    const windward = Math.max(0, (vx * wx + vy * wy) / vl) * windStrength;
    // your own catches of this species nearby
    let mine = 0;
    for (const k of ctx.catches || []) {
      if (k.species !== speciesKey || k.lat == null) continue;
      const m = Math.hypot((k.lon - c.lon) * mPerLon, (k.lat - c.lat) * mPerLat);
      if (m < 200) mine = Math.max(mine, 1 - m / 200);
    }
    const score = depthFit * (0.45 + 0.35 * p.drop * drop + 0.25 * p.shore * shore + 0.2 * p.windward * windward) + 0.25 * mine;
    cells.push({ lat: c.lat, lon: c.lon, score, depth: c.depth, drop, maxDiff, shore, windward, mine, depthFit });
  }

  const top = Math.max(...cells.map(c => c.score)) || 1;
  cells.forEach(c => { c.score /= top; });

  // pick up to 6 well-separated best cells
  const minSep = Math.max(120, cellM * 4);
  const spots = [];
  for (const c of [...cells].sort((a, b) => b.score - a.score)) {
    if (spots.length >= 6 || c.score < 0.55) break;
    if (spots.some(s => Math.hypot((s.lon - c.lon) * mPerLon, (s.lat - c.lat) * mPerLat) < minSep)) continue;
    const reasons = [];
    reasons.push(`${fmtDepth(c.depth)} deep${c.depthFit > 0.9 ? ' – right depth now' : ''}`);
    if (c.drop > 0.4) reasons.push(`Drop-off: ~${Math.round(c.maxDiff)} m change per 100 m`);
    if (c.shore > 0.5 && p.shore >= 0.5) reasons.push('Shallow shoreline / weed zone nearby');
    if (c.windward > 0.4) reasons.push('Wind blows onto this shore – food drifts here');
    if (c.mine > 0.3) reasons.push('You caught this species here before');
    spots.push({ lat: c.lat, lon: c.lon, score: c.score, depth: c.depth, reasons });
  }
  return { cells, spots, cellM, range: [lo, hi] };
}

function fmtDepth(d) {
  if (!d) return '–';
  const a = Math.round(d.min), b = Math.round(d.max);
  return a === b ? `~${a} m` : `${a}–${b} m`;
}
