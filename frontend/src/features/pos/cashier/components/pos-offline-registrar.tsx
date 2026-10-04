'use client';

import { useEffect } from 'react';

const SW_URL = '/sw.js';

/**
 * Daftarkan service worker POS lalu kirim daftar aset yang sudah dimuat
 * halaman ini agar langsung di-cache (lihat public/sw.js). Dipasang hanya
 * di halaman kasir yang ingin bisa dibuka saat offline.
 */
export function PosOfflineRegistrar() {
  useEffect(() => {
    // Dev: chunk Turbopack tidak di-hash per isi, jadi cache SW menyajikan kode basi.
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    const timers: number[] = [];

    const precache = () => {
      const controller = navigator.serviceWorker.controller;
      if (!controller || cancelled) return;
      const urls = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('/_next/static/'));
      controller.postMessage({ type: 'POS_PRECACHE', page: window.location.pathname, urls });
    };

    navigator.serviceWorker
      .register(SW_URL, { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (cancelled) return;
        if (navigator.serviceWorker.controller) {
          precache();
        } else {
          // Load pertama: SW baru mengendalikan halaman setelah clients.claim().
          navigator.serviceWorker.addEventListener('controllerchange', precache, { once: true });
        }
        // Chunk yang dimuat belakangan (dialog, ikon) ikut di-cache.
        timers.push(window.setTimeout(precache, 6_000));
      })
      .catch(() => {
        /* browser tanpa SW (mode privat dsb.) — kasir tetap jalan tanpa cache halaman */
      });

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return null;
}
