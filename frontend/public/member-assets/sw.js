/*
 * NüHabit Member: service worker portal /member.
 * Disajikan lewat /member/sw.js (src/app/member/sw.js/route.ts) dengan header
 * Service-Worker-Allowed supaya scope-nya /member, juga di host member.
 *
 * Strategi:
 *  - /_next/static/** dan /member-assets/**   -> cache-first (nama file ber-hash / aset kecil)
 *  - navigasi halaman di dalam scope          -> network-first, fallback salinan terakhir,
 *                                                lalu halaman offline
 *  - /api/** dan permintaan non-GET            -> tidak pernah disentuh (data member selalu segar)
 * Push: payload JSON {title, body, url, tag} dari src/lib/member-portal/push.ts.
 * Mode dev (?dev=1): hanya push, tanpa cache.
 */
const VERSION = 'nuhabit-member-v1';
// Didaftarkan dengan ?dev=1 saat `next dev`: tanpa cache supaya kode baru langsung terpakai.
const DEV = new URL(self.location.href).searchParams.has('dev');
const CACHE_STATIC = `${VERSION}-static`;
const CACHE_PAGES = `${VERSION}-pages`;
const OFFLINE_URL = '/member-assets/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/member-assets/manifest.webmanifest',
  '/member-assets/brand/wordmark-black.png',
  '/member-assets/icons/icon-192.png',
  '/member-assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => (key.startsWith('bcd-member-') || key.startsWith('nuhabit-member-')) && !key.startsWith(VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/member-assets/');

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_STATIC);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request) {
  const url = new URL(request.url);
  // Satu salinan per path: query (?go=...) tidak membuat entri baru.
  const key = url.origin + url.pathname;
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected && response.type === 'basic') {
      const cache = await caches.open(CACHE_PAGES);
      cache.put(key, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(key)) || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (DEV || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'NüHabit';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/member-assets/icons/icon-192.png',
      badge: '/member-assets/icons/icon-192.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/member' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/member', self.location.origin);
  // Hanya buka halaman di origin ini; payload push tidak boleh membawa member keluar.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).pathname.startsWith('/member'));
      if (existing) {
        await existing.focus();
        return existing.navigate(target.href);
      }
      return self.clients.openWindow(target.href);
    })()
  );
});
