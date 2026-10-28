'use strict';
/* FishCast UI: forecast, map, catch log. Depends on core.js and Leaflet. */

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => Math.round(v * 100) + '%';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = s => { const v = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : null; };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

const ICONS = {
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 4 3 5-7"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  fish: '<path d="M2.5 12c2.6-4 6.2-6 10.2-6 3 0 5 1.6 6.3 3l2.5-2.2v10.4L19 15c-1.3 1.4-3.3 3-6.3 3-4 0-7.6-2-10.2-6z"/><circle cx="8" cy="11" r=".9" fill="currentColor"/>',
  nav: '<path d="M3 11 21 3l-8 18-2-8-8-2z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  thermo: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  locoff: '<path d="M3 11 21 3l-8 18-2-8-8-2z"/><path d="M2 2l20 20"/>',
  depth: '<path d="M2 7c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/><path d="M2 12c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/><path d="M12 15v6M9 18l3 3 3-3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
};
const icon = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

const _fmt = {};
const fmt = (key, opts) => (_fmt[key] = _fmt[key] || new Intl.DateTimeFormat(undefined, opts));
const fmtTime = (t, tz) => fmt('t' + tz, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(t);
const fmtDay = (t, tz) => fmt('d' + tz, { weekday: 'short', day: 'numeric', timeZone: tz }).format(t);
const fmtDateTime = t => fmt('dt', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);
const localHour = (t, tz) => parseInt((_fmt['h' + tz] = _fmt['h' + tz] || new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz })).format(t), 10);

