import "./style.css";
import { latLngToCell, cellToBoundary } from 'h3-js';
import LZString from 'lz-string';
import { registerSW } from 'virtual:pwa-register';
import { playChime } from './audio.js';
import './p2p.js';
import { setupPushNotifications, showLocalNotification } from './push.js';
import * as SunCalc from 'suncalc';

// Register Service Worker
const updateSW = registerSW({
  onNeedRefresh() {},
  onOfflineReady() {
    console.log('App is ready to work offline');
  },
});

// ===== API CONFIG =====
// Empty string (set in .env.production) = offline-only mode, no backend calls.
const API_BASE = import.meta.env.VITE_API_URL || '';

// ===== VERSION =====
const VERSION = 'v3.2.1';
const DATA_VERSION = 2; // schema version for localStorage migrations
const VALID_SOURCES = ['manual', 'squat', 'fun', 'imported']; // whitelist for XSS prevention

// ===== MUSHROOM TYPES =====
const TYPES = [
  { id:'white',  name:'Белый',        color:'#e8e8e8', border:'#4b5563', season:[6,7,8,9,10] },
  { id:'brown',  name:'Подберёзовик', color:'#92400e', border:'#78350f', season:[5,6,7,8,9,10] },
  { id:'chanterelle', name:'Лисичка',  color:'#f59e0b', border:'#d97706', season:[6,7,8,9,10] },
  { id:'boletus',name:'Маслёнок',     color:'#a16207', border:'#854d0e', season:[6,7,8,9,10] },
  { id:'honey',  name:'Опёнок',       color:'#d97706', border:'#b45309', season:[8,9,10,11] },
  { id:'milk',   name:'Груздь',       color:'#d4d4d8', border:'#4b5563', season:[7,8,9,10] },
  { id:'russula',name:'Сыроежка',     color:'#ef4444', border:'#dc2626', season:[6,7,8,9,10] },
  { id:'other',  name:'Другой',       color:'#2563eb', border:'#1d4ed8', season:[1,2,3,4,5,6,7,8,9,10,11,12] }
];
const VALID_TYPES = TYPES.map(t => t.id); // whitelist for type validation
let selectedType = 'white';
let activeMonth = new Date().getMonth() + 1;

// ===== XSS-SAFE HELPERS =====
function safeSource(src) {
  return VALID_SOURCES.includes(src) ? src : 'imported';
}
function safeType(typ) {
  return VALID_TYPES.includes(typ) ? typ : 'other';
}

import { get, set } from 'idb-keyval';

