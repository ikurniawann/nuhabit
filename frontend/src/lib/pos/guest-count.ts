/**
 * Jumlah tamu per pesanan (pax) — EPIC-038.
 *
 * Modul murni, dipakai UI kasir DAN endpoint pembuatan pesanan. Normalisasi
 * harus terjadi di server juga, bukan hanya di UI: ada jalur lain yang membuat
 * pesanan (seat reservation, open bill dari tablet) dan payload bisa datang
 * dari klien mana pun.
 */

/** Kasir tidak mengisi → dianggap satu orang (keputusan owner 2026-07-31). */
export const DEFAULT_GUEST_COUNT = 1;

/**
 * Batas atas yang wajar. Bukan aturan bisnis, melainkan penjaga salah ketik:
 * "1000" hampir pasti kekeliruan, dan satu baris seperti itu cukup untuk
 * merusak rata-rata tamu per meja di laporan owner selamanya.
 */
export const MAX_GUEST_COUNT = 500;

/**
 * Ubah input apa pun menjadi jumlah tamu yang masuk akal.
 *
 * Sengaja tidak pernah melempar error: ini dipanggil di tengah alur kasir yang
 * sedang melayani antrean. Input aneh jatuh ke default, bukan menggagalkan
 * pesanan.
 */
export function normalizeGuestCount(raw: unknown): number {
  if (raw === null || raw === undefined) return DEFAULT_GUEST_COUNT;

  const teks = typeof raw === "string" ? raw.trim() : raw;
  if (teks === "") return DEFAULT_GUEST_COUNT;

  const angka = Number(teks);
  if (!Number.isFinite(angka)) return DEFAULT_GUEST_COUNT;

  const bulat = Math.floor(angka);
  if (bulat < 1) return DEFAULT_GUEST_COUNT;
  return Math.min(bulat, MAX_GUEST_COUNT);
}

/**
 * Pesan peringatan bila tamu melebihi kapasitas meja — `null` bila aman.
 *
 * Keputusan owner: **peringatkan, jangan blokir.** Restoran nyata menambah
 * kursi; memblokir hanya membuat kasir mengisi angka palsu agar bisa lanjut,
 * dan data palsu lebih buruk daripada data yang melebihi kapasitas.
 */
export function capacityWarning(
  guests: number,
  capacity: number | null | undefined
): string | null {
  if (!capacity || capacity <= 0) return null; // kapasitas tidak tercatat
  if (guests <= capacity) return null;
  return `${guests} tamu melebihi kapasitas meja (${capacity} kursi). Tetap bisa dilanjutkan.`;
}
