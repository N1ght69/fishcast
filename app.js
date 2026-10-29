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
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  stock: '<path d="M2.5 15c2.2-3.4 5.3-5 8.7-5 2.6 0 4.3 1.3 5.4 2.6l2.1-1.9v8.6l-2.1-1.9c-1.1 1.2-2.8 2.6-5.4 2.6-3.4 0-6.5-1.6-8.7-5z"/><path d="M11 1.5v5M8.5 4l2.5 2.5L13.5 4"/>',
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
  stockOn: store.get('stockOn', true),
  fcTab: store.get('fcTab', 'bite'),
  selT: null, scrollX: null, scores: null,
  stockLakes: new Map(), // cadastral id → lake with stocking events
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
  if (state.loadedFor !== key) { state.days = []; state.scores = null; state.selT = null; state.scrollX = null; }
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
  state.scores = {};
  for (const k of Object.keys(SPECIES)) {
    state.scores[k] = hourScores(b, k, state.coord.lat, state.coord.lon, off, state.events);
  }
  state.days = buildDays(state.scores[state.species], state.events, b.tz);
}

const verdict = v => v >= 0.75 ? 'Excellent' : v >= 0.55 ? 'Good' : v >= 0.35 ? 'Fair' : 'Tough';

// ---------- forecast layout ----------
const HOUR_W = 46, AXIS_W = 44, SPAN_H = 74; // ~3 days of hours

/** Visible window: from 2 h before now, 74 hours. Returns index range into the score arrays. */
function forecastWindow() {
  const sc = (state.scores && state.scores[state.species]) || [];
  const now = Date.now();
  let i0 = sc.findIndex(h => h.t + HOUR > now);
  if (i0 < 0) i0 = 0;
  i0 = Math.max(0, i0 - 2);
  return [i0, Math.min(sc.length, i0 + SPAN_H)];
}

const FISH_TINT = { pike: '#6f8a3c', perch: '#c3a12c', zander: '#7d8a8c', bass: '#55803f', trout: '#9a6b4a', carp: '#c88c2c', bream: '#9c8a5a', catfish: '#4f5a5e' };
const fishArt = k => `<svg class="fish-art" viewBox="0 0 120 44" aria-hidden="true">
  <path d="M6 22c14-15 40-19 64-14 9 2 15 6 20 9l22-11-6 16 6 16-22-11c-5 3-11 7-20 9-24 5-50 1-64-14z" style="fill:${FISH_TINT[k]}"/>
  <path d="M46 9c6-4 14-5 20-3l-4 6zM50 35l8 5 4-6z" style="fill:${FISH_TINT[k]};opacity:.75"/>
  <circle cx="20" cy="20" r="2.6" style="fill:#fff"/><circle cx="20" cy="20" r="1.3" style="fill:#111"/>
  <path d="M30 13c3 5 3 13 0 18" style="fill:none;stroke:rgba(0,0,0,.25);stroke-width:1.5"/></svg>`;

// Weather icons (own drawings)
function wxIcon(code, isDay) {
  const sun = '<circle cx="12" cy="12" r="4.5" style="fill:#f5c518"/><g style="stroke:#f5c518;stroke-width:2;stroke-linecap:round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g>';
  const moon = '<path d="M17 15.5A7 7 0 0 1 9.5 5a7.5 7.5 0 1 0 7.5 10.5z" style="fill:#c9d3e6"/>';
  const cloud = (dy = 0, fill = 'var(--cloud)') => `<path transform="translate(0 ${dy})" d="M7 19h10a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 7.2 9.6 4.7 4.7 0 0 0 7 19z" style="fill:${fill}"/>`;
  const drops = '<g style="stroke:#4a90d9;stroke-width:1.8;stroke-linecap:round"><path d="M9 20.5l-1 2.5M13 20.5l-1 2.5M17 20.5l-1 2.5"/></g>';
  const flakes = '<g style="fill:#9cc3e8"><circle cx="9" cy="22" r="1.2"/><circle cx="13" cy="22.5" r="1.2"/><circle cx="17" cy="22" r="1.2"/></g>';
  const bolt = '<path d="M13 17l-3 5h3l-1 3 4-6h-3l1-2z" style="fill:#f5c518"/>';
  let body;
  if (code <= 1) body = isDay ? sun : moon;
  else if (code === 2) body = `<g transform="translate(5 -4) scale(.7)">${isDay ? sun : moon}</g>${cloud(1)}`;
  else if (code === 45 || code === 48) body = `${cloud(-2)}<g style="stroke:var(--cloud);stroke-width:1.8;stroke-linecap:round"><path d="M5 21h14M7 23.5h10"/></g>`;
  else if (code >= 95) body = `${cloud(-3, 'var(--cloud-dark)')}${bolt}`;
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) body = `${cloud(-3)}${flakes}`;
  else if (code >= 51) body = `${cloud(-3, 'var(--cloud-dark)')}${drops}`;
  else body = cloud();
  return `<svg viewBox="0 0 24 26" class="wx">${body}</svg>`;
}

