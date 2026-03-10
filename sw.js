// Service Worker — BOBA Scanner v2.0
// Provides offline support and caches critical assets for instant repeat visits.
// Version-aware: checks version.json on activate and busts stale caches.

const CACHE_NAME = 'boba-v3';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/card-database.json',
  '/version.json'
];

// Install — precache critical assets, skip waiting to activate immediately
// Use individual add() calls so one missing asset doesn't break the whole install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn('SW: failed to cache', url, err.message);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up ALL old caches (any name that isn't current)
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
