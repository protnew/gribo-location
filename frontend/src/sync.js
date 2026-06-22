// ===== SYNC DATA =====
// API base URL — configurable via Vite env var.
// Empty string (set in .env.production) = offline-only mode, no backend calls.
const API_BASE = import.meta.env.VITE_API_URL || '';

window.syncData = async function() {
  if (!deviceId) return;

  // No backend configured — offline-only mode, skip sync silently
  if (!API_BASE) return;

  const payload = {
    device_id: deviceId,
    mushrooms: S.mushrooms.map(m => ({
      client_id: m.id || ('m_' + Date.now() + Math.random()),
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
      console.log('Синхронизация прошла успешно');
    }
  } catch(e) {
    console.error('Ошибка синхронизации', e);
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