const windArrow = (fromDeg, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${(fromDeg + 180) % 360}deg)" aria-hidden="true"><path d="M12 3v17M6 9l6-6 6 6" style="fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"/></svg>`;

/** A horizontally scrolling chart row with a fixed y-axis on the left. */
function row(title, height, axisLabels, svgInner, H, extra = '') {
  const W = H.length * HOUR_W;
  const sel = H.findIndex(h => h.t === state.selT);
  const hl = sel >= 0 ? `<rect x="${sel * HOUR_W}" y="0" width="${HOUR_W}" height="${height}" class="sel-col"/>` : '';
  const hit = H.map((h, i) => `<rect x="${i * HOUR_W}" y="0" width="${HOUR_W}" height="${height}" class="hit" data-action="sel-hour" data-t="${h.t}"/>`).join('');
  const axis = axisLabels.map(a => `<span style="top:${a.y}px">${a.label}</span>`).join('');
  return `<section class="frow">${title ? `<div class="frow-title">${title}</div>` : ''}${extra}
    <div class="frow-body" style="height:${height}px"><div class="axis">${axis}</div>
      <div class="hscroll"><svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${hl}${svgInner}${hit}</svg></div></div></section>`;
}

const gridLines = (W, ys) => ys.map(y => `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="grid"/>`).join('');

function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

function timelineHtml(H, tz) {
  const W = H.length * HOUR_W, today = dayKey(Date.now(), tz), tomorrow = dayKey(Date.now() + DAY, tz);
  let days = '', hours = '';
  H.forEach((h, i) => {
    const lh = localHour(h.t, tz), x = i * HOUR_W;
    if (i === 0 || lh === 0) {
      const k = dayKey(h.t, tz);
      const label = k === today ? 'Today' : k === tomorrow ? 'Tomorrow' : fmtDay(h.t, tz);
      let end = W;
      for (let j = i + 1; j < H.length; j++) if (localHour(H[j].t, tz) === 0) { end = j * HOUR_W; break; }
      if (i) days += `<div class="tl-divl" style="left:${x}px"></div>`;
      days += `<div class="tl-day" data-start="${x}" data-end="${end}" style="left:${x}px">${esc(label)}</div>`;
    }
    hours += `<button class="tl-hour ${h.t === state.selT ? 'sel' : ''}" style="left:${x}px;width:${HOUR_W}px" data-action="sel-hour" data-t="${h.t}">${String(lh).padStart(2, '0')}</button>`;
  });
  const sel = H.findIndex(h => h.t === state.selT);
  const dot = sel >= 0 ? `<div class="tl-dot" style="left:${sel * HOUR_W + HOUR_W / 2}px"></div>` : '';
  return `<div class="tl"><div class="hscroll"><div class="tl-inner" style="width:${W}px">${days}<div class="tl-line"></div>${dot}${hours}</div></div></div>`;
}

// ---------- bite times tab ----------
const biteClass = c => c >= 0.7 ? 'b4' : c >= 0.5 ? 'b3' : c >= 0.32 ? 'b2' : 'b1';

function biteRows(i0, i1, H, tz) {
  const keys = [state.species, ...Object.keys(SPECIES).filter(k => k !== state.species)];
  return keys.map(k => {
    const sc = state.scores[k].slice(i0, i1);
    const height = 104, top = 6;
    const yMax = Math.min(1, Math.max(0.5, Math.ceil(Math.max(...sc.map(s => s.chance)) * 10) / 10));
    const Y = v => top + (1 - v / yMax) * (height - top);
    const W = sc.length * HOUR_W;
    const bars = sc.map((s, i) => {
      const y = Y(s.chance);
      return `<rect x="${i * HOUR_W + 4}" y="${y.toFixed(1)}" width="${HOUR_W - 8}" height="${(height - y).toFixed(1)}" rx="3" class="bar ${biteClass(s.chance)}"/>`;
    }).join('');
    const mid = yMax / 2;
    const axis = [{ y: Y(yMax) - 7, label: Math.round(yMax * 100) + '%' }, { y: Y(mid) - 7, label: Math.round(mid * 100) + '%' }, { y: height - 14, label: '0%' }];
    const sel = sc.find(s => s.t === state.selT);
    const head = `<div class="sp-head ${k === state.species ? 'main' : ''}">
      <button class="sp-name" data-action="species" data-key="${k}">${esc(SPECIES[k].name)}${k === state.species ? ' <span class="star">★</span>' : ''}</button>
      ${sel ? `<span class="sp-now">${pct(sel.chance)} at ${String(localHour(sel.t, tz)).padStart(2, '0')}:00</span>` : ''}
      ${fishArt(k)}</div>`;
    return row('', height, axis, gridLines(W, [Y(yMax), Y(mid)]) + bars, sc, head);
  }).join('');
}

