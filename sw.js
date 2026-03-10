// Service Worker — BOBA Scanner v1.0
// Provides offline support and caches critical assets for instant repeat visits.

const CACHE_NAME = 'boba-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/card-database.json',
  '/version.json'
];

// JS files to precache (core modules only — heavy modules loaded on demand)
const JS_PRECACHE = [
  '/js/state.js',
  '/js/config.js',
  '/js/database.js',
  '/js/collections.js',
  '/js/api.js',
  '/js/heroes.js',
  '/js/scanner.js',
  '/js/ui.js',
  '/js/ocr.js',
  '/js/google-auth.js',
  '/js/app.js'
];

// Install — precache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([...PRECACHE_URLS, ...JS_PRECACHE]);
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — stale-while-revalidate for static assets, network-first for API calls
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and API calls (always hit network)
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  // For navigation requests and same-origin assets: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => {
            // Network failed — return cached or offline fallback
            return cached || new Response('Offline', { status: 503 });
          });

          // Return cached immediately, update in background
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // External resources (CDN, fonts) — cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Background sync — push pending collection changes when connectivity returns
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-collections') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_COLLECTIONS' }));
      })
    );
  }
});
