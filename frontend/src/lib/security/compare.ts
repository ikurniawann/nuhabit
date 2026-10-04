import { createHash, timingSafeEqual } from "crypto";

/**
 * Perbandingan rahasia (token webhook, token callback) dalam waktu konstan.
 * Kedua sisi di-hash SHA-256 dulu supaya panjangnya selalu sama: waktu
 * eksekusi tidak membocorkan panjang maupun prefiks yang cocok.
 *
 * Sisi kosong (null, undefined, "") selalu false. Rahasia yang belum
 * dikonfigurasi tidak boleh cocok dengan header yang juga kosong.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}
