const C = 'polytab-v10';
const A = ['/', '/index.html', '/project.html', '/feed.json', '/feed.xml'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(A)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== C).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Feeds and JSON data snapshots: Network-first with dynamic cache update, fallback to cache if offline
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('.xml') || url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(C).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Static shell: Cache-first, fallback to network
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
