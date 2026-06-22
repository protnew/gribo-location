let peerConnection;
let dataChannel;

export function openP2PModal() {
  document.getElementById('p2pModal').style.display = 'flex';
}

function updateStatus(msg) {
  document.getElementById('p2pStatus').textContent = 'Статус: ' + msg;
}

export async function p2pHost() {
  updateStatus('Создание комнаты...');
  peerConnection = new RTCPeerConnection({ iceServers: [] }); // Local network only
  
  dataChannel = peerConnection.createDataChannel('gribo_sync');
  setupDataChannel(dataChannel);

  peerConnection.onicecandidate = e => {
    if (!e.candidate) {
      const offer = peerConnection.localDescription;
      // Encode as Base64 for easier copy pasting
      const token = btoa(JSON.stringify(offer));
      document.getElementById('p2pOfferToken').value = token;
      updateStatus('Ожидание подключения клиента...');
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
}

export async function p2pJoin() {
  updateStatus('Ожидание ответа хоста...');
  peerConnection = new RTCPeerConnection({ iceServers: [] });
  
  peerConnection.ondatachannel = e => {
    dataChannel = e.channel;
    setupDataChannel(dataChannel);
  };

  peerConnection.onicecandidate = e => {
    if (!e.candidate) {
      const answer = peerConnection.localDescription;
      const token = btoa(JSON.stringify(answer));
      document.getElementById('p2pOfferToken').value = token;
      updateStatus('Передайте токен хосту!');
    }
  };
  
  const hostTokenStr = document.getElementById('p2pAnswerToken').value.trim();
  if (!hostTokenStr) {
    updateStatus('Ошибка: Вставьте токен хоста');
    return;
  }
  
  try {
    const offer = JSON.parse(atob(hostTokenStr));
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
  } catch(e) {
    updateStatus('Ошибка парсинга токена');
  }
}

export async function p2pConnect() {
  const tokenStr = document.getElementById('p2pAnswerToken').value.trim();
  if (!tokenStr) return;
  try {
    const answer = JSON.parse(atob(tokenStr));
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    updateStatus('Соединение установлено!');
  } catch(e) {
    updateStatus('Ошибка парсинга токена клиента');
  }
}

function setupDataChannel(channel) {
  channel.onopen = () => {
    updateStatus('Подключено! Обмен данными...');
    // Send our mushrooms
    const payload = JSON.stringify({
      mushrooms: window.S.mushrooms.filter(m => !m.synced),
      deviceId: window.deviceId
    });
    channel.send(payload);
  };
  
  channel.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      if (data.mushrooms && Array.isArray(data.mushrooms)) {
        let added = 0;
        data.mushrooms.forEach(m => {
          // Add if not exists
          const exists = window.S.mushrooms.find(ex => (ex.client_id || ex.id) === (m.client_id || m.id));
          if (!exists) {
            window.S.mushrooms.push(m);
            added++;
          }
        });
        if (added > 0) {
          window.saveState();
          updateStatus(`Получено ${added} новых грибов!`);
          // Redraw map
          window.dispatchEvent(new Event('render-map'));
        } else {
          updateStatus('Нет новых данных');
        }
      }
    } catch(err) {
      console.error(err);
    }
  };
}

// Bind to window for HTML handlers
window.openP2PModal = openP2PModal;
window.p2pHost = p2pHost;
window.p2pJoin = p2pJoin;
window.p2pConnect = p2pConnect;