// ===== INIT =====
window.openProfile = function() {
  document.getElementById('profileUUID').textContent = window.deviceId || 'Аноним';
  
  // Render Badges
  const badgesContainer = document.getElementById('badgesContainer');
  badgesContainer.innerHTML = '';
  
  const mCount = S.mushrooms.length;
  const sCount = S.squats;
  
  const badges = [
    { id: 'b1', name: 'Первая кровь', condition: mCount > 0, icon: '<circle cx="12" cy="12" r="10" fill="#22c55e"/><text x="12" y="16" fill="white" font-size="12" text-anchor="middle">1</text>' },
    { id: 'b2', name: 'Грибник', condition: mCount >= 10, icon: '<circle cx="12" cy="12" r="10" fill="#eab308"/><text x="12" y="16" fill="white" font-size="10" text-anchor="middle">10</text>' },
    { id: 'b3', name: 'Спортсмен', condition: sCount >= 50, icon: '<circle cx="12" cy="12" r="10" fill="#3b82f6"/><text x="12" y="16" fill="white" font-size="10" text-anchor="middle">50</text>' },
    { id: 'b4', name: 'Мастер', condition: mCount >= 100, icon: '<path d="M12 2l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z" fill="#a855f7"/>' },
  ];
  
  badges.forEach(b => {
    const div = document.createElement('div');
    div.className = `flex flex-col items-center justify-center p-2 rounded-lg border ${b.condition ? 'border-emerald-500 bg-slate-800' : 'border-slate-700 bg-slate-900 opacity-50'}`;
    div.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24">${b.icon}</svg>
      <span style="font-size:10px; text-align:center; margin-top:4px; color:${b.condition ? '#10b981' : '#64748b'}">${b.name}</span>
    `;
    badgesContainer.appendChild(div);
  });
  
  document.getElementById('profileModal').style.display = 'flex';
};

// ===== DEVICE ID =====
let deviceId = null;

export async function initDeviceId() {
  deviceId = await get('gribo_device_id');
  if (!deviceId) {
    deviceId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    await set('gribo_device_id', deviceId);
  }
  window.deviceId = deviceId;
  return deviceId;
}
initDeviceId().catch(console.error);

window.addEventListener('render-map', () => {
  renderMushrooms();
  updateStats();
});

// Init push
setupPushNotifications();

// ===== STATE =====
const S = {
  mushrooms: [],
  path: [],
  squats: 0,
  mode: 'real',
  center: [53.9, 27.55],
  zoom: 11,
  clickMode: false,
  squatSensorActive: false
};
window.S = S; // expose state for E2E tests & debugging

let mushroomIdCounter = 0;

// ===== LOCALSTORAGE =====
function saveState() {
  try {
    const data = {
      dataVersion: DATA_VERSION,
      mushrooms: S.mushrooms.map(m => ({
        id: m.id, client_id: m.client_id, lat: m.lat, lng: m.lng, source: safeSource(m.source),
        type: safeType(m.type),
        time: m.time,
        synced: !!m.synced
      })),
      squats: S.squats,
      path: S.path,
      center: [map.getCenter().lat, map.getCenter().lng],
      zoom: map.getZoom(),
      mode: S.mode,
      selectedType: selectedType,
      activeMonth: activeMonth
    };
    const jsonStr = JSON.stringify(data);
    const compressed = LZString.compressToUTF16(jsonStr);
    
    // Warn if still too big (LocalStorage is usually ~5MB UTF-16)
    if (compressed.length > 2.5 * 1024 * 1024) {
      toast('Внимание: память браузера заполняется! (' + (compressed.length/1024/1024).toFixed(1) + ' МБ)', 'error');
    }
    localStorage.setItem('gribo_location_state', compressed);
  } catch(e) {
    console.error('Save state failed:', e);
    if (e.name === 'QuotaExceededError' || e.message.includes('QuotaExceeded')) {
      toast('Память браузера переполнена. Удалите старые данные.', 'error');
    }
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem('gribo_location_state');
    if (!raw) return false;
    
    // Backwards compatibility check
    let jsonStr = raw;
    if (raw[0] !== '{') {
      jsonStr = LZString.decompressFromUTF16(raw);
    }
    
    if (!jsonStr) return false;
    const data = JSON.parse(jsonStr);
    if (data.mushrooms && Array.isArray(data.mushrooms)) {
      S.mushrooms = data.mushrooms.filter(m =>
        typeof m.lat === 'number' && typeof m.lng === 'number' &&
        !isNaN(m.lat) && !isNaN(m.lng) &&
        m.lat >= -90 && m.lat <= 90 && m.lng >= -180 && m.lng <= 180
      ).map(m => ({
        id: m.id || 'm' + (++mushroomIdCounter), 
        client_id: m.client_id || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now()),
        lat: m.lat, lng: m.lng, source: safeSource(m.source),
        type: safeType(m.type),
        time: m.time,
        synced: !!m.synced
      }));
    }
    if (typeof data.squats === 'number') S.squats = data.squats;
    if (Array.isArray(data.path)) S.path = data.path;
    if (Array.isArray(data.center) && typeof data.center[0] === 'number' && typeof data.center[1] === 'number') {
      S.center = [Math.max(-90, Math.min(90, data.center[0])), Math.max(-180, Math.min(180, data.center[1]))];
    }
    if (typeof data.zoom === 'number') S.zoom = Math.max(1, Math.min(18, Math.round(data.zoom)));
    if (data.mode === 'real' || data.mode === 'fun') S.mode = data.mode;
    if (data.selectedType && TYPES.some(t => t.id === data.selectedType)) selectedType = data.selectedType;
    if (typeof data.activeMonth === 'number' && data.activeMonth >= 1 && data.activeMonth <= 12) activeMonth = data.activeMonth;
    return true;
  } catch(e) {
    console.error('Load state failed:', e);
    return false;
  }
}

// ===== MAP =====
const map = L.map('map', { center: S.center, zoom: S.zoom, zoomControl: true, fadeAnimation: false, preferCanvas: true });

const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd', maxZoom: 19
});
cartoLight.on('tileerror', () => toast('Ошибка загрузки карты. Проверьте интернет.', 'error'));
cartoLight.addTo(map);

const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; Esri', maxZoom: 18
});
satLayer.on('tileerror', () => toast('Ошибка загрузки карты. Проверьте интернет.', 'error'));

const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 19
});
cartoDark.on('tileerror', () => toast('Ошибка загрузки карты. Проверьте интернет.', 'error'));

const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  attribution: 'Map data: &copy; OSM, SRTM | Style: &copy; OpenTopoMap (CC-BY-SA)', maxZoom: 17
});
topoLayer.on('tileerror', () => toast('Ошибка загрузки Топографии. Проверьте интернет.', 'error'));

// Heatmap
let heatPoints = [];
const heatLayer = L.heatLayer([], {
  radius: 30, blur: 25, maxZoom: 14, max: 8,
  gradient: { 0.0:'#22c55e', 0.2:'#86efac', 0.4:'#fde047', 0.6:'#f97316', 0.8:'#dc2626', 1.0:'#7f1d1d' }
}).addTo(map);

// Density-weighted heatmap: weight each point by H3 cell count (not constant 0.6)
function computeHeatPoints() {
  if (S.mushrooms.length === 0) return [];
  const H3_RES = 9;
  const cellCounts = {};
  S.mushrooms.forEach(m => {
    const hex = latLngToCell(m.lat, m.lng, H3_RES);
    cellCounts[hex] = (cellCounts[hex] || 0) + 1;
  });
  let maxCount = 1;
  for (const c of Object.values(cellCounts)) { if (c > maxCount) maxCount = c; }
  return S.mushrooms.map(m => {
    const hex = latLngToCell(m.lat, m.lng, H3_RES);
    const count = cellCounts[hex];
    // Weight: 0.3 baseline + density-scaled 0.7 max
    const intensity = 0.3 + 0.7 * (count / maxCount);
    return [m.lat, m.lng, intensity];
  });
}
function refreshHeatLayer() {
  heatPoints = computeHeatPoints();
  heatLayer.setLatLngs(heatPoints);
}

const h3Layer = L.layerGroup().addTo(map);
const radarLayer = L.layerGroup().addTo(map);

function updateRadar() {
  if (!radarLayer) return;
  radarLayer.clearLayers();
  if (!userMarker) return;
  
  const pos = userMarker.getLatLng();
  const radii = [50, 100, 250]; // Радиусы радара в метрах
  
  radii.forEach(r => {
    L.circle(pos, {
      radius: r,
      color: '#0ea5e9',
      weight: 1.5,
      dashArray: '5,5',
      fill: false,
      opacity: 0.6
    }).addTo(radarLayer);
  });
}

// Auto-sync theme based on sunset
function autoSyncTheme(lat, lng) {
  try {
    const times = SunCalc.getTimes(new Date(), lat, lng);
    const now = new Date();
    const isNight = now < times.sunrise || now > times.sunset;
    
    if (isNight) {
      if (map.hasLayer(cartoLight)) map.removeLayer(cartoLight);
      if (!map.hasLayer(cartoDark) && !map.hasLayer(satLayer) && !map.hasLayer(topoLayer)) {
        cartoDark.addTo(map);
        toast('Ночная тема активирована', 'info');
      }
    } else {
      if (map.hasLayer(cartoDark)) map.removeLayer(cartoDark);
      if (!map.hasLayer(cartoLight) && !map.hasLayer(satLayer) && !map.hasLayer(topoLayer)) {
        cartoLight.addTo(map);
      }
    }
  } catch (e) {
    console.warn('Auto sync theme error:', e);
  }
}

// Markers
const markers = L.markerClusterGroup({
  maxClusterRadius: 40,
  disableClusteringAtZoom: 15,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true
}).addTo(map);
let userMarker = null;
let routeLayer = null;
let markerMap = new Map(); // id -> marker reference for filtering

// Add GIS Controls
const rainLayer = L.tileLayer('https://tile.rainviewer.com/v2/radar/nowcast_latest/256/{z}/{x}/{y}/2/1_1.png', {
  attribution: '&copy; RainViewer', opacity: 0.7, maxZoom: 18
});

L.control.layers({
  'Карта (Светлая)': cartoLight, 
  'Карта (Тёмная)': cartoDark, 
  'Спутник (Esri)': satLayer,
  'Топография (Горы)': topoLayer
}, {
  'Тепловая карта грибов': heatLayer,
  'H3 Гексагоны плотности': h3Layer,
  'Радар (Кольца дистанции)': radarLayer,
  'Радар осадков (Дождь)': rainLayer,
  'Маркеры находок': markers
}, {position:'topright'}).addTo(map);

// Add Ruler Tool
if (typeof L.control.ruler === 'function') {
  L.control.ruler({
    position: 'topright',
    circleMarker: { color: 'red', radius: 2 },
    lineStyle: { color: 'red', dashArray: '1,6' },
    lengthUnit: { display: 'km', decimal: 2, factor: null, label: 'Расстояние:' },
    angleUnit: { display: '&deg;', decimal: 2, factor: null, label: 'Угол:' }
  }).addTo(map);
}

L.control.scale({imperial: false, maxWidth: 200}).addTo(map);

function renderMarkerPopup(m) {
  const typeObj = TYPES.find(tp => tp.id === (m.type || 'white')) || TYPES[0];
  const t = m.time ? new Date(m.time) : new Date();
  const timeStr = t.toLocaleTimeString ? t.toLocaleTimeString('ru-RU') : '--:--';
  return `<div style="font-size:12px;line-height:1.5">
      <strong style="color:#1e293b">${typeObj.name}</strong>
      <span style="color:#6b7280;font-size:10px"> (${m.source})</span><br>
      <span style="color:#6b7280">${timeStr} | ${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span><br>
      <button onclick="window.routeToPoint(${m.lat}, ${m.lng})" style="margin-top:4px;margin-right:4px;padding:2px 8px;background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;border-radius:4px;cursor:pointer;font-size:11px">📍 Маршрут сюда</button>
      <button onclick="removeMushroom('${m.id}')" style="margin-top:4px;padding:2px 8px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:11px">Удалить</button>
    </div>`;
}

function makeIcon(source, type) {
  const typeObj = TYPES.find(t => t.id === (type || 'white')) || TYPES[0];
  const sourceColors = { squat: '#7c3aed', fun: '#16a34a', manual: '#2563eb' };
  const bg = sourceColors[source] || typeObj.color;
  const border = typeObj.border;
  return L.divIcon({
    html: `<div style="width:14px;height:14px;background:${bg};border:2px solid ${border};border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7], className: ''
  });
}

// ===== TYPE SELECTOR INIT =====
function initTypeSelector() {
  const el = document.getElementById('typeSelector');
  el.innerHTML = TYPES.map(t =>
    `<button class="type-btn ${t.id === selectedType ? 'active' : ''}" data-type="${t.id}" onclick="selectType('${t.id}')">
      <span class="type-dot" style="background:${t.color};border:1px solid ${t.border}"></span>${t.name}
    </button>`
  ).join('');
}

function selectType(type) {
  const typeObj = TYPES.find(t => t.id === type);
  if (typeObj && !typeObj.season.includes(activeMonth)) {
    toast(`Гриб ${typeObj.name} не растет в этом месяце!`, 'error');
    return;
  }
  selectedType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  saveState();
}

// ===== SEASONALITY =====
function initSeasonSelector() {
  const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const el = document.getElementById('seasonMonths');
  el.innerHTML = monthNames.map((name, i) =>
    `<button class="month-btn ${(i+1) === activeMonth ? 'active' : ''}" data-month="${i+1}" onclick="selectMonth(${i+1})">${name}</button>`
  ).join('');
  updateSeasonInfo();
}

function selectMonth(month) {
  activeMonth = month;
  document.querySelectorAll('.month-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.month) === month));
  updateSeasonInfo();
  const currTypeObj = TYPES.find(t => t.id === selectedType);
  if (currTypeObj && !currTypeObj.season.includes(activeMonth)) {
    const seasonalTypes = TYPES.filter(t => t.season.includes(activeMonth));
    if (seasonalTypes.length > 0) {
      selectedType = seasonalTypes[0].id;
      document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === selectedType));
    }
  }
  saveState();
}

