/**
 * SERVICE WORKER - PULSECHAT PWA
 * Met en cache l'interface statique pour un chargement rapide sur mobile
 */

const CACHE_NAME = 'pulsechat-v2-cache-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './login.html',
  './register.html',
  './css/style.css',
  './js/supabase-config.js',
  './js/presence.js',
  './js/profile.js',
  './js/users.js',
  './js/conversations.js',
  './js/messages.js',
  './js/app.js',
  './assets/icons/logo.svg',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Ne jamais mettre en cache les requêtes vers l'API Supabase
  if (url.hostname.includes('supabase.co')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            url.origin === self.location.origin
          ) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});