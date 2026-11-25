/**
 * SERVICE WORKER - PULSECHAT PWA V2.3
 * Écrase automatiquement les anciens caches et sert toujours la dernière version en ligne
 * tout en conservant le mode hors-ligne.
 */

const CACHE_NAME = 'pulsechat-v2.3-cache';
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
  './js/media.js',
  './js/statuses-pages.js',
  './js/whatsapp-pro.js',
  './js/app.js',
  './assets/icons/logo.svg',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((asset) =>
          fetch(new Request(asset, { cache: 'reload' }))
            .then((res) => {
              if (res && res.ok) {
                return cache.put(asset, res);
              }
            })
            .catch(() => {})
        )
      );
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
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ne jamais mettre en cache les requêtes vers l'API Supabase ou le Storage
  if (url.hostname.includes('supabase.co')) return;

  // Uniquement les fichiers de l'application (même origine)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
          return cachedResponse || caches.match('./index.html');
        })
      )
  );
});