function bestTimesCard(tz) {
  const days = state.days.slice(0, 3);
  if (!days.length) return '';
  return `<div class="card"><h2>Best times · ${esc(SPECIES[state.species].name)}</h2>
    ${days.map((d, i) => `<div class="win-day"><div class="win-label">${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : esc(fmtDay(d.start, tz))} · ${pct(d.dayChance)} ${verdict(d.dayChance).toLowerCase()}</div>
      <div class="windows">${d.windows.map(w => `<span class="window">${fmtTime(w.start, tz)} – ${fmtTime(w.end, tz)}</span>`).join('')}</div></div>`).join('')}</div>`;
}

function whyCard(tz) {
  const h = state.scores[state.species].find(s => s.t === state.selT);
  if (!h) return '';
  return `<div class="card"><h2>Why ${pct(h.chance)} at ${fmtTime(h.t, tz)} · ${esc(SPECIES[state.species].name)}</h2><ul class="reasons">${reasons(h, state.species).map(r =>
    `<li><span class="dot ${r.good ? 'good' : 'bad'}">${r.good ? '+' : '−'}</span><span>${esc(r.text)}</span></li>`).join('')}</ul></div>`;
}

// ---------- weather tab ----------
function pressureGauge(p) {
  const lo = 980, hi = 1045, v = Math.min(1, Math.max(0, (p - lo) / (hi - lo)));
  const ang = Math.PI * (1 - v), cx = 24, cy = 24, r = 18;
  const arc = (a0, a1, col) => {
    const p0 = [cx + r * Math.cos(Math.PI * (1 - a0)), cy - r * Math.sin(Math.PI * (1 - a0))];
    const p1 = [cx + r * Math.cos(Math.PI * (1 - a1)), cy - r * Math.sin(Math.PI * (1 - a1))];
    return `<path d="M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${r} ${r} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}" style="fill:none;stroke:${col};stroke-width:6"/>`;
  };
  return `<svg viewBox="0 0 48 30" width="54" height="34" aria-hidden="true">${arc(0, 0.38, '#6fb7e9')}${arc(0.4, 0.62, '#a6d98a')}${arc(0.64, 1, '#e8665a')}
    <line x1="${cx}" y1="${cy}" x2="${(cx + (r - 3) * Math.cos(ang)).toFixed(1)}" y2="${(cy - (r - 3) * Math.sin(ang)).toFixed(1)}" style="stroke:var(--text);stroke-width:3;stroke-linecap:round"/><circle cx="${cx}" cy="${cy}" r="2.5" style="fill:var(--text)"/></svg>`;
}

function weatherNowCard(h, tz) {
  const w = h.w, day = h.alt > -0.8;
  return `<div class="now-card">
    <div class="now-cell">${wxIcon(w.code, day)}<div><b class="big">${Math.round(w.air)}°</b><div class="small muted">Feels like ${Math.round(w.feels ?? w.air)}°</div></div></div>
    <div class="now-cell"><span class="arrow-bubble">${windArrow(w.windDir ?? 0, 26)}</span><div><b>${Math.round(w.wind)} km/h ${compass(w.windDir ?? 0)}</b><div class="small muted">Gusts ${Math.round(w.gust)} km/h</div></div></div>
    <div class="now-cell">${pressureGauge(w.pres)}<div><b>${Math.round(w.pres)}</b><div class="small muted">hPa ${h.dp3 > 0.5 ? '↑' : h.dp3 < -0.5 ? '↓' : '→'}</div></div></div>
  </div>
  <div class="small muted now-sub">${h.t === state.selT && Math.abs(h.t - Date.now()) < HOUR ? 'Now' : fmtDay(h.t, tz) + ' ' + fmtTime(h.t, tz)} · water ~${h.water.toFixed(1)} °C${state.waterOverride != null ? ' (measured)' : ' (estimated)'} · rain ${h.w.rain.toFixed(1)} mm</div>`;
}

