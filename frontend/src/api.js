// API base URL — configurable via Vite env var.
// Empty string (set in .env.production) = offline-only mode, no backend calls.
const API_BASE = import.meta.env.VITE_API_URL || '';

export async function syncData(mushrooms, deviceId) {
  // No backend configured — offline-only mode, skip sync silently
  if (!API_BASE) return { success: false, error: 'offline', count: 0 };

  const unsynced = mushrooms.filter(m => !m.synced);
  if (unsynced.length === 0) return { success: true, count: 0 };

  try {
    const payload = unsynced.map(m => ({
      id: m.id,
      client_id: m.client_id,
      lat: m.lat,
      lng: m.lng,
      source: m.source,
      type: m.type,
      time: m.time,
      device_id: deviceId
    }));

    const response = await fetch(`${API_BASE}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return { success: true, count: unsynced.length };
    } else {
      return { success: false, error: 'HTTP status ' + response.status };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}
