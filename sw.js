const CACHE_NAME = 'freestyle-studio-v5';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=5',
  './app.js?v=5',
  './manifest.json',
  './icon.svg',
  './beats.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // If request is for Google Drive stream, do not cache or intercept
  if (event.request.url.includes('drive.google.com') || event.request.url.includes('docs.google.com')) {
    return;
  }
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