function weatherRows(H, tz) {
  const W = H.length * HOUR_W, cx = i => i * HOUR_W + HOUR_W / 2;
  const out = [];

  // temperature + sky icons
  {
    const height = 190, top = 46, bottom = 10;
    const temps = H.map(h => h.w.air);
    let lo = Math.floor(Math.min(...temps)) - 2, hi = Math.ceil(Math.max(...temps)) + 2;
    if (hi - lo < 6) { const m = (hi + lo) / 2; lo = Math.floor(m - 3); hi = Math.ceil(m + 3); }
    const Y = v => top + (1 - (v - lo) / (hi - lo)) * (height - top - bottom);
    const step = Math.max(1, Math.round((hi - lo) / 4));
    const ticks = []; for (let v = lo; v <= hi; v += step) ticks.push(v);
    const icons = H.map((h, i) => `<g transform="translate(${cx(i) - 13} 6)"><svg width="26" height="28" viewBox="0 0 24 26">${wxIcon(h.w.code, h.alt > -0.8).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></g>`).join('');
    const line = smoothPath(H.map((h, i) => [cx(i), Y(h.w.air)]));
    out.push(row('Temperature', height, ticks.map(v => ({ y: Y(v) - 7, label: v + '°' })),
      gridLines(W, ticks.map(Y)) + icons + `<path d="${line}" class="ln-temp"/>`, H));
  }

  // wind arrows
  {
    const cells = H.map((h, i) => `<div class="wind-cell" style="left:${i * HOUR_W}px;width:${HOUR_W}px">${windArrow(h.w.windDir ?? 0, 18)}<b>${Math.round(h.w.wind)}</b><span>${compass(h.w.windDir ?? 0)}</span></div>`).join('');
    out.push(`<section class="frow"><div class="frow-title">Wind <span class="muted small">km/h</span></div><div class="frow-body" style="height:64px"><div class="axis"></div>
      <div class="hscroll"><div class="wind-inner" style="width:${W}px">${cells}</div></div></div></section>`);
  }

  // rain
  {
    const height = 70, maxR = Math.max(2, ...H.map(h => h.w.rain));
    const Y = v => height - (v / maxR) * (height - 8);
    const bars = H.map((h, i) => h.w.rain > 0.05 ? `<rect x="${i * HOUR_W + 8}" y="${Y(h.w.rain).toFixed(1)}" width="${HOUR_W - 16}" height="${(height - Y(h.w.rain)).toFixed(1)}" rx="2" class="bar-rain"/>` : '').join('');
    out.push(row('Rain <span class="muted small">mm/h</span>', height, [{ y: 2, label: maxR.toFixed(0) }, { y: height - 14, label: '0' }],
      gridLines(W, [8, height - 0.5]) + bars, H));
  }

  // pressure
  {
    const height = 120, top = 10, bottom = 10, ps = H.map(h => h.w.pres);
    let lo = Math.floor(Math.min(...ps) / 2) * 2 - 2, hi = Math.ceil(Math.max(...ps) / 2) * 2 + 2;
    if (hi - lo < 8) { const m = (hi + lo) / 2; lo = Math.floor(m - 4); hi = Math.ceil(m + 4); }
    const Y = v => top + (1 - (v - lo) / (hi - lo)) * (height - top - bottom);
    const step = Math.max(2, Math.round((hi - lo) / 4 / 2) * 2), ticks = [];
    for (let v = lo; v <= hi; v += step) ticks.push(v);
    out.push(row('Air pressure <span class="muted small">hPa</span>', height, ticks.map(v => ({ y: Y(v) - 7, label: v })),
      gridLines(W, ticks.map(Y)) + `<path d="${smoothPath(H.map((h, i) => [cx(i), Y(h.w.pres)]))}" class="ln-pres"/>`, H));
  }

  // sun and moon
  {
    const height = 150, mid = 78, k = 1.1; // px per degree
    const Y = deg => mid - deg * k * 0.95;
    const lat = state.coord.lat, lon = state.coord.lon;
    const sunPts = [], moonPts = [];
    for (let i = 0; i <= H.length * 4; i++) {
      const t = H[0].t + i * HOUR / 4, x = (i / 4) * HOUR_W + HOUR_W / 2;
      sunPts.push([x, Math.max(4, Math.min(height - 4, Y(sunAltitude(t, lat, lon))))]);
      moonPts.push([x, Math.max(4, Math.min(height - 4, Y(moonState(t, lat, lon).alt / RAD)))]);
    }
    const si = Math.max(0, H.findIndex(h => h.t === state.selT));
    const sx = cx(si), st = H[si].t;
    const sy = Math.max(10, Math.min(height - 10, Y(sunAltitude(st, lat, lon))));
    const my = Math.max(10, Math.min(height - 10, Y(moonState(st, lat, lon).alt / RAD)));
    const illum = moonIllumination(st), waxing = moonAge(st) < 14.77;
    const moonIcon = `<circle cx="${sx}" cy="${my}" r="9" style="fill:#2b2f36"/><path d="M${sx} ${my - 9} A9 9 0 0 ${waxing ? 1 : 0} ${sx} ${my + 9} A${(9 * Math.abs(1 - 2 * illum)).toFixed(1)} 9 0 0 ${illum > 0.5 === waxing ? 1 : 0} ${sx} ${my - 9}z" style="fill:#f1f1ea"/><circle cx="${sx}" cy="${my}" r="9" style="fill:none;stroke:var(--line);stroke-width:1"/>`;
    const inner = `<line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="horizon"/>
      <polyline points="${moonPts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" class="ln-moon"/><polyline points="${sunPts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" class="ln-sun"/>
      ${moonIcon}<circle cx="${sx}" cy="${sy}" r="11" class="sun-dot"/>`;
    out.push(row('Sun and moon', height, [{ y: mid - 18, label: 'up' }, { y: mid + 4, label: 'down' }], inner, H,
      `<div class="small muted frow-sub">${moonPhaseName(st)} · ${pct(illum)} lit</div>`));
  }
  return out.join('');
}

