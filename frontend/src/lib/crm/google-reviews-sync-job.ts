/**
 * EPIC-013 Fase A — penjadwal sinkronisasi Google Review.
 *
 * Berjalan tiap 15 menit (ulasan tidak masuk sederas chat, dan kuota API
 * Google terbatas). No-op rapi bila kredensial belum diisi, sehingga tidak
 * membanjiri log sebelum integrasi aktif.
 */

import { syncGoogleReviews } from "./google-reviews-server";

const SYNC_INTERVAL_MS = 15 * 60_000;

let started = false;
let warnedNotConfigured = false;

export function startGoogleReviewSync(): void {
  if (started) return;
  started = true;

  const tick = () => {
    syncGoogleReviews()
      .then((summary) => {
        if (summary.notConfigured) {
          // Cukup sekali per proses — bukan tiap 15 menit.
          if (!warnedNotConfigured) {
            console.info("[google-reviews] Kredensial belum diisi — sinkronisasi dilewati.");
            warnedNotConfigured = true;
          }
          return;
        }
        if (summary.error) {
          console.warn("[google-reviews] Sinkronisasi gagal:", summary.error);
          return;
        }
        if (summary.inserted > 0 || summary.updated > 0) {
          console.log(
            `[google-reviews] ${summary.inserted} ulasan baru, ${summary.updated} diperbarui.`
          );
        }
      })
      .catch((error) => console.error("[google-reviews] Sinkronisasi error:", error));
  };

  setTimeout(tick, 45_000);
  setInterval(tick, SYNC_INTERVAL_MS);
}