function updateSeasonInfo() {
  const activeTypes = TYPES.filter(t => t.season.includes(activeMonth));
  const names = activeTypes.map(t => t.name).join(', ');
  document.getElementById('seasonTypes').innerHTML = `В этом месяце: <strong>${names}</strong>`;
  // Dim out-of-season types in selector
  document.querySelectorAll('.type-btn').forEach(btn => {
    const typeId = btn.dataset.type;
    const typeObj = TYPES.find(t => t.id === typeId);
    if (typeObj) {
      btn.classList.toggle('dimmed', !typeObj.season.includes(activeMonth));
    }
  });
}

// ===== MAP EVENTS =====
map.on('click', function(e) {
  if (!S.clickMode) return;
  S.clickMode = false;
  map.getContainer().style.cursor = '';
  addMushroom(e.latlng.lat, e.latlng.lng, 'manual', selectedType);
});

let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

map.on('moveend', () => { updateStatusCoords(); debouncedSave(); });
map.on('zoomend', () => { updateStatusCoords(); debouncedSave(); });

let guideLine = null;

function updateGuideLine() {
  if (!userMarker || S.mushrooms.length === 0) {
    if (guideLine) { map.removeLayer(guideLine); guideLine = null; }
    return;
  }
  
  const pos = userMarker.getLatLng();
  let nearestM = null;
  let minDist = Infinity;
  S.mushrooms.forEach(m => {
    if (m.type !== selectedType && selectedType !== 'other') return;
    const mll = L.latLng(m.lat, m.lng);
    const d = pos.distanceTo(mll);
    if (d > 0 && d < minDist) {
      minDist = d;
      nearestM = m;
    }
  });
  
  if (nearestM) {
    const latlngs = [pos, L.latLng(nearestM.lat, nearestM.lng)];
    if (!guideLine) {
      guideLine = L.polyline(latlngs, { color: '#22c55e', weight: 3, dashArray: '8, 8', opacity: 0.7 }).addTo(map);
    } else {
      guideLine.setLatLngs(latlngs);
    }
  } else {
    if (guideLine) { map.removeLayer(guideLine); guideLine = null; }
  }
}

let lastWeatherFetch = 0;
async function updateWeather(lat, lng) {
  const now = Date.now();
  if (now - lastWeatherFetch < 5 * 60 * 1000) return;
  lastWeatherFetch = now;
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&current=temperature_2m,precipitation`);
    const data = await res.json();
    if (data && data.current) {
      const t = data.current.temperature_2m;
      const p = data.current.precipitation;
      let icon = '🌤';
      if (p > 0) icon = '🌧';
      else if (t < 0) icon = '❄';
      const el = document.getElementById('weatherStatus');
      if (el) el.textContent = `${icon} ${t}°C, ${p}mm`;
    }
  } catch (e) {
    console.error('Weather fetch error', e);
  }
}

function updateStatusCoords() {
  const c = map.getCenter();
  const el = document.getElementById('statusRight');
  if (el) el.textContent = `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} | zoom ${map.getZoom()}`;
  updateDistanceUI();
  updateRadar();
  updateGuideLine();
  updateWeather(c.lat, c.lng);
}

// ===== GEOLOCATION (enhanced with timeout) =====
function goToMyLocation() {
  if (!navigator.geolocation) {
    toast('Геолокация не поддерживается этим браузером', 'error');
    return;
  }
  showLoading('Определяю местоположение...');
  toast('Определяю местоположение...');
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      hideLoading();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      map.setView([lat, lng], 15);

      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          html: '<div style="width:16px;height:16px;background:#0e7490;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(14,116,144,0.5)"></div>',
          iconSize: [16, 16], iconAnchor: [8, 8], className: ''
        })
      }).bindPopup('<div style="font-size:12px"><strong>Вы здесь</strong><br><span style="color:#6b7280">' + lat.toFixed(5) + ', ' + lng.toFixed(5) + '</span></div>').addTo(map);

      toast('Местоположение определено', 'success');
      if (window.radarLayer) window.updateRadar();
    },
    function(err) {
      hideLoading();
      let msg = 'Ошибка геолокации';
      if (err.code === 1) msg = 'Доступ к геолокации запрещён. Разрешите в настройках браузера.';
      else if (err.code === 2) msg = 'Местоположение недоступно. Проверьте GPS/интернет.';
      else if (err.code === 3) msg = 'Таймаут геолокации. Попробуйте ещё раз.';
      toast(msg, 'error');
      console.error('Geolocation error:', err);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

// ===== LOADING OVERLAY =====
function showLoading(text) {
  document.getElementById('loadingText').textContent = text || 'Загрузка...';
  document.getElementById('loadingOverlay').classList.add('visible');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('visible');
}

// ===== CORE =====
window.addMushroom = function addMushroom(lat, lng, source, type, batch) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    console.error('addMushroom: invalid coords', lat, lng);
    return;
  }
  if (!batch) playChime();
  const t = new Date();
  const mType = type || 'white';
  const id = 'm' + (++mushroomIdCounter);
  const client_id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  const mushroom = { id, client_id, lat, lng, source, type: mType, time: t.toISOString() };
  S.mushrooms.push(mushroom);

  const m = L.marker([lat, lng], { icon: makeIcon(source, mType) })
    .bindPopup(renderMarkerPopup(mushroom));
  markers.addLayer(m);
  markerMap.set(id, m);

  // Density-weighted heat point update
  if (!batch) {
    refreshHeatLayer();
    updateUI();
    updateStats();
    checkAchievements();
    saveState();
  }
}

function removeMushroom(id) {
  const idx = S.mushrooms.findIndex(m => m.id === id);
  if (idx === -1) return;
  S.mushrooms.splice(idx, 1);
  const m = markerMap.get(id);
  if (m) { markers.removeLayer(m); markerMap.delete(id); }
  // Rebuild heatpoints with density weights
  refreshHeatLayer();
  updateUI();
  updateStats();
  saveState();
  toast('Гриб удалён');
}

function doSquat() {
  S.squats++;
  // Use real GPS position instead of map center
  if (!navigator.geolocation) {
    // Fallback: map center if geolocation unsupported
    const c = map.getCenter();
    const d = () => (Math.random() - 0.5) * 0.0003;
    addMushroom(c.lat + d(), c.lng + d(), 'squat', selectedType);
    toast('Геолокация недоступна — гриб по центру карты', 'error');
  } else {
    showLoading('Определяю GPS...');
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        hideLoading();
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Small jitter so multiple squats in same spot don't overlap perfectly
        const d = () => (Math.random() - 0.5) * 0.0002;
        addMushroom(lat + d(), lng + d(), 'squat', selectedType);
        // Pan map to real position
        map.setView([lat, lng], map.getZoom(), { animate: true });
        const msg = S.squats % 10 === 0
          ? `${S.squats} приседов! Уровень растёт.`
          : `Присед #${S.squats} — гриб на ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        toast(msg, 'success');
      },
      function(err) {
        hideLoading();
        S.squats--; // rollback increment on failure
        let msg = 'GPS недоступен — гриб не добавлен';
        if (err.code === 1) msg = 'Доступ к GPS запрещён. Разрешите геолокацию.';
        else if (err.code === 3) msg = 'Таймаут GPS. Стоите на месте?';
        toast(msg, 'error');
        console.error('doSquat geolocation error:', err);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  }
}

