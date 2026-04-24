const CACHE_NAME = 'ironwork-app-shell-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/ironwork_symbol_forgeblock.svg',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

function responseHasType(response, expectedType) {
  return (response.headers.get('content-type') || '').toLowerCase().includes(expectedType);
}

function canCacheResponse(request, response) {
  if (!response.ok) return false;

  if (request.mode === 'navigate' || request.destination === 'document') {
    return responseHasType(response, 'text/html');
  }

  if (request.destination === 'manifest') {
    return responseHasType(response, 'application/manifest+json')
      || responseHasType(response, 'application/json');
  }

  if (request.destination === 'image') return responseHasType(response, 'image/');
  if (request.destination === 'font') return responseHasType(response, 'font/');

  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/') || request.destination === 'script' || request.destination === 'style') {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (canCacheResponse(request, response)) {
            const responseClone = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseClone));
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match('/index.html');
          return cachedResponse || Response.error();
        })
    );
    return;
  }

  const shouldCache = ['image', 'font', 'manifest'].includes(request.destination)
    || PRECACHE_URLS.includes(url.pathname);

  if (!shouldCache) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then((response) => {
        if (canCacheResponse(request, response)) {
          const responseClone = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return response;
      });
    })
  );
});
