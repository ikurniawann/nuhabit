/*
 * BCD POS — service worker.
 * Tujuan: halaman kasir (/dashboard/pos/*) tetap bisa DIBUKA saat internet
 * putus, bukan cuma bertahan selama tab masih terbuka. Data transaksi
 * offline sendiri disimpan aplikasi di IndexedDB (lihat src/lib/pos-db.ts).
 *
 * Strategi:
 *  - /_next/static/**, foto produk, logo   → cache-first (nama file ber-hash)
 *  - navigasi & RSC ke /dashboard/pos/**   → network-first, fallback cache
 *  - GET API katalog/pengaturan kasir      → network-first, fallback cache
 *  - selain itu (POST, halaman lain, API lain) → tidak disentuh
 * Respons hasil redirect (mis. ke /login) tidak pernah di-cache.
 */
const VERSION = 'nuhabit-pos-v1';
const CACHE_STATIC = `${VERSION}-static`;
const CACHE_PAGES = `${VERSION}-pages`;
const CACHE_API = `${VERSION}-api`;

const POS_PAGE = /^\/dashboard\/pos(\/|$)/;
const API_CACHEABLE = [
  /^\/api\/pos\/(products|customers|billing-settings|loyalty-settings|payment-methods)(\/|\?|$)/,
  /^\/api\/auth\/stall-options(\?|$)/,
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => (key.startsWith('bcd-pos-') || key.startsWith('nuhabit-pos-')) && !key.startsWith(VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

function isCacheableHtml(response) {
  return (
    response &&
    response.ok &&
    !response.redirected &&
    (response.headers.get('content-type') || '').includes('text/html')
  );
}

function isCacheableOk(response) {
  return response && response.ok && !response.redirected;
}

async function networkFirst(request, cacheName, cacheable, cacheKey) {
  const cache = await caches.open(cacheName);
  const key = cacheKey || request;
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (isCacheableOk(response)) await cache.put(request, response.clone());
  return response;
}

/*
 * Halaman mengirim daftar chunk JS/CSS yang sudah dimuat + path halamannya
 * sendiri supaya di-cache sekarang juga (permintaan pertama terjadi sebelum
 * SW mengendalikan halaman, jadi belum sempat lewat sini).
 */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'POS_PRECACHE') return;
  event.waitUntil(
    (async () => {
      const stat = await caches.open(CACHE_STATIC);
      await Promise.all(
        (data.urls || []).map(async (url) => {
          try {
            if (await stat.match(url)) return;
            const response = await fetch(url);
            if (isCacheableOk(response)) await stat.put(url, response);
          } catch {
            /* satu chunk gagal tidak boleh menggagalkan yang lain */
          }
        })
      );
      if (data.page && POS_PAGE.test(data.page)) {
        try {
          const response = await fetch(data.page, {
            credentials: 'same-origin',
            headers: { Accept: 'text/html' },
          });
          if (isCacheableHtml(response)) {
            const pages = await caches.open(CACHE_PAGES);
            await pages.put(data.page, response);
          }
        } catch {
          /* offline saat precache — halaman sudah/akan ter-cache lain waktu */
        }
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/products/') ||
    url.pathname.startsWith('/brand/')
  ) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  if (POS_PAGE.test(url.pathname)) {
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, CACHE_PAGES, isCacheableHtml, url.pathname));
      return;
    }
    if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) {
      event.respondWith(networkFirst(request, CACHE_PAGES, isCacheableOk));
      return;
    }
    return;
  }

  const target = url.pathname + url.search;
  if (API_CACHEABLE.some((pattern) => pattern.test(target))) {
    event.respondWith(networkFirst(request, CACHE_API, isCacheableOk));
  }
});