function enableClickMode() {
  S.clickMode = true;
  toast('Кликай по карте для добавления ' + (TYPES.find(t=>t.id===selectedType)?.name || 'гриба'));
  map.getContainer().style.cursor = 'crosshair';
}

function generateForest() {
  const c = map.getCenter();
  const clusters = 4 + Math.floor(Math.random() * 4);
  let total = 0;
  for (let cl = 0; cl < clusters; cl++) {
    const clat = c.lat + (Math.random() - 0.5) * 0.08;
    const clng = c.lng + (Math.random() - 0.5) * 0.08;
    const n = 8 + Math.floor(Math.random() * 15);
    for (let i = 0; i < n; i++) {
      // Use seasonal types if available, otherwise random
      const seasonalTypes = TYPES.filter(t => t.season.includes(activeMonth));
      const pool = seasonalTypes.length > 0 ? seasonalTypes : TYPES;
      const rType = pool[Math.floor(Math.random() * pool.length)].id;
      addMushroom(clat + (Math.random()-0.5)*0.02, clng + (Math.random()-0.5)*0.02, 'fun', rType, true);
      total++;
    }
  }
  updateUI();
  updateStats();
  checkAchievements();
  refreshHeatLayer();
  setMode('fun');
  toast(`${total} спор сгенерировано в ${clusters} кластерах`, 'success');
}

function clearAll() {
  if (!confirm('Удалить все грибы и приседания?')) return;
  S.mushrooms = [];
  S.squats = 0;
  S.clickMode = false;
  map.getContainer().style.cursor = '';
  heatPoints = [];
  markers.clearLayers();
  markerMap.clear();
  heatLayer.setLatLngs([]);
  clearRoute();
  updateUI();
  updateStats();
  saveState();
  toast('Карта очищена');
}

function setMode(mode) {
  S.mode = mode;
  document.getElementById('hMode').textContent = mode === 'fun' ? 'Фан' : 'Реал';
  document.getElementById('btnReal').classList.toggle('active', mode === 'real');
  document.getElementById('btnFun').classList.toggle('active', mode === 'fun');
  saveState();
}

// ===== SQUAT SENSOR (DeviceMotion API) =====
let squatSensorActive = false;
let lastSquatTime = 0;
let accelHistory = [];
// Calibrated: 4 m/s² spike above rolling average detects real squats.
// Old value 12 was unreachable (gravity baseline ~9.8, total ~22 m/s² = violent shake).
// accelerationIncludingGravity includes Earth gravity, so at-rest magnitude ≈ 9.8.
// A squat produces a brief spike of 3-6 m/s² above the moving average.
const SQUAT_THRESHOLD = 4; // m/s² spike above rolling average
const SQUAT_COOLDOWN = 1500; // ms between squats (faster = more responsive)
const SQUAT_HISTORY_SIZE = 15; // longer window for better baseline

function toggleSquatSensor() {
  if (squatSensorActive) {
    stopSquatSensor();
  } else {
    startSquatSensor();
  }
}

function startSquatSensor() {
  if (!window.DeviceMotionEvent) {
    toast('Акселерометр не поддерживается этим устройством', 'error');
    document.getElementById('sensorDot').className = 'sensor-dot error';
    document.getElementById('sensorStatus').textContent = 'Датчик недоступен';
    return;
  }

  // iOS 13+ requires permission
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().then(permission => {
      if (permission === 'granted') {
        activateSensor();
      } else {
        toast('Разрешение на датчик отклонено', 'error');
        document.getElementById('sensorDot').className = 'sensor-dot error';
        document.getElementById('sensorStatus').textContent = 'Доступ запрещён';
      }
    }).catch(err => {
      toast('Ошибка доступа к датчику: ' + err.message, 'error');
    });
  } else {
    activateSensor();
  }
}

function activateSensor() {
  squatSensorActive = true;
  S.squatSensorActive = true;
  window.addEventListener('devicemotion', handleMotion, true);
  document.getElementById('sensorDot').className = 'sensor-dot active';
  document.getElementById('sensorStatus').textContent = 'Датчик: активен (приседайте!)';
  document.getElementById('sensorBtn').textContent = 'Выключить авто-присед';
  toast('Авто-детекция приседаний включена. Приседайте за грибами!', 'success');
}

function stopSquatSensor() {
  squatSensorActive = false;
  S.squatSensorActive = false;
  window.removeEventListener('devicemotion', handleMotion, true);
  accelHistory = [];
  document.getElementById('sensorDot').className = 'sensor-dot';
  document.getElementById('sensorStatus').textContent = 'Датчик приседаний: выкл';
  document.getElementById('sensorBtn').textContent = 'Включить авто-присед (акселерометр)';
  toast('Авто-детекция выключена');
}

function handleMotion(event) {
  const accel = event.accelerationIncludingGravity;
  if (!accel || accel.x === null || accel.y === null || accel.z === null) return;

  // Calculate magnitude of acceleration vector
  const magnitude = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);

  accelHistory.push(magnitude);
  if (accelHistory.length > SQUAT_HISTORY_SIZE) accelHistory.shift();

  // Need at least 3 readings
  if (accelHistory.length < 3) return;

  // Detect spike: current reading significantly higher than average
  const avg = accelHistory.slice(0, -1).reduce((a, b) => a + b, 0) / (accelHistory.length - 1);
  const spike = magnitude - avg;

  const now = Date.now();
  if (spike > SQUAT_THRESHOLD && (now - lastSquatTime) > SQUAT_COOLDOWN) {
    lastSquatTime = now;
    console.log('Squat detected! spike:', spike.toFixed(1), 'magnitude:', magnitude.toFixed(1));
    doSquat();
  }
}