// ---------- render ----------
function renderForecast() {
  const el = $('#view-forecast');
  const c = target(), tz = state.bundle?.tz;
  const name = state.picked ? state.picked.name : 'Current location';
  const coords = c ? `${c.lat.toFixed(4)}° N, ${c.lon.toFixed(4)}° E` : 'Location not set';

  let head = `<div class="fc-head">
      <button class="round-btn" data-action="search" aria-label="Search places">${icon('search')}</button>
      <div class="fc-title"><b>${esc(name)}</b><span>${coords}</span></div>
      <button class="round-btn" data-action="info" aria-label="About the forecast">${icon('info')}</button>
    </div>
    <div class="seg2"><button class="${state.fcTab === 'weather' ? 'active' : ''}" data-action="fc-tab" data-v="weather">Weather</button><button class="${state.fcTab === 'bite' ? 'active' : ''}" data-action="fc-tab" data-v="bite">Bite times</button></div>`;

  let body = '';
  const ready = c && state.scores && state.scores[state.species] && state.scores[state.species].length;
  if (!c) {
    body = state.locating ? '<div class="spinner"></div><p class="muted" style="text-align:center">Finding your location…</p>'
      : `<div class="empty">${icon('locoff')}<h3>Location needed</h3><p class="muted">${esc(state.gpsError || 'Allow location access, search a place, or pick a spot on the map.')}</p>
        <div class="btn-row"><button class="btn primary" data-action="locate">Try again</button><button class="btn" data-action="search">Search</button></div></div>`;
  } else if (!ready) {
    body = state.error && !state.loading
      ? `<div class="empty">${icon('refresh')}<h3>Couldn't load the forecast</h3><p class="muted">${esc(state.error)}</p><div class="btn-row"><button class="btn primary" data-action="refresh">Retry</button></div></div>`
      : '<div class="spinner"></div><p class="muted" style="text-align:center">Loading weather…</p>';
  } else {
    const [i0, i1] = forecastWindow();
    const H = state.scores[state.species].slice(i0, i1);
    if (!H.some(h => h.t === state.selT)) {
      const now = Date.now();
      state.selT = (H.find(h => h.t <= now && now < h.t + HOUR) || H[0]).t;
    }
    head += timelineHtml(H, tz);
    const selH = H.find(h => h.t === state.selT);
    if (state.error) body += `<div class="banner" style="margin:10px 16px 0">${esc(state.error)}</div>`;
    if (state.fcTab === 'weather') {
      body += `<div class="pad">${weatherNowCard(selH, tz)}</div>` + weatherRows(H, tz) +
        `<p class="small muted pad">Weather: Open-Meteo. Tap any hour to see its details.</p>`;
    } else {
      body += `<p class="small muted pad" style="margin-top:12px">Bite chance per hour from water temperature, light, pressure trend, wind, rain and moon periods. Tap a fish name to make it your main species.</p>` +
        biteRows(i0, i1, H, tz) +
        `<div class="pad">${whyCard(tz)}${bestTimesCard(tz)}
          <div class="card row"><div style="flex:1"><h2 style="margin:0 0 2px">Where to fish</h2><div class="small muted">Best spots on a lake for ${esc(SPECIES[state.species].name.toLowerCase())} from depth, drop-offs and wind</div></div>
          <button class="btn primary" data-action="go-spots">Map</button></div>
          <p class="small muted">A science-based estimate, not a count of real catches.</p></div>`;
    }
  }

  el.innerHTML = `<div class="fc"><div class="fc-sticky">${head}</div>${body}</div>`;
  syncScroll(el);
}

