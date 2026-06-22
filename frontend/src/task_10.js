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