// ===== STATISTICS =====
function updateStats() {
  const grid = document.getElementById('statGrid');
  const n = S.mushrooms.length;
  if (n === 0) {
    grid.innerHTML = '<div class="stat-card"><div class="stat-card-label">Нет данных</div><div class="stat-card-val">—</div></div>';
    return;
  }

  // Count by source
  const bySource = {};
  S.mushrooms.forEach(m => { bySource[m.source] = (bySource[m.source] || 0) + 1; });

  // Count by type
  const byType = {};
  S.mushrooms.forEach(m => { byType[m.type] = (byType[m.type] || 0) + 1; });

  // Top type
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  const topTypeName = TYPES.find(t => t.id === topType[0])?.name || topType[0];

  // Center of mass
  const avgLat = S.mushrooms.reduce((s, m) => s + m.lat, 0) / n;
  const avgLng = S.mushrooms.reduce((s, m) => s + m.lng, 0) / n;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">Всего грибов</div>
      <div class="stat-card-val">${n}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Топ вид</div>
      <div class="stat-card-val" style="font-size:13px">${topTypeName}</div>
      <div class="stat-card-sub">${topType[1]} шт</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Приседания</div>
      <div class="stat-card-val">${S.squats}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Ручные</div>
      <div class="stat-card-val">${bySource.manual || 0}</div>
      <div class="stat-card-sub">Фан: ${bySource.fun || 0}</div>
    </div>
  `;
}

// ===== ROUTE PLANNING (OSRM) =====
async function planRoute() {
  if (S.mushrooms.length < 2) {
    toast('Нужно минимум 2 гриба для маршрута', 'error');
    return;
  }

  if (!localStorage.getItem('osrm_consent')) {
    if (!confirm('Для построения маршрута ваши GPS координаты будут отправлены на сторонний публичный сервер OSRM. Вы согласны?')) {
      return;
    }
    localStorage.setItem('osrm_consent', 'true');
  }

  // Limit waypoints to avoid URL length overflow (OSRM ~8KB URL limit)
  const MAX_WAYPOINTS = 30;
  let routePoints = S.mushrooms;

  if (S.mushrooms.length > MAX_WAYPOINTS) {
    // Take nearest N to map center
    const center = map.getCenter();
    routePoints = [...S.mushrooms]
      .map(m => ({ m, d: Math.pow(m.lat - center.lat, 2) + Math.pow(m.lng - center.lng, 2) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_WAYPOINTS)
      .map(x => x.m);
    toast(`Слишком много точек. Маршрут по ${MAX_WAYPOINTS} ближайшим к центру карты`, 'success');
  }

  showLoading('Строю маршрут...');

  // Sort by nearest neighbor (greedy TSP)
  const points = [...routePoints];
  const route = [points[0]];
  const remaining = points.slice(1);

  while (remaining.length > 0) {
    const last = route[route.length - 1];
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dx = remaining[i].lat - last.lat;
      const dy = remaining[i].lng - last.lng;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) { minDist = dist; nearest = i; }
    }
    route.push(remaining.splice(nearest, 1)[0]);
  }

  // Build OSRM URL
  const coords = route.map(m => `${m.lng},${m.lat}`).join(';');
  const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('OSRM HTTP ' + response.status);
    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('OSRM: ' + (data.message || 'no route'));
    }

    const r = data.routes[0];
    const distanceKm = (r.distance / 1000).toFixed(2);
    const durationMin = Math.round(r.duration / 60);

    // Draw route on map
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(r.geometry, {
      style: { color: '#2563eb', weight: 4, opacity: 0.7, dashArray: '8,6' }
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

    // Show route info
    document.getElementById('routeDist').textContent = distanceKm + ' км';
    document.getElementById('routeTime').textContent = durationMin + ' мин';
    document.getElementById('routePoints').textContent = route.length;
    document.getElementById('routeInfo').classList.add('visible');

    hideLoading();
    toast(`Маршрут: ${distanceKm} км, ~${durationMin} мин пешком через ${route.length} точек`, 'success');
  } catch(err) {
    hideLoading();
    if (err.name === 'AbortError') {
      toast('Таймаут маршрутизации. Проверьте интернет.', 'error');
    } else {
      toast('Ошибка маршрутизации: ' + err.message, 'error');
    }
    console.error('Route error:', err);

    // Fallback: draw straight lines
    if (routeLayer) map.removeLayer(routeLayer);
    const latlngs = route.map(m => [m.lat, m.lng]);
    routeLayer = L.polyline(latlngs, { color: '#2563eb', weight: 3, opacity: 0.5, dashArray: '5,8' }).addTo(map);
    document.getElementById('routeInfo').classList.add('visible');
    document.getElementById('routeDist').textContent = '— (прямые линии)';
    document.getElementById('routeTime').textContent = '—';
    document.getElementById('routePoints').textContent = route.length;
  }
}

function clearRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  document.getElementById('routeInfo').classList.remove('visible');
}

// ===== EXPORT/IMPORT =====
function exportData() {
  if (S.mushrooms.length === 0) {
    toast('Нет данных для экспорта', 'error');
    return;
  }
  try {
    const data = {
      version: VERSION,
      exportDate: new Date().toISOString(),
      project: 'GriboLocation #6620',
      mushrooms: S.mushrooms,
      squats: S.squats,
      total: S.mushrooms.length
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gribolocation_${new Date().toISOString().slice(0,10)}_${S.mushrooms.length}grib.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Экспортировано ${S.mushrooms.length} грибов`, 'success');
  } catch(e) {
    toast('Ошибка экспорта: ' + e.message, 'error');
    console.error('Export error:', e);
  }
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  // File size limit (10 MB)
  const MAX_IMPORT_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_IMPORT_SIZE) {
    toast('Файл слишком большой (макс. 10 МБ). Уменьшите данные.', 'error');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.mushrooms || !Array.isArray(data.mushrooms)) {
        throw new Error('Неверный формат файла');
      }

      const validMushrooms = data.mushrooms.filter(m =>
        typeof m.lat === 'number' && typeof m.lng === 'number' &&
        !isNaN(m.lat) && !isNaN(m.lng) &&
        m.lat >= -90 && m.lat <= 90 && m.lng >= -180 && m.lng <= 180
      ).map(m => ({
        id: 'm' + (++mushroomIdCounter),
        lat: m.lat, lng: m.lng,
        source: safeSource(m.source || 'imported'),
        type: safeType(m.type),
        time: m.time || new Date().toISOString()
      }));

      if (validMushrooms.length === 0) {
        throw new Error('Нет валидных координат в файле');
      }

      const merge = confirm(`Найдено ${validMushrooms.length} грибов. Добавить к существующим (${S.mushrooms.length})?\n\nOK = добавить\nCancel = заменить все`);
      if (!merge) {
        S.mushrooms = [];
        markers.clearLayers();
        markerMap.clear();
        heatPoints = [];
      }

      validMushrooms.forEach(m => {
        S.mushrooms.push(m);
        const marker = L.marker([m.lat, m.lng], { icon: makeIcon(m.source, m.type) })
          .bindPopup(renderMarkerPopup(m));
        markers.addLayer(marker);
        markerMap.set(m.id, marker);
      });

      refreshHeatLayer();
      updateUI();
      updateStats();
      checkAchievements();
      saveState();
      toast(`Импортировано ${validMushrooms.length} грибов`, 'success');
    } catch(err) {
      toast('Ошибка импорта: ' + err.message, 'error');
      console.error('Import error:', err);
    }
    event.target.value = ''; // reset input
  };
  reader.readAsText(file);
}

// ===== UI UPDATE =====
function updateH3Layer() {
  if (!h3Layer) return;
  h3Layer.clearLayers();
  
  const cellCounts = {};
  S.mushrooms.forEach(m => {
    // optional: only count selected type if we want
    // if (m.type !== selectedType) return;
    
    // Convert coordinate to H3 index at resolution 9
    const hex = latLngToCell(m.lat, m.lng, 9);
    cellCounts[hex] = (cellCounts[hex] || 0) + 1;
  });

  let maxCount = 1;
  for (const c of Object.values(cellCounts)) {
    if (c > maxCount) maxCount = c;
  }

  for (const hex in cellCounts) {
    const count = cellCounts[hex];
    const boundary = cellToBoundary(hex);
    
    const intensity = count / maxCount;
    
    L.polygon(boundary, {
      color: '#d97706',
      weight: 1,
      fillColor: '#f59e0b',
      fillOpacity: 0.2 + (intensity * 0.5)
    }).bindPopup(`<b>Гексагон (H3)</b><br>Грибов: ${count}`).addTo(h3Layer);
  }
}

function updateUI() {
  const n = S.mushrooms.length;
  document.getElementById('hMush').textContent = n;
  document.getElementById('hSquat').textContent = S.squats;
  document.getElementById('fabCount').textContent = S.squats > 99 ? '99+' : S.squats;
  document.getElementById('lbMush').textContent = n;
  document.getElementById('lbSquat').textContent = S.squats;

  let lvl = 'Новичок';
  if (n >= 100) lvl = 'Мастер';
  else if (n >= 50) lvl = 'Бывалый';
  else if (n >= 20) lvl = 'Любитель';
  else if (n >= 5) lvl = 'Начинающий';
  document.getElementById('userLevel').textContent = `Ур. ${Math.floor(n/10)+1} - ${lvl}`;

  document.getElementById('statusLeft').textContent = `${n} грибов | ${S.squats} приседов`;
  
  updateH3Layer();
}

