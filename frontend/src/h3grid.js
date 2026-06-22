
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
