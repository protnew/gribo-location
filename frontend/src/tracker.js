// ===== PATH TRACKER =====
let watchId = null;
let pathPolyline = null;

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
        } else {
          userMarker = L.marker(newPoint, {
            icon: L.divIcon({
              html: '<div style="width:16px;height:16px;background:#0e7490;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(14,116,144,0.5)"></div>',
              iconSize: [16, 16], iconAnchor: [8, 8], className: ''
            })
          }).addTo(map);
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