function syncScroll(root) {
  const els = [...root.querySelectorAll('.hscroll')];
  if (!els.length) return;
  const sel = state.scores && state.scores[state.species] ? (() => {
    const [i0, i1] = forecastWindow();
    return state.scores[state.species].slice(i0, i1).findIndex(h => h.t === state.selT);
  })() : 0;
  if (state.scrollX == null) state.scrollX = Math.max(0, (sel - 1) * HOUR_W);
  // keep each day's label visible at the left edge while its hours are on screen
  const labels = [...root.querySelectorAll('.tl-day')];
  const pin = x => {
    for (const l of labels) {
      const start = +l.dataset.start, end = +l.dataset.end, w = l.offsetWidth;
      l.style.left = Math.max(start, Math.min(x, end - w - 10)) + 'px';
    }
  };
  let lock = false;
  pin(state.scrollX);
  for (const e of els) {
    e.addEventListener('scroll', () => pin(e.scrollLeft), { passive: true });
    e.scrollLeft = state.scrollX;
    e.addEventListener('scroll', () => {
      if (lock) return;
      lock = true;
      state.scrollX = e.scrollLeft;
      for (const o of els) if (o !== e) o.scrollLeft = e.scrollLeft;
      requestAnimationFrame(() => { lock = false; });
    }, { passive: true });
  }
}

// ---------- info & search sheets ----------
function openInfoSheet() {
  const est = state.bundle ? estimatedWaterNow(state.bundle) : null;
  state.sheetWater = state.waterOverride ?? (est != null ? Math.round(est * 2) / 2 : 12);
  openSheet(`<div class="sheet-head"><span class="link"></span><h2>About the forecast</h2><button class="link" data-action="close-sheet">Done</button></div>
    <div class="card"><h2>How bite chance works</h2>
      <p class="small" style="margin:0">Each hour is scored per species from water temperature (biggest factor), light and dawn/dusk, the 3-hour pressure trend, wind, rain/storms and moon periods. It's a science-based estimate, not a count of real catches – compare it with your own catch log.</p></div>
    <div class="card"><h2>Water temperature</h2>
      <div class="small muted">Estimated now: <b>${est != null ? est.toFixed(1) + ' °C' : '–'}</b> (from the last 5 days of air temperature)</div>
      <div class="stepper"><button data-action="water-minus" aria-label="Lower">−</button><div class="water-val" id="wv">${state.sheetWater.toFixed(1)} °C</div><button data-action="water-plus" aria-label="Higher">+</button></div>
      <div class="btn-row" style="margin-top:4px"><button class="btn primary" data-action="water-save">Use my measurement</button>${state.waterOverride != null ? '<button class="btn danger" data-action="water-clear">Use estimate</button>' : ''}</div></div>`);
}

let searchTimer = null;
function openSearchSheet() {
  openSheet(`<div class="sheet-head"><span class="link"></span><h2>Search</h2><button class="link" data-action="close-sheet">Cancel</button></div>
    <input id="place-q" class="search-input" placeholder="Lake, town or place" autocomplete="off" enterkeyhint="search">
    <div class="list" style="margin-top:10px"><button class="item" data-action="use-gps-close">${icon('nav')}<div><div class="t1">Current location</div><div class="t3">Use GPS</div></div></button>
      ${state.spots.map(s => `<button class="item" data-action="pick-spot" data-id="${s.id}">${icon('pin')}<div><div class="t1">${esc(s.name)}</div><div class="t3">Saved spot</div></div></button>`).join('')}</div>
    <div id="place-results" class="list" style="margin-top:10px" hidden></div>`);
  const inp = $('#place-q');
  setTimeout(() => inp.focus(), 50);
  inp.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchPlaces(inp.value), 350); });
}

async function searchPlaces(q) {
  const box = $('#place-results');
  if (!box) return;
  if (q.trim().length < 2) { box.hidden = true; return; }
  try {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q.trim(), count: '10', language: 'en', format: 'json' }));
    const j = await r.json();
    const res = j.results || [];
    state.placeResults = res;
    box.hidden = false;
    box.innerHTML = res.length ? res.map((p, i) => `<button class="item" data-action="pick-place" data-i="${i}">${icon('pin')}<div><div class="t1">${esc(p.name)}</div><div class="t3">${esc([p.admin2, p.admin1, p.country].filter(Boolean).join(', '))}</div></div></button>`).join('')
      : '<div class="item muted">No places found</div>';
  } catch {
    box.hidden = false;
    box.innerHTML = '<div class="item muted">Search needs internet</div>';
  }
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
let map = null, tiles = {}, spotLayer, catchLayer, predLayer, depthLayer, stockLayer, meMarker = null, pendingMarker = null, pendingLatLng = null;

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
    stockLayer = L.layerGroup();
    if (state.stockOn) stockLayer.addTo(map);
    map.on('moveend', () => { clearTimeout(stockTimer); stockTimer = setTimeout(loadStockings, 400); });
    spotLayer = L.layerGroup().addTo(map);
    catchLayer = L.layerGroup().addTo(map);
    const c = target();
    map.setView(c ? [c.lat, c.lon] : [48, 10], c ? 13 : 4);
    map.on('click', e => setPending(e.latlng));
    renderMarkers();
    updateMe();
    updateMapTools();
    setTimeout(loadStockings, 300);
  }
  setTimeout(() => map.invalidateSize(), 60);
}

