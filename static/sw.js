// Service Worker — BOBA Scanner v3.0 (World-Class PWA)
// Differentiated caching: cache-first for shell, stale-while-revalidate for DB,
// network-first for prices. Re-caches critical assets on every launch to protect
// against iOS 7-day cache eviction.

const CACHE_NAME = 'boba-v5';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/version.json'
];
const DB_ASSETS = [
  '/card-database.json'
];

// Install — precache app shell + DB, skip waiting for immediate activation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        [...APP_SHELL, ...DB_ASSETS].map(url =>
          cache.add(url).catch(err => {
            console.warn('SW: failed to cache', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up ALL old caches, claim all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — differentiated strategies per resource type
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip non-http(s) schemes (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // Skip cross-origin requests (fonts, external images, etc.)
  // Let the browser handle these directly — avoids CSP connect-src issues
  if (url.origin !== self.location.origin) return;

  // API calls — always network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // eBay / price data — network-first with cache fallback
  if (url.pathname.includes('ebay') || url.pathname.includes('price')) {
    event.respondWith(networkFirstWithCacheFallback(event.request));
    return;
  }

  // Card database — stale-while-revalidate (serve cached fast, update in bg)
  if (url.pathname === '/card-database.json') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // App shell (same origin) — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(event.request));
});

// ── Caching strategies ──────────────────────────────────────────────────────

// Stale-while-revalidate: serve cached immediately, update in background
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then(cache =>
    cache.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => {
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      });

      if (cached) {
        // Serve stale, revalidate in background (fire-and-forget)
        fetchPromise.catch(() => {});
        return cached;
      }
      return fetchPromise;
    })
  );
}

// Network-first: try network, fall back to cache
function networkFirstWithCacheFallback(request) {
  return fetch(request).then(response => {
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    return response;
  }).catch(() => {
    return caches.match(request).then(cached => {
      return cached || new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    });
  });
}

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

// Re-cache critical assets on every page load message from client
// (protects against iOS Safari's aggressive 7-day cache eviction)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'RECACHE_SHELL') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache =>
        Promise.allSettled(
          APP_SHELL.map(url => cache.add(url).catch(() => {}))
        )
      )
    );
  }
});