function checkAchievements() {
  const n = S.mushrooms.length;
  const sq = S.squats;
  const u = (id, on) => document.getElementById(id).classList.toggle('locked', !on);
  u('ach0', n >= 1);
  u('ach1', n >= 10);
  u('ach2', sq >= 50);
  u('ach3', n >= 100);
  u('ach4', n >= 50 && sq >= 50);
}

// ===== TOAST =====
let toastTimer;
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show';
  if (type === 'error') t.classList.add('error');
  else if (type === 'success') t.classList.add('success');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== FOREST ZONES =====
const forests = [
  [[53.95,27.35],[54.02,27.50],[54.00,27.70],[53.90,27.75],[53.82,27.55],[53.85,27.40]],
  [[54.10,27.80],[54.18,27.95],[54.15,28.10],[54.05,28.05],[53.95,27.90]],
  [[53.75,27.30],[53.82,27.50],[53.78,27.70],[53.68,27.60],[53.65,27.35]],
  [[53.88,27.85],[53.96,28.00],[53.92,28.15],[53.82,28.10],[53.80,27.90]],
];
forests.forEach(f => {
  L.polygon(f, {
    color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.06,
    weight: 1.5, dashArray: '6,4'
  }).addTo(map).bindPopup('Лесная зона');
});

// ===== RADAR =====
window.toggleRadar = function() {
  if (window.radarLayer) {
    map.removeLayer(window.radarLayer);
    window.radarLayer = null;
    toast('Радар отключен');
    return;
  }
  window.updateRadar();
};
window.updateRadar = function() {
  if (window.radarLayer) map.removeLayer(window.radarLayer);
  
  if (typeof L.geodesic !== 'function') {
    toast('Плагин Geodesic недоступен', 'error');
    return;
  }

  const centerPoint = userMarker ? userMarker.getLatLng() : map.getCenter();
  
  const circleOptions = {
    weight: 2,
    opacity: 0.8,
    fillOpacity: 0.1,
    steps: 64
  };

  window.radarLayer = L.layerGroup([
    L.geodesic([centerPoint], { ...circleOptions, radius: 500, color: 'blue' }),
    L.geodesic([centerPoint], { ...circleOptions, radius: 1000, color: 'green' }),
    L.geodesic([centerPoint], { ...circleOptions, radius: 2000, color: 'red' })
  ]).addTo(map);
  
  toast('Радар включен (500м, 1км, 2км)', 'success');
};

// ===== ROUTING =====
window.routingControl = null;

window.routeToPoint = function(lat, lng) {
  if (!userMarker && !S.center) {
    toast('Определите свое местоположение сначала', 'error');
    return;
  }
  
  const startPoint = userMarker ? userMarker.getLatLng() : L.latLng(S.center[0], S.center[1]);
  const endPoint = L.latLng(lat, lng);
  
  if (window.routingControl) {
    map.removeControl(window.routingControl);
  }
  
  if (typeof L.Routing === 'undefined') {
    toast('Плагин маршрутизации недоступен', 'error');
    return;
  }

  toast('Строим маршрут...', 'success');
  window.routingControl = L.Routing.control({
    waypoints: [
      startPoint,
      endPoint
    ],
    routeWhileDragging: false,
    show: true, // show instructions
    lineOptions: {
      styles: [{color: '#ec4899', opacity: 0.8, weight: 6}]
    }
  }).addTo(map);
};


// ===== H3 GRID (MUSHROOM DENSITY) =====
window.h3Layer = null;

window.toggleH3Grid = function() {
  if (window.h3Layer) {
    map.removeLayer(window.h3Layer);
    window.h3Layer = null;
    toast('Сетка H3 отключена');
    return;
  }
  
  if (typeof h3 === 'undefined') {
    toast('Библиотека h3-js недоступна', 'error');
    return;
  }

  // Count mushrooms per H3 cell (resolution 8 is roughly 0.7km edge)
  const resolution = 8;
  const cellCounts = new Map();
  let maxCount = 0;

  S.mushrooms.forEach(m => {
    try {
      const cell = h3.latLngToCell(m.lat, m.lng, resolution);
      const count = (cellCounts.get(cell) || 0) + 1;
      cellCounts.set(cell, count);
      if (count > maxCount) maxCount = count;
    } catch(e) {}
  });

  if (cellCounts.size === 0) {
    toast('Нет данных для сетки H3', 'warning');
    return;
  }

  const hexPolygons = [];
  
  cellCounts.forEach((count, cell) => {
    try {
      const boundary = h3.cellToBoundary(cell);
      // boundary is [lat, lng][]
      const opacity = 0.2 + (0.6 * (count / maxCount));
      
      // Determine color based on density
      let color = '#3b82f6'; // Low density
      if (count > maxCount * 0.7) color = '#ef4444'; // High
      else if (count > maxCount * 0.3) color = '#eab308'; // Medium
      
      const poly = L.polygon(boundary, {
        color: color,
        weight: 1,
        fillColor: color,
        fillOpacity: opacity
      }).bindPopup(`Гексагон ${cell}<br>Найдено: <b>${count}</b>`);
      
      hexPolygons.push(poly);
    } catch(e) {}
  });

  window.h3Layer = L.layerGroup(hexPolygons).addTo(map);
  toast(`Сетка H3 включена (гексагонов: ${cellCounts.size})`, 'success');
};

// ===== PATH TRACKER =====
let watchId = null;
let pathPolyline = null;

function pointLineDist(pt, a, b) {
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  if (dx === 0 && dy === 0) {
    return Math.sqrt(Math.pow(pt[1] - a[1], 2) + Math.pow(pt[0] - a[0], 2));
  }
  let t = ((pt[1] - a[1]) * dx + (pt[0] - a[0]) * dy) / (dx*dx + dy*dy);
  t = Math.max(0, Math.min(1, t));
  const px = a[1] + t * dx;
  const py = a[0] + t * dy;
  return Math.sqrt(Math.pow(pt[1] - px, 2) + Math.pow(pt[0] - py, 2));
}

function simplifyPath(points, epsilon) {
  if (points.length <= 2) return points;
  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = pointLineDist(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const left = simplifyPath(points.slice(0, index + 1), epsilon);
    const right = simplifyPath(points.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [points[0], points[end]];
  }
}

function renderPath() {
  if (pathPolyline) {
    map.removeLayer(pathPolyline);
  }
  if (S.path && S.path.length > 1) {
    pathPolyline = L.polyline(S.path, { color: '#0ea5e9', weight: 4, opacity: 0.7, dashArray: '5, 5' }).addTo(map);
  }
}

window.toggleTracker = function() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    toast('Трекер маршрута остановлен', 'success');
  } else {
    if (!navigator.geolocation) {
      toast('Геолокация не поддерживается', 'error');
      return;
    }
    toast('Трекер маршрута запущен', 'success');
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const newPoint = [lat, lng];
        
        // Add to path if moved significantly (e.g. > 5 meters) to avoid GPS jitter
        if (S.path.length > 0) {
          const lastPoint = S.path[S.path.length - 1];
          const dist = map.distance(lastPoint, newPoint);
          if (dist > 5) {
            S.path.push(newPoint);
            if (S.path.length % 10 === 0) { // Optimize every 10 points
               S.path = simplifyPath(S.path, 0.00005); // ~5 meters tolerance
            }
            saveState();
            renderPath();
          }
        } else {
          S.path.push(newPoint);
          saveState();
          renderPath();
        }

        // Update user marker if exists
        if (userMarker) {
          userMarker.setLatLng(newPoint);
          updateRadar();
        } else {
          userMarker = L.marker(newPoint, {
            icon: L.divIcon({
              html: '<div style="width:16px;height:16px;background:#0e7490;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(14,116,144,0.5)"></div>',
              iconSize: [16, 16], iconAnchor: [8, 8], className: ''
            })
          }).addTo(map);
          updateRadar();
        }
      },
      (err) => {
        console.error('Tracker error:', err);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
  }
};

