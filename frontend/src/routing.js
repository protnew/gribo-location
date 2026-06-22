
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
