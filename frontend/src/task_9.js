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


// --- TOPO MAP LAYER ---
const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
});
L.control.layers(
  { 'Обычная (CartoDB)': map._layers[Object.keys(map._layers)[0]], 'Рельеф (OpenTopoMap)': topoLayer },
  {}, { position: 'bottomright' }
).addTo(map);

// Set initial distance
updateDistanceUI();
