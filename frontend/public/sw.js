const CACHE_NAME = 'gribo-location-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  // Usually Vite chunks are added here, but for tiles we use runtime caching
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Cache Map Tiles (CartoDB, OSM, OpenTopoMap)
  if (url.hostname.includes('cartocdn.com') || 
      url.hostname.includes('openstreetmap.org') || 
      url.hostname.includes('opentopomap.org')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          return caches.open('gribo-map-tiles').then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }).catch(() => {
          // Fallback image if offline
          return new Response('', { status: 404, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // API calls are bypassed, sync handles offline logic
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Default Stale-While-Revalidate for other assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
        });
        return networkResponse;
      }).catch(() => {
        // Ignore fetch errors
      });
      return cachedResponse || fetchPromise;
    })
  );
});