// Initial render
if (S.path && S.path.length > 0) {
  renderPath();
}

// ===== SYNC DATA =====
window.syncData = async function() {
  if (!deviceId) return;
  // No backend configured — offline-only mode, skip sync silently
  if (!API_BASE) return;

  const unsyncedMushrooms = S.mushrooms.filter(m => !m.synced);
  // We can always send path or just skip if nothing is new.
  // For simplicity, we send path every time if it exists, or we could also track unsynced path.
  // We'll focus on mushrooms for the queue.
  if (unsyncedMushrooms.length === 0) return; // Nothing to sync

  const payload = {
    device_id: deviceId,
    mushrooms: unsyncedMushrooms.map(m => ({
      client_id: m.client_id || m.id || ('m_' + Date.now() + Math.random()),
      lat: m.lat,
      lng: m.lng,
      source: safeSource(m.source),
      type: safeType(m.type),
      time: m.time || new Date().toISOString()
    })),
    path: S.path.map(p => ({ lat: p[0], lng: p[1] }))
  };

  try {
    const res = await fetch(`${API_BASE}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok' && Array.isArray(data.synced)) {
        let saved = false;
        S.mushrooms.forEach(m => {
          if (data.synced.includes(m.client_id || m.id) && !m.synced) {
            m.synced = true;
            saved = true;
          }
        });
        if (saved) {
          saveState();
          console.log(`Успешно синхронизировано ${data.synced.length} точек`);
        }
      }
    }
  } catch(e) {
    console.error('Ошибка синхронизации (Оффлайн режим)', e);
  }
};

// Auto-sync every 60 seconds (only if backend is configured)
if (API_BASE) {
  setInterval(window.syncData, 60000);
}

// We can also attach it to saveState so it syncs immediately when new data is added
const originalSaveState = window.saveState || saveState;
window.saveState = function() {
  originalSaveState();
  // Don't await, let it run in background
  window.syncData();
};

// ===== PHASE 9: GPX, COMPASS, DISTANCE, TOPO, SOUND =====

// --- SOUND ---
const successSound = new Audio('data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'); // Fallback empty sound
// To make a real bell sound, we can use web audio API:
function playBellSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5); // drop to A4
    gainNode.gain.setValueAtTime(1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch(e) {}
}

// Hook into save mushroom
const originalAddMushroom = window.addMushroomFromForm;
window.addMushroomFromForm = function() {
  if (originalAddMushroom) originalAddMushroom();
  playBellSound();
};
const originalDoSquat = window.doSquat;
window.doSquat = function() {
  if (originalDoSquat) originalDoSquat();
  playBellSound();
};


// --- DISTANCE ---
function calculateDistance() {
  if (!S.path || S.path.length < 2) return 0;
  let dist = 0;
  for(let i=1; i<S.path.length; i++) {
    dist += map.distance(S.path[i-1], S.path[i]);
  }
  return (dist / 1000).toFixed(2); // in km
}

function updateDistanceUI() {
  const el = document.getElementById('distTracker');
  if (el) el.innerText = `Пройдено: ${calculateDistance()} км`;
}

// Hook into renderPath to update distance
const originalRenderPath = window.renderPath;
window.renderPath = function() {
  if (originalRenderPath) originalRenderPath();
  updateDistanceUI();
};


// --- GPX EXPORT ---
window.exportGPX = function() {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GriboLocation">\n`;
  
  // Track
  if (S.path && S.path.length > 0) {
    gpx += `  <trk>\n    <name>Мой маршрут</name>\n    <trkseg>\n`;
    S.path.forEach(p => {
      gpx += `      <trkpt lat="${p[0]}" lon="${p[1]}"></trkpt>\n`;
    });
    gpx += `    </trkseg>\n  </trk>\n`;
  }

  // Waypoints (Mushrooms)
  S.mushrooms.forEach(m => {
    gpx += `  <wpt lat="${m.lat}" lon="${m.lng}">\n    <name>${m.type}</name>\n    <desc>${m.source}</desc>\n  </wpt>\n`;
  });

  gpx += `</gpx>`;
  
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gribo_track_${new Date().toISOString().slice(0,10)}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('GPX файл сохранен', 'success');
};


// --- GPX IMPORT ---
window.importGPX = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    
    // Parse track points
    const trkpts = xmlDoc.getElementsByTagName("trkpt");
    const newPath = [];
    for(let i=0; i<trkpts.length; i++) {
      newPath.push([
        parseFloat(trkpts[i].getAttribute("lat")),
        parseFloat(trkpts[i].getAttribute("lon"))
      ]);
    }
    if (newPath.length > 0) {
      L.polyline(newPath, { color: '#f43f5e', weight: 4, opacity: 0.5, dashArray: '10, 10' })
        .addTo(map)
        .bindPopup('Импортированный маршрут');
    }
    
    // Parse waypoints
    const wpts = xmlDoc.getElementsByTagName("wpt");
    let importedMushrooms = 0;
    for(let i=0; i<wpts.length; i++) {
      const lat = parseFloat(wpts[i].getAttribute("lat"));
      const lon = parseFloat(wpts[i].getAttribute("lon"));
      let name = "other";
      const nameNode = wpts[i].getElementsByTagName("name")[0];
      if (nameNode) name = nameNode.textContent;
      
      S.mushrooms.push({
        id: 'm_' + Date.now() + Math.random(),
        lat: lat,
        lng: lon,
        type: name,
        source: 'imported',
        time: new Date().toISOString()
      });
      importedMushrooms++;
    }
    
    if (importedMushrooms > 0 || newPath.length > 0) {
      saveState();
      renderMarkers();
      toast(`Импортировано точек: ${importedMushrooms}, маршрут добавлен.`, 'success');
    }
  };
  reader.readAsText(file);
};


// --- COMPASS (DeviceOrientation) ---
let compassActive = false;
window.toggleCompass = function() {
  if (compassActive) {
    window.removeEventListener('deviceorientationabsolute', handleOrientation);
    window.removeEventListener('deviceorientation', handleOrientation);
    compassActive = false;
    toast('Компас выключен');
    if (userMarker && userMarker._icon) userMarker._icon.style.transform = userMarker._icon.style.transform.replace(/rotateZ\(.*?\)/, '');
  } else {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(permissionState => {
          if (permissionState === 'granted') {
            startCompass();
          } else {
            toast('Нет доступа к компасу', 'error');
          }
        })
        .catch(console.error);
    } else {
      startCompass();
    }
  }
};

function startCompass() {
  compassActive = true;
  toast('Компас включен', 'success');
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', handleOrientation);
  } else {
    window.addEventListener('deviceorientation', handleOrientation);
  }
}

function handleOrientation(event) {
  let compassHeading;
  if (event.webkitCompassHeading) {
    compassHeading = event.webkitCompassHeading;
  } else if (event.absolute && event.alpha != null) {
    compassHeading = 360 - event.alpha;
  }
  
  if (compassHeading != null && userMarker && userMarker._icon) {
    const currentTransform = userMarker._icon.style.transform;
    const cleanTransform = currentTransform.replace(/rotateZ\(.*?\)/g, '');
    userMarker._icon.style.transform = cleanTransform + ` rotateZ(${compassHeading}deg)`;
    // Add arrow styling to user marker if not exists
    userMarker._icon.style.borderTop = '3px solid #ef4444'; // Red arrow pointing north
  }
}


// Set initial distance
updateDistanceUI();

