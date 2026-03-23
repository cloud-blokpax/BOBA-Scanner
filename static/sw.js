// Self-destructing service worker.
//
// This file replaces the legacy vanilla JS service worker (boba-v5).
// Any browser that still has /sw.js registered will fetch this updated
// version, which immediately unregisters itself and clears the old cache.
// The SvelteKit service worker at /service-worker.js handles all PWA
// caching going forward.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Delete ALL caches created by the old service worker
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('boba-'))
            .map((key) => caches.delete(key))
        )
      ),
      // Unregister this service worker so it never runs again
      self.registration.unregister()
    ]).then(() => {
      // Notify all open tabs to reload with the clean SvelteKit SW
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'LEGACY_SW_REMOVED' });
        });
      });
    })
  );
});