function updateMapTools() {
  document.querySelector('[data-action="map-depth"]').classList.toggle('on-accent', state.depthOn);
  document.querySelector('[data-action="map-stock"]').classList.toggle('on-accent', state.stockOn);
  $('#depth-legend').hidden = !state.depthOn;
}

// ---------- stocking layer ----------
let stockTimer = null, stockStats = null, stockStatsPromise = null;
const stockLoaded = []; // boxes already fetched

async function loadStockings() {
  if (!map || !state.stockOn || map.getZoom() < 9) return;
  const b = map.getBounds();
  const box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const [[s0, w0], [n0, e0]] = BATHY_BOUNDS;
  if (box[2] < w0 || box[0] > e0 || box[3] < s0 || box[1] > n0) return; // view doesn't touch Lithuania
  if (stockLoaded.some(x => box[0] >= x[0] && box[1] >= x[1] && box[2] <= x[2] && box[3] <= x[3])) return;
  // fetch a slightly larger box so small pans don't refetch
  const padX = (box[2] - box[0]) * 0.25, padY = (box[3] - box[1]) * 0.25;
  const big = [box[0] - padX, box[1] - padY, box[2] + padX, box[3] + padY];
  try {
    const lakes = await fetchStockings(...big);
    stockLoaded.push(big);
    for (const [id, l] of lakes) state.stockLakes.set(id, l);
    renderStockMarkers();
  } catch { /* offline: keep what we have */ }
}

