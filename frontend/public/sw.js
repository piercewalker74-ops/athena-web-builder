// Minimal service worker — its ONLY job is to make Athena installable as a PWA.
// It deliberately does NOT cache anything: the desktop bridge relies on the server's
// no-store HTML headers to update instantly, and a caching SW would fight that.
// The empty fetch handler satisfies the install criterion without altering requests.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough — let the network handle it */ });
