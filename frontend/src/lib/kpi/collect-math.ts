/**
 * Helper aritmetika kolektor KPI (EPIC-010 Fase B) — murni & teruji.
 */

/**
 * Rasio aman utk kolektor: null bila penyebut tidak valid/nol (= data tidak
 * cukup → indikator dikeluarkan & bobot didistribusi ulang), pembilang
 * negatif di-clamp 0. Rasio boleh > 1 (attainment yang menilai arah).
 */
export function safeRatio(
  numerator: number,
  denominator: number
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return Math.max(0, numerator) / denominator;
}
