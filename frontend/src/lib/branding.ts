/**
 * Nama merek instance (owner 2026-09-06). Satu basis kode dipakai beberapa
 * perusahaan (NüHabit, Sulu in Wounderland, …) lewat deployment
 * terpisah, jadi nama merek TIDAK boleh ditulis langsung di komponen/dokumen.
 *
 * Sumber (paling spesifik dulu): nama perusahaan di DB (lihat
 * branding-server.ts) → configuration.app_settings 'app_brand_name' →
 * env NEXT_PUBLIC_APP_NAME → default di bawah.
 */

export const DEFAULT_BRAND_NAME = "NüHabit";

/** Aman dipanggil di client & server (hanya membaca env build-time). */
export function brandName(): string {
  return (process.env.NEXT_PUBLIC_APP_NAME || "").trim() || DEFAULT_BRAND_NAME;
}

/** Nama produk desktop/ERP, mis. "NüHabit OS". */
export function brandOsName(): string {
  return `${brandName()} OS`;
}

/** Pure: pilih nama merek dari kandidat berurutan prioritas. */
export function pickBrandName(...candidates: (string | null | undefined)[]): string {
  for (const value of candidates) {
    const name = String(value ?? "").trim();
    if (name) return name;
  }
  return brandName();
}