function toast(msg) {
  $('#toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.id = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ---------- storage (IndexedDB for catches + spots, photos stored as Blobs) ----------
let _db;
function db() {
  return (_db = _db || new Promise((res, rej) => {
    const r = indexedDB.open('fishcast', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('catches', { keyPath: 'id' });
      r.result.createObjectStore('spots', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function tx(storeName, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));
function persistStorage() { try { navigator.storage?.persist?.(); } catch { /* ignore */ } }

// ---------- state ----------
const state = {
  tab: 'forecast',
  species: SPECIES[store.get('species', 'pike')] ? store.get('species', 'pike') : 'pike',
  picked: store.get('picked', null),      // {lat, lon, name} or null = GPS
  waterOverride: null,
  gps: null, gpsError: null, locating: false,
  bundle: null, coord: null, loadedFor: null, events: [], days: [], dayIdx: 0,
  loading: false, error: null,
  catches: [], spots: [],
  satellite: store.get('satellite', false),
  depthOn: store.get('depthOn', true),
  detailId: null, sheetWater: 12, panelSpot: null,
  pred: null, // last spot prediction
};
const target = () => state.picked || state.gps;

function locate() {
  return new Promise(res => {
    if (!navigator.geolocation) { state.gpsError = 'Location is not supported on this device.'; return res(null); }
    navigator.geolocation.getCurrentPosition(
      p => { state.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; state.gpsError = null; res(state.gps); },
      e => { state.gpsError = e.code === 1 ? 'Location permission is off. Turn it on in Settings › Privacy › Location Services › Safari Websites.' : 'Could not get your location.'; res(null); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}
async function refreshGps() {
  state.locating = true;
  if (state.tab === 'forecast' && !state.picked) renderForecast();
  const g = await locate();
  state.locating = false;
  updateMe();
  return g;
}

// ---------- tabs ----------
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'forecast') renderForecast();
  if (tab === 'map') showMap();
  if (tab === 'catches') renderCatches();
}

// ---------- forecast ----------
async function loadForecast(force = false) {
  const c = target();
  if (!c) { renderForecast(); return; }
  const key = c.lat.toFixed(2) + ',' + c.lon.toFixed(2);
  if (!force && state.loadedFor === key && state.bundle && Date.now() - state.bundle.fetched < 30 * 60000) {
    recompute(); renderForecast(); return;
  }
  state.loading = true; state.error = null;
  if (state.loadedFor !== key) { state.days = []; state.dayIdx = 0; }
  renderForecast();
  try {
    const b = await fetchWeather(c.lat, c.lon);
    store.set('wx:last', { key, b });
    setBundle(b, c, key);
  } catch (e) {
    const cached = store.get('wx:last', null);
    if (cached && cached.key === key) {
      setBundle(cached.b, c, key);
      state.error = 'Offline – showing the forecast saved ' + fmtDateTime(cached.b.fetched) + '.';
    } else {
      state.error = navigator.onLine === false ? 'You are offline.' : (e.message || 'Could not load the weather.');
    }
  }
  state.loading = false;
  recompute();
  renderForecast();
}

function setBundle(b, c, key) {
  state.bundle = b; state.coord = c; state.loadedFor = key;
  const H = b.hours;
  state.events = solunarEvents(H[0].t - DAY, H[H.length - 1].t + DAY, c.lat, c.lon);
}

function recompute() {
  const b = state.bundle;
  if (!b) return;
  const off = state.waterOverride != null ? state.waterOverride - estimatedWaterNow(b) : 0;
  const sc = hourScores(b, state.species, state.coord.lat, state.coord.lon, off, state.events);
  state.days = buildDays(sc, state.events, b.tz);
  if (state.dayIdx >= state.days.length) state.dayIdx = 0;
}

const scoreColor = v => v >= 0.7 ? 'var(--good)' : v >= 0.5 ? 'var(--ok)' : v >= 0.3 ? 'var(--warn)' : 'var(--bad)';
const verdict = v => v >= 0.75 ? 'Excellent – get out there' : v >= 0.55 ? 'Good day' : v >= 0.35 ? 'Fair – fish the best window' : 'Tough conditions';

function ring(v, color) {
  const r = 47, C = 2 * Math.PI * r;
  return `<svg viewBox="0 0 116 116" aria-hidden="true">
    <circle cx="58" cy="58" r="${r}" style="fill:none;stroke:var(--line);stroke-width:11"/>
    <circle cx="58" cy="58" r="${r}" transform="rotate(-90 58 58)" style="fill:none;stroke:${color};stroke-width:11;stroke-linecap:round;stroke-dasharray:${(C * v).toFixed(1)} ${C.toFixed(1)}"/>
  </svg>`;
}

function chart(day, tz) {
  const W = 320, H = 150, pl = 30, pr = 6, pt = 8, pb = 20;
  const hs = day.hours, t0 = hs[0].t, t1 = hs[hs.length - 1].t;
  const X = t => pl + (t - t0) / (t1 - t0) * (W - pl - pr);
  const Y = v => pt + (1 - v) * (H - pt - pb);
  const line = hs.map((h, i) => (i ? 'L' : 'M') + X(h.t).toFixed(1) + ' ' + Y(h.chance).toFixed(1)).join('');
  const area = `${line}L${X(t1).toFixed(1)} ${Y(0)}L${X(t0).toFixed(1)} ${Y(0)}Z`;
  let grid = '';
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line);stroke-width:1"/>` +
            `<text x="${pl - 5}" y="${Y(v) + 3}" text-anchor="end">${v * 100}%</text>`;
  }
  let xl = '';
  for (const h of hs) {
    const lh = localHour(h.t, tz);
    if (lh % 6 === 0) xl += `<text x="${X(h.t).toFixed(1)}" y="${H - 5}" text-anchor="middle">${String(lh).padStart(2, '0')}:00</text>`;
  }
  let majors = '';
  for (const e of day.events) {
    if (isMajor(e) && e.t >= t0 && e.t <= t1) {
      majors += `<line x1="${X(e.t).toFixed(1)}" x2="${X(e.t).toFixed(1)}" y1="${pt}" y2="${Y(0)}" style="stroke:var(--warn);stroke-width:1.5;stroke-dasharray:4 3"/>`;
    }
  }
  const now = Date.now();
  const nowLine = now >= t0 && now <= t1
    ? `<line x1="${X(now).toFixed(1)}" x2="${X(now).toFixed(1)}" y1="${pt}" y2="${Y(0)}" style="stroke:var(--text);stroke-opacity:.45;stroke-width:1.5"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bite chance by hour">
    <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" style="stop-color:var(--accent);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/>
    </linearGradient></defs>
    ${grid}${majors}
    <path d="${area}" style="fill:url(#ga)"/>
    <path d="${line}" style="fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round"/>
    ${nowLine}${xl}
  </svg>`;
}

function renderForecast() {
  const el = $('#view-forecast');
  const scrolls = [...el.querySelectorAll('.chips')].map(c => c.scrollLeft);
  const c = target(), tz = state.bundle?.tz, day = state.days[state.dayIdx];
  const sp = SPECIES[state.species];

  let h = `<div class="page">
    <div class="title-row"><h1>Bite forecast</h1>
      <button class="icon-btn ${state.waterOverride != null ? 'on' : ''}" data-action="water" aria-label="Water temperature">${icon('thermo')}</button>
      <button class="icon-btn" data-action="refresh" aria-label="Refresh">${icon('refresh')}</button>
    </div>
    <div class="loc-row">${icon(state.picked ? 'pin' : 'nav')}
      <span>${state.picked ? esc(state.picked.name) : 'My location'}</span>
      ${state.waterOverride != null ? `<span class="muted small">· water ${state.waterOverride.toFixed(1)}°C measured</span>` : ''}
      <span class="spacer"></span>
      ${state.picked ? '<button class="link" data-action="use-gps">Use GPS</button>' : ''}
    </div>
    <div class="chips">${Object.entries(SPECIES).map(([k, s]) =>
      `<button class="chip ${k === state.species ? 'active' : ''}" data-action="species" data-key="${k}">${esc(s.name)}</button>`).join('')}</div>`;

  if (!c) {
    if (state.locating) {
      h += '<div class="spinner"></div><p class="muted" style="text-align:center">Finding your location…</p>';
    } else {
      h += `<div class="empty">${icon('locoff')}<h3>Location needed</h3>
        <p class="muted">${esc(state.gpsError || 'Allow location access, or pick a spot on the map.')}</p>
        <div class="btn-row"><button class="btn primary" data-action="locate">Try again</button><button class="btn" data-action="go-map">Pick on map</button></div></div>`;
    }
  } else if (!day) {
    if (state.error && !state.loading) {
      h += `<div class="empty">${icon('refresh')}<h3>Couldn't load the forecast</h3><p class="muted">${esc(state.error)}</p>
        <div class="btn-row"><button class="btn primary" data-action="refresh">Retry</button></div></div>`;
    } else {
      h += '<div class="spinner"></div><p class="muted" style="text-align:center">Loading weather…</p>';
    }
  } else {
    const isToday = state.dayIdx === 0;
    const now = Date.now();
    const nowHour = isToday ? day.hours.find(x => x.t <= now && now < x.t + HOUR) : null;
    if (state.error) h += `<div class="banner">${esc(state.error)}</div>`;

    h += `<div class="chips">${state.days.map((d, i) =>
      `<button class="daychip ${i === state.dayIdx ? 'active' : ''}" data-action="day" data-i="${i}">
        <div class="d">${i === 0 ? 'Today' : esc(fmtDay(d.start, tz))}</div><div class="v">${pct(d.dayChance)}</div></button>`).join('')}</div>`;

    h += `<div class="card score">
      <div class="ring-wrap">${ring(day.dayChance, scoreColor(day.dayChance))}<div class="ring-val"><b>${pct(day.dayChance)}</b><span>bite chance</span></div></div>
      <div><h3>${esc(sp.name)}</h3><div class="muted">${verdict(day.dayChance)}</div>
        <div class="small" style="margin-top:8px">Peak <b>${fmtTime(day.peak.t, tz)}</b> · ${pct(day.peak.chance)}</div>
        ${nowHour ? `<div class="small">Right now · ${pct(nowHour.chance)}</div>` : ''}
      </div></div>`;

    h += `<div class="card"><h2>Best times</h2><div class="windows">${day.windows.map(w =>
      `<span class="window">${fmtTime(w.start, tz)} – ${fmtTime(w.end, tz)}</span>`).join('')}</div></div>`;

    h += `<div class="card"><h2>Hour by hour</h2>${chart(day, tz)}
      <div class="legend"><span><i></i>Major moon period</span>${isToday ? '<span><i class="now"></i>Now</span>' : ''}</div></div>`;

    h += `<div class="card"><h2>Why – at ${fmtTime(day.peak.t, tz)}</h2><ul class="reasons">${reasons(day.peak, state.species).map(r =>
      `<li><span class="dot ${r.good ? 'good' : 'bad'}">${r.good ? '+' : '−'}</span><span>${esc(r.text)}</span></li>`).join('')}</ul></div>`;

    h += `<div class="card"><h2>Moon</h2><div class="row small">${icon('moon')}<span>${day.phase} · ${pct(day.illum)} lit</span></div>
      <div class="events">${day.events.map(e =>
        `<div class="${isMajor(e) ? '' : 'minor'}"><span class="tm">${fmtTime(e.t, tz)}</span><span>${EVENT_LABEL[e.kind]}</span></div>`).join('') || '<div class="muted">No moon events</div>'}</div></div>`;

    const p = day.peak, arrow = p.dp3 > 0.5 ? '↑' : p.dp3 < -0.5 ? '↓' : '→';
    h += `<div class="card"><h2>Conditions at ${fmtTime(p.t, tz)}</h2><dl class="kv">
      <dt>Air</dt><dd>${Math.round(p.w.air)} °C</dd>
      <dt>Water ${state.waterOverride != null ? '(measured)' : '(estimated)'}</dt><dd>${p.water.toFixed(1)} °C</dd>
      <dt>Pressure</dt><dd>${Math.round(p.w.pres)} hPa ${arrow} ${p.dp3 >= 0 ? '+' : ''}${p.dp3.toFixed(1)} in 3 h</dd>
      <dt>Wind</dt><dd>${Math.round(p.w.wind)} km/h, gusts ${Math.round(p.w.gust)}</dd>
      <dt>Clouds</dt><dd>${pct(p.w.cloud)}</dd>
      <dt>Rain</dt><dd>${p.w.rain.toFixed(1)} mm/h</dd></dl></div>`;

    h += `<div class="card row"><div style="flex:1"><h2 style="margin:0 0 2px">Where to fish</h2><div class="small muted">Best spots on a lake for ${esc(sp.name.toLowerCase())} from depth, drop-offs and wind</div></div>
      <button class="btn primary" data-action="go-spots">Map</button></div>`;

    h += `<p class="small muted">Bite chance is a science-based estimate from water temperature, light, pressure trend, wind, rain and moon periods. It is not a count of real catches. Weather: Open-Meteo.</p>`;
  }
  h += '</div>';
  el.innerHTML = h;
  el.querySelectorAll('.chips').forEach((c2, i) => { if (scrolls[i]) c2.scrollLeft = scrolls[i]; });
}

function openWaterSheet() {
  const est = state.bundle ? estimatedWaterNow(state.bundle) : null;
  state.sheetWater = state.waterOverride ?? (est != null ? Math.round(est * 2) / 2 : 12);
  openSheet(`<div class="sheet-head"><button class="link" data-action="close-sheet">Cancel</button><h2>Water temperature</h2><button class="link" data-action="water-save">Use</button></div>
    <div class="card"><div class="muted small">Estimated now</div>
      <div style="font-size:22px;font-weight:700">${est != null ? est.toFixed(1) + ' °C' : '–'}</div>
      <p class="small muted" style="margin-bottom:0">No weather service measures lake temperature, so it's estimated from the last 5 days of air temperature. A thermometer reading is more accurate, and water temperature is the biggest input to the score.</p></div>
    <div class="card"><div class="muted small" style="text-align:center">Your measurement</div>
      <div class="stepper"><button data-action="water-minus" aria-label="Lower">−</button><div class="water-val" id="wv">${state.sheetWater.toFixed(1)} °C</div><button data-action="water-plus" aria-label="Higher">+</button></div></div>
    ${state.waterOverride != null ? '<div class="btn-row"><button class="btn danger" data-action="water-clear">Go back to the estimate</button></div>' : ''}`);
}

function pickLocation(lat, lon, name) {
  state.picked = { lat, lon, name };
  store.set('picked', state.picked);
  state.waterOverride = null;
  state.dayIdx = 0;
  setTab('forecast');
  loadForecast();
}

// ---------- map ----------
let map = null, tiles = {}, spotLayer, catchLayer, predLayer, depthLayer, meMarker = null, pendingMarker = null, pendingLatLng = null;

const divIcon = (cls, ic, size) => L.divIcon({ className: '', html: `<div class="mk ${cls}">${icon(ic)}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

/** Depth bands + depth contours rendered by the geoportal.lt map service, one image per map tile. */
const DepthLayer = L.TileLayer.extend({
  getTileUrl(c) {
    const R = 20037508.342789244, size = 2 * R / Math.pow(2, c.z);
    const minx = -R + c.x * size, maxy = R - c.y * size;
    return BATHY_URL + '/export?' + new URLSearchParams({
      bbox: [minx, maxy - size, minx + size, maxy].map(v => v.toFixed(2)).join(','),
      bboxSR: '3857', imageSR: '3857', size: '512,512', dpi: '192',
      format: 'png32', transparent: 'true', layers: 'show:0,2,3,4', f: 'image',
    });
  },
});

const inLithuania = (lat, lon) => lat > BATHY_BOUNDS[0][0] && lat < BATHY_BOUNDS[1][0] && lon > BATHY_BOUNDS[0][1] && lon < BATHY_BOUNDS[1][1];

function showMap() {
  if (!map) {
    map = L.map('map', { zoomControl: false });
    tiles.std = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    tiles.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
    (state.satellite ? tiles.sat : tiles.std).addTo(map);
    depthLayer = new DepthLayer('', { tileSize: 256, opacity: 0.85, minZoom: 9, maxZoom: 19, bounds: BATHY_BOUNDS, attribution: 'Depth © geoportal.lt' });
    if (state.depthOn) depthLayer.addTo(map);
    predLayer = L.layerGroup().addTo(map);
    spotLayer = L.layerGroup().addTo(map);
    catchLayer = L.layerGroup().addTo(map);
    const c = target();
    map.setView(c ? [c.lat, c.lon] : [48, 10], c ? 13 : 4);
    map.on('click', e => setPending(e.latlng));
    renderMarkers();
    updateMe();
    updateMapTools();
  }
  setTimeout(() => map.invalidateSize(), 60);
}

function updateMapTools() {
  document.querySelector('[data-action="map-depth"]').classList.toggle('on-accent', state.depthOn);
  $('#depth-legend').hidden = !state.depthOn;
}

const compass = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const heatColor = s => s > 0.85 ? '#e8432e' : s > 0.72 ? '#f07a22' : '#f5b72e';

/** Water temperature and wind to feed the spot predictor, for the map's current centre. */
async function spotContext(lat, lon) {
  let b = state.bundle;
  const near = b && Math.hypot(b.lat - lat, (b.lon - lon) * Math.cos(lat * RAD)) < 0.3; // ~30 km
  if (!near) b = await fetchWeather(lat, lon);
  let water = estimatedWaterNow(b);
  if (near && state.waterOverride != null) water = state.waterOverride;
  const now = Date.now();
  const h = b.hours.reduce((a, x) => (Math.abs(x.t - now) < Math.abs(a.t - now) ? x : a));
  return { water, windDir: h.windDir ?? 0, windSpeed: h.wind, catches: state.catches };
}

async function findSpots() {
  clearPending();
  if (map.getZoom() < 12) { toast('Zoom in on one lake first'); return; }
  const b = map.getBounds(), ctr = b.getCenter();
  if (!inLithuania(ctr.lat, ctr.lng)) { panel(noDepthPanel()); return; }
  panel(`<h3>Finding spots…</h3><div class="spinner" style="margin:12px auto"></div><div class="small muted" style="text-align:center">Reading lake depths</div>`);
  let data, ctx;
  try {
    [data, ctx] = await Promise.all([
      fetchDepthPolygons(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()),
      spotContext(ctr.lat, ctr.lng),
    ]);
  } catch {
    panel(`<h3>Couldn't load depths</h3><div class="small muted">Check your connection and try again.</div><div class="btns"><button class="btn" data-action="panel-close">Close</button><button class="btn primary" data-action="find-spots">Retry</button></div>`);
    return;
  }
  if (!data.bands.length) { panel(noDepthPanel()); return; }
  const res = predictSpots(data, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], state.species, ctx);
  state.pred = { res, ctx, species: state.species, truncated: data.truncated };
  drawPrediction();
  showPredList();
}

function noDepthPanel() {
  return `<h3>No depth map here</h3><div class="small muted">Free depth maps exist for about 300 Lithuanian lakes, ponds, the Kaunas and Curonian lagoons and the coast. Turn on the depth layer (wave button) to see which lakes have one, then zoom in on it.</div>
    <div class="btns"><button class="btn" data-action="panel-close">Close</button></div>`;
}

function drawPrediction() {
  predLayer.clearLayers();
  const { res } = state.pred;
  const half = res.cellM / 2;
  for (const c of res.cells) {
    if (c.score < 0.55) continue;
    const dLat = half / 111320, dLon = half / (111320 * Math.cos(c.lat * RAD));
    L.rectangle([[c.lat - dLat, c.lon - dLon], [c.lat + dLat, c.lon + dLon]],
      { stroke: false, fillColor: heatColor(c.score), fillOpacity: 0.15 + 0.4 * (c.score - 0.55) / 0.45, interactive: false }).addTo(predLayer);
  }
  res.spots.forEach((s, i) => {
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="mk mk-pred">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 500 })
      .on('click', () => showPredSpot(i)).addTo(predLayer);
  });
}

function showPredList() {
  const { res, ctx, truncated } = state.pred;
  const sel = `<select id="pred-species" class="pred-select">${Object.entries(SPECIES).map(([k, s]) => `<option value="${k}" ${k === state.species ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  const head = `<div class="row" style="margin-bottom:4px"><h3 style="margin:0">Best spots</h3><span class="spacer"></span>${sel}</div>
    <div class="small muted">Water ~${ctx.water.toFixed(0)}°C → aiming for ${res.range[0]}–${res.range[1]} m · wind ${compass(ctx.windDir)} ${Math.round(ctx.windSpeed)} km/h${truncated ? ' · zoom in for full detail' : ''}</div>`;
  const list = res.spots.length
    ? `<div class="pred-list">${res.spots.map((s, i) => `<button class="pred-item" data-action="pred-go" data-i="${i}"><span class="pred-num">${i + 1}</span><span><b>${esc(s.reasons[0])}</b>${s.reasons[1] ? `<br><span class="muted">${esc(s.reasons[1])}</span>` : ''}</span></button>`).join('')}</div>`
    : `<p class="small muted">No water in view matches what ${esc(SPECIES[state.species].name.toLowerCase())} want right now. Try zooming out to the whole lake.</p>`;
  panel(head + list + `<div class="btns"><button class="btn" data-action="pred-clear">Clear</button><button class="btn" data-action="panel-close">Hide</button></div>`);
}

function showPredSpot(i) {
  const s = state.pred.res.spots[i];
  state.predIdx = i;
  panel(`<h3>Spot ${i + 1} · ${esc(SPECIES[state.pred.species].name)}</h3>
    <ul class="reasons">${s.reasons.map(r => `<li><span class="dot good">+</span><span>${esc(r)}</span></li>`).join('')}</ul>
    <div class="small muted" style="margin-top:8px">Score ${pct(s.score)} of the best water in view · ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>
    <div class="btns"><button class="btn" data-action="pred-back">List</button><button class="btn" data-action="pred-save">Save</button><button class="btn primary" data-action="pred-forecast">Forecast</button></div>`);
}

function renderMarkers() {
  if (!map) return;
  spotLayer.clearLayers();
  catchLayer.clearLayers();
  for (const s of state.spots) {
    L.marker([s.lat, s.lon], { icon: divIcon('mk-spot', 'pin', 34), title: s.name }).on('click', () => showSpotPanel(s)).addTo(spotLayer);
  }
  for (const c of state.catches) {
    if (c.lat == null) continue;
    L.marker([c.lat, c.lon], { icon: divIcon('mk-catch', 'fish', 28) }).on('click', () => showCatchPanel(c)).addTo(catchLayer);
  }
}

function updateMe() {
  if (!map || !state.gps) return;
  const ll = [state.gps.lat, state.gps.lon];
  if (!meMarker) meMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f80ed', fillOpacity: 1 }).addTo(map);
  else meMarker.setLatLng(ll);
}

function panel(html) {
  const p = $('#map-panel');
  if (html == null) { p.hidden = true; p.innerHTML = ''; $('#map-hint').hidden = false; return; }
  p.innerHTML = html; p.hidden = false; $('#map-hint').hidden = true;
}

function setPending(ll) {
  pendingLatLng = ll;
  if (!pendingMarker) pendingMarker = L.marker(ll, { icon: divIcon('mk-new', 'plus', 34) }).addTo(map);
  else pendingMarker.setLatLng(ll);
  const lt = inLithuania(ll.lat, ll.lng);
  panel(`<h3>New spot</h3>
    <input id="spot-name" placeholder="Spot name" maxlength="40" autocomplete="off"
      style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);outline:none">
    <div class="small muted" style="margin-top:6px">${lt ? '<span id="pin-depth">Depth: checking…</span> · ' : ''}${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}</div>
    <div class="btns"><button class="btn" data-action="pin-cancel">Cancel</button><button class="btn" data-action="pin-forecast">Forecast</button><button class="btn primary" data-action="pin-save">Save</button></div>`);
  if (lt) {
    depthAtPoint(ll.lat, ll.lng).then(d => {
      const el = $('#pin-depth');
      if (el && pendingLatLng === ll) el.innerHTML = d == null ? 'No depth data here' : `Depth: <b>${d}+ m</b>`;
    }).catch(() => { const el = $('#pin-depth'); if (el) el.textContent = 'Depth: unavailable offline'; });
  }
}

function clearPending() {
  pendingLatLng = null;
  if (pendingMarker) { pendingMarker.remove(); pendingMarker = null; }
  panel(null);
}

function showSpotPanel(s) {
  clearPending();
  state.panelSpot = s;
  panel(`<h3>${esc(s.name)}</h3><div class="small muted">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>
    <div class="btns"><button class="btn danger" data-action="spot-delete">Delete</button><button class="btn" data-action="panel-close">Close</button><button class="btn primary" data-action="spot-forecast">Forecast</button></div>`);
}

function showCatchPanel(c) {
  clearPending();
  const size = [c.weight != null ? c.weight + ' kg' : '', c.length != null ? c.length + ' cm' : ''].filter(Boolean).join(' · ');
  panel(`<h3>${esc(SPECIES[c.species]?.name || c.species)}</h3><div class="small muted">${fmtDateTime(c.t)}${size ? ' · ' + esc(size) : ''}</div>
    <div class="btns"><button class="btn" data-action="panel-close">Close</button><button class="btn primary" data-action="open-catch" data-id="${c.id}">Open</button></div>`);
}

// ---------- catches ----------
const objUrls = new Map();
function photoUrl(c) {
  if (!c.photo) return null;
  let u = objUrls.get(c.id);
  if (!u) { u = URL.createObjectURL(c.photo); objUrls.set(c.id, u); }
  return u;
}
const sortCatches = () => state.catches.sort((a, b) => b.t - a.t);

function sizeText(c) {
  const parts = [];
  if (c.weight != null) parts.push(c.weight + ' kg');
  if (c.length != null) parts.push(c.length + ' cm');
  if (c.bait) parts.push(c.bait);
  return parts.join(' · ');
}

function renderCatches() {
  const el = $('#view-catches'), list = state.catches;
  let h = `<div class="page"><div class="title-row"><h1>Catch log</h1>
    <button class="icon-btn" data-action="backup" aria-label="Backup">${icon('share')}</button>
    <button class="icon-btn" data-action="add-catch" aria-label="Log a catch">${icon('plus')}</button></div>`;

  if (!list.length) {
    h += `<div class="empty">${icon('fish')}<h3>No catches yet</h3>
      <p class="muted">Log a fish and the weather, pressure and moon at that moment are saved with it.</p>
      <div class="btn-row"><button class="btn primary" data-action="add-catch">Log a catch</button><button class="btn" data-action="import">Restore backup</button></div></div>`;
  } else {
    const scored = list.filter(c => c.cond).map(c => c.cond.chance);
    const counts = {};
    for (const c of list) counts[c.species] = (counts[c.species] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    h += `<div class="card stats">
      <div><b>${list.length}</b><span>Catches</span></div>
      <div><b>${esc(SPECIES[top[0]]?.name || top[0])}</b><span>Top species</span></div>
      <div><b>${scored.length ? pct(scored.reduce((a, b) => a + b, 0) / scored.length) : '–'}</b><span>Model score when caught</span></div></div>
      <div class="section-label">All catches</div><div class="list">`;
    for (const c of list) {
      const u = photoUrl(c);
      h += `<button class="item" data-action="open-catch" data-id="${c.id}">
        <div class="thumb">${u ? `<img src="${u}" alt="">` : icon('fish')}</div>
        <div style="min-width:0"><div class="t1">${esc(SPECIES[c.species]?.name || c.species)}</div>
          ${sizeText(c) ? `<div class="t2">${esc(sizeText(c))}</div>` : ''}<div class="t3">${fmtDateTime(c.t)}</div></div>
        ${c.cond ? `<span class="score-pill">${pct(c.cond.chance)}</span>` : ''}</button>`;
    }
    h += '</div>';
  }
  h += '</div>';
  el.innerHTML = h;
}

// --- add catch ---
let draft = null;

function openAddCatch() {
  draft = { photo: null, url: null };
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openSheet(`<div class="sheet-head"><button class="link" data-action="close-sheet">Cancel</button><h2>Log catch</h2><button class="link" data-action="save-catch">Save</button></div>
    <div id="photo-area"></div>
    <div class="form">
      <div class="field"><label for="f-species">Species</label><select id="f-species">${Object.entries(SPECIES).map(([k, s]) =>
        `<option value="${k}" ${k === state.species ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="f-weight">Weight (kg)</label><input id="f-weight" inputmode="decimal" placeholder="–" autocomplete="off"></div>
      <div class="field"><label for="f-length">Length (cm)</label><input id="f-length" inputmode="decimal" placeholder="–" autocomplete="off"></div>
      <div class="field"><label for="f-date">Caught</label><input id="f-date" type="datetime-local" value="${local}" max="${local}"></div>
    </div>
    <div class="form">
      <div class="field"><label for="f-bait">Lure / bait</label><input id="f-bait" placeholder="e.g. spinner, worm" maxlength="80" autocomplete="off"></div>
      <div class="field stack"><label for="f-notes">Notes</label><textarea id="f-notes" rows="3" maxlength="1000" placeholder="Depth, retrieve, water colour…"></textarea></div>
    </div>
    <div class="form"><div class="field"><label for="f-loc">Location</label><select id="f-loc"></select></div></div>
    <div class="form-note" id="loc-note"></div>`);
  renderPhotoArea();
  fillLocOptions();
  refreshGps().then(() => { if ($('#f-loc')) fillLocOptions(); });
}

function renderPhotoArea() {
  const a = $('#photo-area');
  if (!a) return;
  a.innerHTML = draft.url
    ? `<img class="photo-preview" src="${draft.url}" alt="Catch photo"><div class="photo-btns"><button class="btn" data-action="photo-camera">${icon('camera')} Retake</button><button class="btn danger" data-action="photo-remove">Remove</button></div>`
    : `<div class="photo-btns"><button class="btn" data-action="photo-camera">${icon('camera')} Take photo</button><button class="btn" data-action="photo-library">${icon('image')} Library</button></div>`;
}

function fillLocOptions() {
  const sel = $('#f-loc'), prev = sel.value;
  const opts = [];
  if (state.gps) opts.push(['gps', `Current GPS (±${Math.round(state.gps.acc || 0)} m)`]);
  if (state.picked) opts.push(['picked', 'Map pin: ' + state.picked.name]);
  for (const s of state.spots) opts.push(['spot:' + s.id, 'Spot: ' + s.name]);
  opts.push(['none', "Don't save location"]);
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  if (prev && opts.some(o => o[0] === prev)) sel.value = prev;
  $('#loc-note').textContent = state.gps ? 'Weather and bite score at catch time are saved automatically (needs internet, catches up to 6 days old).'
    : state.locating ? 'Finding your GPS position…' : (state.gpsError || 'No GPS position.');
}

function resolveLoc(v) {
  if (v === 'gps' && state.gps) return { lat: state.gps.lat, lon: state.gps.lon };
  if (v === 'picked' && state.picked) return { lat: state.picked.lat, lon: state.picked.lon };
  if (v && v.startsWith('spot:')) { const s = state.spots.find(x => x.id === v.slice(5)); if (s) return { lat: s.lat, lon: s.lon }; }
  return null;
}

async function resizeImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * s);
    cv.height = Math.round(img.naturalHeight * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function onPhotoPicked(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f || !draft) return;
  try {
    const blob = await resizeImage(f);
    if (!blob) throw new Error('resize failed');
    if (draft.url) URL.revokeObjectURL(draft.url);
    draft.photo = blob;
    draft.url = URL.createObjectURL(blob);
    renderPhotoArea();
  } catch {
    toast("Couldn't read that photo");
  }
}

async function saveCatch() {
  const t = $('#f-date').value ? new Date($('#f-date').value).getTime() : Date.now();
  const loc = resolveLoc($('#f-loc').value);
  const rec = {
    id: uid(), species: $('#f-species').value, t: Math.min(t, Date.now()),
    weight: num($('#f-weight').value), length: num($('#f-length').value),
    bait: $('#f-bait').value.trim(), notes: $('#f-notes').value.trim(),
    photo: draft.photo, lat: loc ? loc.lat : null, lon: loc ? loc.lon : null,
    cond: null, moon: moonIllumination(t), created: Date.now(), isPublic: false,
  };
  try {
    await dbPut('catches', rec);
  } catch {
    toast("Couldn't save – phone storage may be full");
    return;
  }
  if (draft.url) URL.revokeObjectURL(draft.url);
  draft = null;
  state.catches.push(rec);
  sortCatches();
  closeSheet();
  renderCatches();
  renderMarkers();
  persistStorage();
  toast('Catch saved');
  if (rec.lat != null) fillConditions(rec, true);
}

async function fillConditions(rec, quiet) {
  try {
    const cond = await catchConditions(rec.lat, rec.lon, rec.t, rec.species);
    if (!cond) { if (!quiet) toast('No weather available for that time (older than 6 days)'); return; }
    rec.cond = cond;
    await dbPut('catches', rec);
    if (state.tab === 'catches') renderCatches();
    if (state.detailId === rec.id) updateSheet(detailHtml(rec));
  } catch {
    if (!quiet) toast('Offline – try again when you have signal');
  }
}

// --- detail ---
function openCatchDetail(id) {
  const c = state.catches.find(x => x.id === id);
  if (!c) return;
  openSheet(detailHtml(c));
  state.detailId = id;
}

function detailHtml(c) {
  const u = photoUrl(c), k = c.cond;
  const canFetch = !k && c.lat != null && c.t > Date.now() - 6 * DAY;
  return `<div class="sheet-head"><button class="link" data-action="close-sheet">Close</button><h2>${esc(SPECIES[c.species]?.name || c.species)}</h2><span class="link"></span></div>
    ${u ? `<img class="detail-photo" src="${u}" alt="Catch photo">` : ''}
    <div class="card"><dl class="kv">
      <dt>Caught</dt><dd>${fmtDateTime(c.t)}</dd>
      ${c.weight != null ? `<dt>Weight</dt><dd>${c.weight} kg</dd>` : ''}
      ${c.length != null ? `<dt>Length</dt><dd>${c.length} cm</dd>` : ''}
      ${c.bait ? `<dt>Lure / bait</dt><dd>${esc(c.bait)}</dd>` : ''}
    </dl>${c.notes ? `<p style="margin:12px 0 0;white-space:pre-wrap">${esc(c.notes)}</p>` : ''}</div>
    <div class="card"><h2>Conditions</h2>
      ${k ? `<dl class="kv">
        <dt>Model bite score</dt><dd><b>${pct(k.chance)}</b></dd>
        <dt>Air</dt><dd>${Math.round(k.air)} °C</dd>
        <dt>Water (est.)</dt><dd>${k.water.toFixed(1)} °C</dd>
        <dt>Pressure</dt><dd>${Math.round(k.pres)} hPa (${k.dp3 >= 0 ? '+' : ''}${k.dp3.toFixed(1)} in 3 h)</dd>
        <dt>Wind</dt><dd>${Math.round(k.wind)} km/h</dd>
        <dt>Clouds</dt><dd>${pct(k.cloud)}</dd>
        <dt>Moon</dt><dd>${moonPhaseName(c.t)} · ${pct(c.moon ?? moonIllumination(c.t))} lit</dd></dl>`
      : canFetch ? `<p class="muted small">Weather wasn't saved yet (probably no signal at the time).</p><button class="btn primary" data-action="fetch-cond" data-id="${c.id}">Fetch weather for this catch</button>`
      : `<p class="muted small">No weather saved for this catch.</p><dl class="kv"><dt>Moon</dt><dd>${moonPhaseName(c.t)} · ${pct(c.moon ?? moonIllumination(c.t))} lit</dd></dl>`}
    </div>
    <div class="btn-row">
      ${c.lat != null ? `<button class="btn" data-action="show-on-map" data-id="${c.id}">${icon('map')} Show on map</button>` : ''}
      <button class="btn danger" data-action="delete-catch" data-id="${c.id}">Delete catch</button>
    </div>`;
}

// --- backup ---
function openBackup() {
  openSheet(`<div class="sheet-head"><span class="link"></span><h2>Backup</h2><button class="link" data-action="close-sheet">Done</button></div>
    <div class="card"><p style="margin-top:0">Your catches and spots are stored only on this phone, inside this app. Deleting the app from the home screen or clearing Safari data erases them.</p>
      <p class="muted small" style="margin-bottom:0">Export a backup file now and then and save it to Files or iCloud Drive.</p></div>
    <div class="btn-row"><button class="btn primary" data-action="export">${icon('share')} Export backup</button><button class="btn" data-action="import">Restore from file</button></div>`);
}

const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

async function exportData() {
  try {
    const catches = await Promise.all(state.catches.map(async c => ({ ...c, photo: c.photo ? await blobToDataURL(c.photo) : null })));
    const data = { app: 'FishCast', version: 1, exported: new Date().toISOString(), spots: state.spots, catches };
    const name = `fishcast-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'FishCast backup' }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch {
    toast('Export failed');
  }
}

async function importData(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'FishCast' || !Array.isArray(data.catches)) throw new Error('not a backup');
    for (const s of data.spots || []) await dbPut('spots', s);
    for (const c of data.catches) {
      const photo = c.photo ? await (await fetch(c.photo)).blob() : null;
      await dbPut('catches', { ...c, photo });
    }
    state.catches = await dbAll('catches'); sortCatches();
    state.spots = await dbAll('spots');
    closeSheet(); renderCatches(); renderMarkers(); persistStorage();
    toast(`Restored ${data.catches.length} catches and ${(data.spots || []).length} spots`);
  } catch {
    toast("That file isn't a FishCast backup");
  }
}

// ---------- sheets ----------
function openSheet(html) {
  closeSheet();
  const b = document.createElement('div');
  b.className = 'backdrop'; b.id = 'sheet';
  b.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  b.addEventListener('click', e => { if (e.target === b) closeSheet(); });
  document.body.appendChild(b);
}
function closeSheet() { $('#sheet')?.remove(); state.detailId = null; }
function updateSheet(html) { const s = $('#sheet .sheet'); if (s) s.innerHTML = html; }

// ---------- actions ----------
const ACTIONS = {
  'species': a => { state.species = a.dataset.key; store.set('species', state.species); recompute(); renderForecast(); },
  'day': a => { state.dayIdx = +a.dataset.i; renderForecast(); },
  'refresh': () => loadForecast(true),
  'locate': async () => { await refreshGps(); loadForecast(); },
  'go-map': () => setTab('map'),
  'use-gps': async () => {
    state.picked = null; store.set('picked', null); state.waterOverride = null; state.dayIdx = 0;
    if (!state.gps) await refreshGps();
    loadForecast();
  },
  'water': () => openWaterSheet(),
  'water-minus': () => { state.sheetWater = Math.max(0, state.sheetWater - 0.5); $('#wv').textContent = state.sheetWater.toFixed(1) + ' °C'; },
  'water-plus': () => { state.sheetWater = Math.min(35, state.sheetWater + 0.5); $('#wv').textContent = state.sheetWater.toFixed(1) + ' °C'; },
  'water-save': () => { state.waterOverride = state.sheetWater; closeSheet(); recompute(); renderForecast(); },
  'water-clear': () => { state.waterOverride = null; closeSheet(); recompute(); renderForecast(); },
  'close-sheet': () => closeSheet(),

  'map-locate': async () => {
    await refreshGps();
    if (state.gps) map.setView([state.gps.lat, state.gps.lon], Math.max(map.getZoom(), 14));
    else toast(state.gpsError || 'Location unavailable');
  },
  'map-layers': () => {
    state.satellite = !state.satellite; store.set('satellite', state.satellite);
    if (state.satellite) { tiles.std.remove(); tiles.sat.addTo(map); } else { tiles.sat.remove(); tiles.std.addTo(map); }
    toast(state.satellite ? 'Satellite view' : 'Map view');
  },
  'map-depth': () => {
    state.depthOn = !state.depthOn; store.set('depthOn', state.depthOn);
    if (state.depthOn) depthLayer.addTo(map); else depthLayer.remove();
    updateMapTools();
    if (state.depthOn && map.getZoom() < 10) toast('Zoom in on a lake to see depths');
  },
  'find-spots': () => findSpots(),
  'pred-go': a => {
    const i = +a.dataset.i, s = state.pred.res.spots[i];
    map.setView([s.lat, s.lon], Math.max(map.getZoom(), 15));
    showPredSpot(i);
  },
  'pred-back': () => showPredList(),
  'pred-clear': () => { predLayer.clearLayers(); state.pred = null; panel(null); },
  'pred-save': async () => {
    const i = state.predIdx, s = state.pred.res.spots[i];
    const spot = { id: uid(), name: `${SPECIES[state.pred.species].name} spot ${i + 1}`, lat: s.lat, lon: s.lon, created: Date.now() };
    await dbPut('spots', spot);
    state.spots.push(spot); renderMarkers(); persistStorage();
    toast('Saved as "' + spot.name + '"');
  },
  'pred-forecast': () => {
    const s = state.pred.res.spots[state.predIdx];
    panel(null);
    pickLocation(s.lat, s.lon, `${SPECIES[state.pred.species].name} spot ${state.predIdx + 1}`);
  },
  'go-spots': () => {
    setTab('map');
    const c = target();
    setTimeout(() => {
      if (c) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 14));
      toast('Centre one lake on screen, then tap Find spots');
    }, 100);
  },
  'pin-cancel': () => clearPending(),
  'pin-forecast': () => {
    if (!pendingLatLng) return;
    const name = $('#spot-name')?.value.trim() || 'Dropped pin';
    const { lat, lng } = pendingLatLng;
    clearPending();
    pickLocation(lat, lng, name);
  },
  'pin-save': async () => {
    if (!pendingLatLng) return;
    const s = { id: uid(), name: $('#spot-name')?.value.trim() || 'Spot ' + (state.spots.length + 1), lat: pendingLatLng.lat, lon: pendingLatLng.lng, created: Date.now() };
    await dbPut('spots', s);
    state.spots.push(s);
    clearPending(); renderMarkers(); persistStorage();
    toast('Spot saved');
  },
  'panel-close': () => { state.panelSpot = null; panel(null); },
  'spot-forecast': () => { const s = state.panelSpot; if (!s) return; panel(null); pickLocation(s.lat, s.lon, s.name); },
  'spot-delete': async () => {
    const s = state.panelSpot;
    if (!s || !confirm(`Delete the spot "${s.name}"?`)) return;
    await dbDel('spots', s.id);
    state.spots = state.spots.filter(x => x.id !== s.id);
    state.panelSpot = null; panel(null); renderMarkers();
  },

  'add-catch': () => openAddCatch(),
  'photo-camera': () => $('#in-camera').click(),
  'photo-library': () => $('#in-library').click(),
  'photo-remove': () => { if (draft?.url) URL.revokeObjectURL(draft.url); draft.photo = null; draft.url = null; renderPhotoArea(); },
  'save-catch': () => saveCatch(),
  'open-catch': a => openCatchDetail(a.dataset.id),
  'fetch-cond': async a => {
    const c = state.catches.find(x => x.id === a.dataset.id);
    if (!c) return;
    a.disabled = true; a.textContent = 'Fetching…';
    await fillConditions(c, false);
    if (!c.cond && state.detailId === c.id) updateSheet(detailHtml(c));
  },
  'show-on-map': a => {
    const c = state.catches.find(x => x.id === a.dataset.id);
    if (!c) return;
    closeSheet(); setTab('map');
    setTimeout(() => { map.setView([c.lat, c.lon], 15); showCatchPanel(c); }, 80);
  },
  'delete-catch': async a => {
    const id = a.dataset.id;
    if (!confirm('Delete this catch? This cannot be undone.')) return;
    await dbDel('catches', id);
    if (objUrls.has(id)) { URL.revokeObjectURL(objUrls.get(id)); objUrls.delete(id); }
    state.catches = state.catches.filter(x => x.id !== id);
    closeSheet(); renderCatches(); renderMarkers();
  },
  'backup': () => openBackup(),
  'export': () => exportData(),
  'import': () => $('#in-import').click(),
};

document.addEventListener('change', e => {
  if (e.target.id === 'pred-species') {
    state.species = e.target.value; store.set('species', state.species);
    recompute();
    findSpots();
  }
});

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { setTab(tab.dataset.tab); return; }
  const a = e.target.closest('[data-action]');
  if (a && ACTIONS[a.dataset.action]) ACTIONS[a.dataset.action](a, e);
});

// ---------- start ----------
async function init() {
  $('#tabbar').innerHTML = [['forecast', 'chart', 'Forecast'], ['map', 'map', 'Map'], ['catches', 'fish', 'Catches']]
    .map(([k, ic, label]) => `<button data-tab="${k}" class="${k === 'forecast' ? 'active' : ''}">${icon(ic)}<span>${label}</span></button>`).join('');
  document.querySelector('[data-action="map-locate"]').innerHTML = icon('nav');
  document.querySelector('[data-action="map-layers"]').innerHTML = icon('layers');
  document.querySelector('[data-action="map-depth"]').innerHTML = icon('depth');
  document.querySelector('[data-action="find-spots"]').innerHTML = icon('target') + '<span>Find spots</span>';

  $('#in-camera').addEventListener('change', e => onPhotoPicked(e.target));
  $('#in-library').addEventListener('change', e => onPhotoPicked(e.target));
  $('#in-import').addEventListener('change', e => importData(e.target));

  try {
    state.catches = await dbAll('catches'); sortCatches();
    state.spots = await dbAll('spots');
  } catch {
    toast('Storage unavailable – catches cannot be saved in this browser mode');
  }

  renderForecast();
  if (state.picked) loadForecast();
  await refreshGps();
  if (!state.picked) loadForecast();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.bundle && Date.now() - state.bundle.fetched > 30 * 60000) loadForecast(true);
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