function renderStockMarkers() {
  if (!stockLayer) return;
  stockLayer.clearLayers();
  const now = Date.now();
  for (const l of state.stockLakes.values()) {
    const planned = l.events.some(e => e.t > now);
    const last = l.events.find(e => e.t <= now);
    const yr = last ? "'" + String(new Date(last.t).getFullYear()).slice(2) : 'soon';
    L.marker([l.lat, l.lon], {
      icon: L.divIcon({ className: '', html: `<div class="mk mk-stock ${planned ? 'planned' : ''}">${icon('fish')}<span class="mk-badge">${yr}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: l.name,
    }).on('click', () => openLake(l.id)).addTo(stockLayer);
  }
}

function getStockStats() {
  if (stockStats) return Promise.resolve(stockStats);
  const cached = store.get('stockStats', null);
  if (cached && Date.now() - cached.t < 7 * DAY) { stockStats = cached.data; return Promise.resolve(stockStats); }
  stockStatsPromise = stockStatsPromise || fetchStockingStats().then(d => {
    stockStats = d; store.set('stockStats', { t: Date.now(), data: d }); return d;
  }).catch(e => { stockStatsPromise = null; if (cached) { stockStats = cached.data; return stockStats; } throw e; });
  return stockStatsPromise;
}

function lakeHtml(l, stats) {
  const now = Date.now();
  // older imported records only know the year and are stored as 1 January 00:00 UTC
  const fmtD = t => {
    const d = new Date(t);
    if (d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return String(d.getUTCFullYear());
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const planned = l.events.filter(e => e.t > now).sort((a, b) => a.t - b.t);
  const past = l.events.filter(e => e.t <= now);
  const years = stockingYears(stats && stats[l.id]);

  // species you can expect: everything stocked + your own catches within ~2 km
  const stocked = new Map();
  for (const e of l.events) for (const id of e.fish) stocked.set(id, fishName(id));
  for (const y of years) for (const f of y.fish) stocked.set(f.id, f.name);
  const mPerLon = 111320 * Math.cos(l.lat * RAD);
  const mine = new Set(state.catches.filter(c => c.lat != null && Math.hypot((c.lon - l.lon) * mPerLon, (c.lat - l.lat) * 111320) < 2000).map(c => SPECIES[c.species]?.name || c.species));

  const fishList = ids => ids.map(id => esc(fishName(id))).join(', ') || 'species not listed';
  return `<div class="sheet-head"><button class="link" data-action="close-sheet">Close</button><h2>${esc(l.name)}</h2><span class="link"></span></div>
    <div class="small muted" style="text-align:center;margin:0 0 12px">${esc([l.category, l.municipality].filter(Boolean).join(' · '))}</div>
    ${planned.length ? `<div class="card" style="border:2px solid var(--warn)"><h2>Planned stocking</h2>${planned.map(e =>
      `<div class="stock-row"><b>${fmtD(e.t)}</b><span>${fishList(e.fish)}</span></div>`).join('')}
      <div class="small muted" style="margin-top:6px">Dates can still change. Anyone can come and watch.</div></div>` : ''}
    <div class="card"><h2>Fish you can expect here</h2>
      <div class="tags">${[...stocked.values()].map(n => `<span class="tag">${esc(n)}</span>`).join('') || '<span class="muted small">No stocking recorded</span>'}</div>
      ${mine.size ? `<div class="small" style="margin-top:8px">You've caught here: <b>${esc([...mine].join(', '))}</b></div>` : ''}
      <div class="small muted" style="margin-top:8px">Stocked species from official records. This is not a full survey: native fish that were never stocked (roach, perch…) won't appear.</div></div>
    <div class="card"><h2>Stocking history</h2>
      ${past.length ? past.slice(0, 12).map(e => `<div class="stock-row"><b>${fmtD(e.t)}</b><span>${fishList(e.fish)}</span></div>`).join('') : '<div class="muted small">No past stockings in the records.</div>'}
      ${past.length > 12 ? `<div class="small muted">…and ${past.length - 12} earlier</div>` : ''}</div>
    ${years.length ? `<div class="card"><h2>Amounts per year</h2>${years.map(y => `<div class="year-block"><div class="year">${y.year}</div>${y.fish.map(f =>
      `<div class="stock-row"><span style="text-align:left">${esc(f.name)}<br><span class="small muted">${esc(f.ages.join(', '))}</span></span><b>${f.count.toLocaleString()}</b></div>`).join('')}</div>`).join('')}</div>`
      : stats ? '' : '<div class="card"><div class="muted small">Loading yearly amounts…</div></div>'}
    <div class="btn-row">
      <button class="btn" data-action="lake-spots" data-id="${l.id}">${icon('target')} Find spots</button>
      <button class="btn primary" data-action="lake-forecast" data-id="${l.id}">Forecast</button>
    </div>
    <p class="small muted" style="text-align:center">Source: Lithuanian Ministry of Environment, zuvys.biip.lt</p>`;
}

function openLake(id) {
  const l = state.stockLakes.get(id);
  if (!l) return;
  openSheet(lakeHtml(l, stockStats));
  state.lakeId = id;
  if (!stockStats) {
    getStockStats().then(s => { if (state.lakeId === id && $('#sheet')) updateSheet(lakeHtml(l, s)); })
      .catch(() => { if (state.lakeId === id && $('#sheet')) updateSheet(lakeHtml(l, {})); });
  }
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
function closeSheet() { $('#sheet')?.remove(); state.detailId = null; state.lakeId = null; }
function updateSheet(html) { const s = $('#sheet .sheet'); if (s) s.innerHTML = html; }

// ---------- actions ----------
const ACTIONS = {
  'species': a => { state.species = a.dataset.key; store.set('species', state.species); recompute(); renderForecast(); },
  'day': a => { state.dayIdx = +a.dataset.i; renderForecast(); },
  'fc-tab': a => { state.fcTab = a.dataset.v; store.set('fcTab', state.fcTab); renderForecast(); },
  'sel-hour': a => { state.selT = +a.dataset.t; renderForecast(); },
  'info': () => openInfoSheet(),
  'search': () => openSearchSheet(),
  'use-gps-close': async () => { closeSheet(); state.picked = null; store.set('picked', null); state.waterOverride = null; if (!state.gps) await refreshGps(); loadForecast(); },
  'pick-spot': a => { const s = state.spots.find(x => x.id === a.dataset.id); if (!s) return; closeSheet(); pickLocation(s.lat, s.lon, s.name); },
  'pick-place': a => { const p = (state.placeResults || [])[+a.dataset.i]; if (!p) return; closeSheet(); pickLocation(p.latitude, p.longitude, p.name); },
  'refresh': () => loadForecast(true),
  'locate': async () => { await refreshGps(); loadForecast(); },
  'go-map': () => setTab('map'),
  'use-gps': async () => {
    state.picked = null; store.set('picked', null); state.waterOverride = null; state.dayIdx = 0;
    if (!state.gps) await refreshGps();
    loadForecast();
  },
  'water': () => openInfoSheet(),
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
  'map-stock': () => {
    state.stockOn = !state.stockOn; store.set('stockOn', state.stockOn);
    if (state.stockOn) { stockLayer.addTo(map); loadStockings(); if (map.getZoom() < 9) toast('Zoom in to see stocked lakes'); }
    else stockLayer.remove();
    updateMapTools();
  },
  'lake-forecast': a => {
    const l = state.stockLakes.get(a.dataset.id);
    if (!l) return;
    closeSheet();
    pickLocation(l.lat, l.lon, l.name);
  },
  'lake-spots': a => {
    const l = state.stockLakes.get(a.dataset.id);
    if (!l) return;
    closeSheet();
    map.setView([l.lat, l.lon], 14);
    setTimeout(findSpots, 500);
  },
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
  document.querySelector('[data-action="map-stock"]').innerHTML = icon('stock');
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
