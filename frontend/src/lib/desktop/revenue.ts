/**
 * Perhitungan murni Revenue Overview & Dampak Promo (EPIC-037 Fase B).
 *
 * Modul murni — tanpa I/O. SQL-nya ada di `overview.ts`; yang di sini adalah
 * bagian yang mudah salah dan sulit terlihat salahnya: porsi yang tidak
 * berjumlah 100, pembagian nol yang menjadi NaN/Infinity, dan angka yang
 * "terlihat wajar" padahal tidak punya arti.
 */

export type RevenueSourceKey = "fnb" | "b2b" | "lain";

export interface RevenueSource {
  kunci: RevenueSourceKey;
  label: string;
  nilai: number;
}

export interface RevenueBreakdown {
  total: number;
  /** Hanya sumber bernilai > 0, berikut porsinya dalam persen bulat. */
  sumber: Array<RevenueSource & { porsi: number }>;
}

/**
 * Total + komposisi sumber pendapatan.
 *
 * Porsi dibulatkan, lalu selisih pembulatan dititipkan ke porsi TERBESAR
 * supaya jumlahnya tetap 100 — owner yang menjumlahkan sendiri tidak menemukan
 * angka yang hilang. Total ≤ 0 (mis. refund melebihi penjualan) membuat porsi
 * tidak punya arti, jadi dikembalikan 0 alih-alih persentase negatif.
 */
export function breakdownRevenue(sumber: RevenueSource[]): RevenueBreakdown {
  const total = sumber.reduce((acc, s) => acc + s.nilai, 0);
  const tampil = sumber.filter((s) => s.nilai > 0);

  if (total <= 0) {
    return { total, sumber: tampil.map((s) => ({ ...s, porsi: 0 })) };
  }

  const denganPorsi = tampil.map((s) => ({
    ...s,
    porsi: Math.round((s.nilai / total) * 100),
  }));

  const selisih = 100 - denganPorsi.reduce((acc, s) => acc + s.porsi, 0);
  if (selisih !== 0 && denganPorsi.length > 0) {
    const terbesar = denganPorsi.reduce((a, b) => (b.nilai > a.nilai ? b : a));
    terbesar.porsi += selisih;
  }

  return { total, sumber: denganPorsi };
}

/**
 * Rupiah omzet yang dibawa per rupiah diskon.
 *
 * `null` saat belum ada diskon sama sekali — berbeda dari `0`, yang berarti
 * diskon sudah keluar tapi tidak membawa penjualan. Perbedaan itu penting:
 * yang pertama "belum ada data", yang kedua kabar buruk.
 */
export function promoEfficiency(diskon: number, omzetTerbawa: number): number | null {
  if (diskon <= 0) return null;
  return Math.round((omzetTerbawa / diskon) * 100) / 100;
}
