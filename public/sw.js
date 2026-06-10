// Minimal service worker: enables PWA install. Network-first — the app needs
// the network for YouTube/Claude anyway, so no offline caching games.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
