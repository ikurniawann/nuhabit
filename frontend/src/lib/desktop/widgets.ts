/**
 * Daftar widget papan desktop.
 *
 * Dipisah dari komponen `desktop-monitor` (client component) supaya kode
 * SERVER — mis. /api/desktop/preferences — bisa memakai daftar key-nya tanpa
 * ikut menarik React, hooks, dan next/navigation ke dalam bundel route.
 */

export type MonitorWidgetKey =
  | "omzet"
  | "promo"
  | "tamu"
  | "pulsa"
  | "tim"
  | "keputusan"
  | "stok"
  | "member";

export const MONITOR_WIDGETS: Array<{ key: MonitorWidgetKey; title: string; description: string }> = [
  { key: "omzet", title: "Pendapatan", description: "Total per periode, komposisi sumber & proyeksi." },
  { key: "promo", title: "Dampak Promo", description: "Diskon yang keluar vs omzet yang dibawanya." },
  { key: "tamu", title: "Tamu di Meja", description: "Jumlah tamu yang sedang duduk saat ini." },
  { key: "pulsa", title: "Ringkasan Transaksi", description: "Omzet & pesanan hari ini vs kemarin." },
  { key: "tim", title: "Tim Hari Ini", description: "Hadir, terlambat, belum absen, dan cuti." },
  { key: "keputusan", title: "Perlu Keputusan", description: "Pengajuan & dokumen yang menunggu approval." },
  { key: "stok", title: "Stok Menipis", description: "Bahan baku di bawah batas minimum." },
  { key: "member", title: "Member & Loyalty", description: "Member baru, XP, dan penukaran reward 7 hari." },
];

export const MONITOR_KEYS: MonitorWidgetKey[] = MONITOR_WIDGETS.map((w) => w.key);

/**
 * Urutan tersimpan bisa basi (widget dihapus/ditambah antar-versi): buang key
 * asing, lalu sisipkan key baru di belakang sesuai urutan default — widget baru
 * tidak boleh hilang hanya karena user pernah menyimpan urutan lama.
 */
export function normalizeWidgetOrder(saved: unknown): MonitorWidgetKey[] {
  const valid = Array.isArray(saved)
    ? (saved.filter((k): k is MonitorWidgetKey => MONITOR_KEYS.includes(k as MonitorWidgetKey)) as MonitorWidgetKey[])
    : [];
  const unik = [...new Set(valid)];
  return [...unik, ...MONITOR_KEYS.filter((k) => !unik.includes(k))];
}
