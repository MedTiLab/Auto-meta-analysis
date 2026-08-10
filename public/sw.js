// Service Worker for MedHelp PWA.
//
// The app is served from local builds with hashed Vite chunks. Caching the app
// shell here can strand a browser on an old index.html that points at chunks
// removed by the latest build, which appears as "Failed to fetch dynamically
// imported module". Keep the service worker only as a cleanup shim.

const CACHE_NAME_PREFIXES = ['medhelp-'];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if ('caches' in self) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(cacheName => CACHE_NAME_PREFIXES.some(prefix => cacheName.startsWith(prefix)))
          .map(cacheName => caches.delete(cacheName))
      );
    }

    await self.clients.claim();
  })());
});
