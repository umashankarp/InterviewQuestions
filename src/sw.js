/* Offline support. App shell is precached; CDN libraries and topic data are cached on first use
   (stale-while-revalidate), so anything you have opened once works offline afterwards. */
const VERSION = 'iq-v3';
const SHELL = ['./', 'index.html', 'assets/site.css', 'assets/topics.js', 'assets/checklist.js', 'assets/app.js', 'assets/icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req);
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
