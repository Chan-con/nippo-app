// This Service Worker intentionally unregisters itself.
// Rationale: the legacy renderer app used a root-scoped SW that can break Next.js dev/prod
// by caching or intercepting requests for /_next/* assets.

self.addEventListener('install', (event) => {
  // Activate immediately.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Attempt to clear caches created by previous SW versions.
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } finally {
        try {
          await self.registration.unregister();
        } catch {
          // ignore
        }

        // Take control to ensure the unregister propagates quickly.
        try {
          await self.clients.claim();
        } catch {
          // ignore
        }
      }
    })()
  );
});

// No fetch handler on purpose.