// ===== PHASE 10: SUNLIGHT, SOS, VOICE, PEDOMETER, SHARE, BATTERY =====

// --- SUNLIGHT MODE ---
let sunlightMode = false;
window.toggleSunlightMode = function() {
  sunlightMode = !sunlightMode;
  if (sunlightMode) {
    document.body.style.background = '#ffffff';
    document.body.style.color = '#000000';
    document.getElementById('sidebar').style.background = '#f8fafc';
    document.querySelectorAll('.btn-secondary').forEach(b => {
      b.style.background = '#e2e8f0';
      b.style.color = '#0f172a';
    });
    document.querySelectorAll('.sb-title').forEach(t => t.style.color = '#000');
    toast('Светлый режим включен', 'success');
  } else {
    // Revert to dark
    document.body.style.background = '#0f172a';
    document.body.style.color = '#f8fafc';
    document.getElementById('sidebar').style.background = 'rgba(15,23,42,0.95)';
    document.querySelectorAll('.btn-secondary').forEach(b => {
      b.style.background = '#334155';
      b.style.color = 'white';
    });
    document.querySelectorAll('.sb-title').forEach(t => t.style.color = '#94a3b8');
    toast('Тёмный режим включен');
  }
};


// --- SOS MODE ---
let sosActive = false;
let sosInterval = null;
const sosAudio = new Audio('data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'); // fallback
function playSiren() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.5);
    osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 1.0);
    gainNode.gain.setValueAtTime(1, ctx.currentTime);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.0);
  } catch(e) {}
}

window.triggerSOS = function() {
  sosActive = !sosActive;
  if (sosActive) {
    document.body.style.background = '#dc2626'; // solid red
    sosInterval = setInterval(() => {
      document.body.style.background = document.body.style.background === 'rgb(220, 38, 38)' ? '#000000' : '#dc2626';
      playSiren();
    }, 1000);
    toast('🚨 SOS АКТИВИРОВАН 🚨', 'error');
  } else {
    clearInterval(sosInterval);
    document.body.style.background = sunlightMode ? '#ffffff' : '#0f172a';
    toast('SOS Отключен');
  }
};


// --- VOICE INPUT (Web Speech API) ---
let voiceActive = false;
let recognition = null;
window.toggleVoiceInput = function() {
  if (voiceActive) {
    if (recognition) recognition.stop();
    voiceActive = false;
    document.getElementById('btnVoice').innerText = '🎙 Голосовой Ввод (Выкл)';
    document.getElementById('btnVoice').style.background = sunlightMode ? '#e2e8f0' : '#334155';
    toast('Голосовой ввод отключен');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast('Ваш браузер не поддерживает голосовой ввод', 'error');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const word = event.results[last][0].transcript.trim().toLowerCase();
    console.log('Voice recognized:', word);
    
    // Map words to types
    let matchedType = null;
    if (word.includes('белы') || word.includes('боровик')) matchedType = 'white';
    else if (word.includes('подбер')) matchedType = 'brown';
    else if (word.includes('подосин')) matchedType = 'orange';
    else if (word.includes('лисич')) matchedType = 'chanterelle';
    else if (word.includes('опят') || word.includes('опенок')) matchedType = 'honey';
    
    if (matchedType) {
      document.getElementById('typeSelector').value = matchedType;
      // Auto-save at current location if GPS is tracking
      if (userMarker) {
        const pos = userMarker.getLatLng();
        S.mushrooms.push({
          id: 'm_' + Date.now() + Math.random(),
          lat: pos.lat,
          lng: pos.lng,
          type: matchedType,
          source: 'voice',
          time: new Date().toISOString()
        });
        
        autoSyncTheme(pos.lat, pos.lng);
        
        saveState();
        renderMarkers();
        playBellSound();
        toast(`Записано голосом: ${matchedType}`, 'success');
      } else {
        toast('Сначала получите координаты (Где я?)', 'error');
      }
    }
  };

  recognition.onerror = (e) => {
    console.error('Voice error', e);
  };

  recognition.onend = () => {
    if (voiceActive) recognition.start(); // auto-restart
  };

  recognition.start();
  voiceActive = true;
  document.getElementById('btnVoice').innerText = '🎙 Голосовой Ввод (ВКЛ)';
  document.getElementById('btnVoice').style.background = '#0ea5e9';
  toast('Голосовой ввод активирован. Скажите "Белый", "Лисичка" и т.д.', 'success');
};


// --- BATTERY STATUS ---
if ('getBattery' in navigator) {
  navigator.getBattery().then(battery => {
    function updateBatteryInfo() {
      const level = Math.round(battery.level * 100);
      const el = document.getElementById('batteryTracker');
      if (el) {
        el.innerText = `🔋 Батарея: ${level}% ${battery.charging ? '(Заряжается)' : ''}`;
        if (level <= 15 && !battery.charging) {
          el.style.color = '#dc2626';
          el.style.fontWeight = 'bold';
          toast('⚠️ Заряд батареи ниже 15%. Рекомендуем возвращаться!', 'error');
        } else {
          el.style.color = '#cbd5e1';
          el.style.fontWeight = 'normal';
        }
      }
    }
    updateBatteryInfo();
    battery.addEventListener('levelchange', updateBatteryInfo);
    battery.addEventListener('chargingchange', updateBatteryInfo);
  });
}


// --- PEDOMETER (ACCELEROMETER) ---
// Note: accurate pedometers require complex filtering. This is a basic step detector.
let steps = 0;
let lastAccelY = 0;
let lastStepTime = 0;
if (window.DeviceMotionEvent) {
  window.addEventListener('devicemotion', (e) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    const y = acc.y || 0;
    const delta = Math.abs(y - lastAccelY);
    const now = Date.now();
    
    // Threshold for a step (very rough approximation)
    if (delta > 2.5 && (now - lastStepTime) > 300) {
      steps++;
      lastStepTime = now;
      // We could display steps in UI, e.g. append to distance tracker
      const distEl = document.getElementById('distTracker');
      if (distEl && distEl.innerText.indexOf('Шагов:') === -1) {
        distEl.dataset.original = distEl.innerText;
      }
      if (distEl) {
        distEl.innerText = `${distEl.dataset.original || ''} | Шагов: ${steps}`;
      }
    }
    lastAccelY = y;
  });
}


// --- SHARE API FOR POPUP ---
window.shareMushroom = function(lat, lng, type) {
  if (navigator.share) {
    const geoUrl = `geo:${lat},${lng}?q=${lat},${lng}(Гриб+${type})`;
    navigator.share({
      title: 'Я нашел гриб!',
      text: `Координаты: ${lat}, ${lng}`,
      url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    }).catch(console.error);
  } else {
    toast('Ваш браузер не поддерживает Share API', 'error');
  }
};

// Hook into bindPopup to add share button
const originalRenderMarkers = window.renderMarkers;
window.renderMarkers = function() {
  if (originalRenderMarkers) originalRenderMarkers();
  
  // Re-bind popups with share button
  markersLayer.eachLayer(layer => {
    if (layer._mushData) {
      const m = layer._mushData;
      let imgHtml = '';
      if (m.photoData) {
        imgHtml = `<br><img src="${m.photoData}" style="max-width:100px; max-height:100px; border-radius:4px; margin-top:5px;"/>`;
      }
      
      const popupContent = `
        <div style="font-weight:bold; margin-bottom:5px;">Гриб: ${m.type}</div>
        <div style="color:#666; font-size:12px;">Способ: ${m.source}</div>
        <div style="color:#666; font-size:12px;">Время: ${new Date(m.time).toLocaleTimeString()}</div>
        ${imgHtml}
        <button class="btn btn-sm" style="margin-top:8px; width:100%;" onclick="shareMushroom(${m.lat}, ${m.lng}, '${m.type}')">Поделиться точкой</button>
      `;
      layer.bindPopup(popupContent);
    }
  });
};

