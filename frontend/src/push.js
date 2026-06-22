export async function setupPushNotifications() {
  if (!('Notification' in window)) {
    console.warn('Push-уведомления не поддерживаются браузером.');
    return;
  }

  if (Notification.permission === 'granted') {
    subscribeUser();
  } else if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      subscribeUser();
    }
  }
}

async function subscribeUser() {
  if (!('serviceWorker' in navigator)) return;
  
  try {
    const registration = await navigator.serviceWorker.ready;
    // In a real app we need a VAPID public key
    // const applicationServerKey = urlB64ToUint8Array('<PUBLIC_VAPID_KEY>');
    // const subscription = await registration.pushManager.subscribe({
    //   userVisibleOnly: true,
    //   applicationServerKey: applicationServerKey
    // });
    
    // For MVP, we'll just mock the subscription and use local notifications triggered by WebSocket
    console.log('Push уведомления активированы (Мок)');
  } catch (err) {
    console.error('Ошибка подписки на пуши:', err);
  }
}

export function showLocalNotification(title, body) {
  if (Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body: body,
        icon: '/pwa-192x192.png',
        vibrate: [200, 100, 200]
      });
    });
  }
}

// Bind to window for incoming WebSocket events
window.showLocalNotification = showLocalNotification;
