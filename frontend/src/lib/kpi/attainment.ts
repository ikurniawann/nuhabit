/**
 * Engine attainment KPI (EPIC-010) — murni & generik.
 * Formula disetujui owner 2026-07-19:
 *   higher_better : min(cap, actual/target)
 *   lower_better  : min(cap, target/actual)   (actual 0 = sempurna → cap)
 *   boolean       : tercapai (>=1) ? 1 : 0    (tanpa bonus cap)
 * Return null = indikator dikeluarkan dari skor (data absen/target tak valid) —
 * bobotnya didistribusi ulang oleh composeScore (aturan minimum data).
 */

export type KpiDirection = "higher_better" | "lower_better" | "boolean";

/** Cap over-achievement 120% agar satu indikator jebol tak menutupi yang gagal. */
export const ATTAINMENT_CAP = 1.2;

export interface AttainmentInput {
  direction: KpiDirection;
  /** Nilai aktual periode; null/undefined = data tidak tersedia */
  actual: number | null | undefined;
  /** Target periode */
  target: number | null | undefined;
}

const clamp = (value: number) => Math.min(ATTAINMENT_CAP, Math.max(0, value));

export function computeAttainment(input: AttainmentInput): number | null {
  const { direction } = input;
  const actual = input.actual;
  const target = input.target;

  if (actual === null || actual === undefined || !Number.isFinite(actual)) {
    return null;
  }

  if (direction === "boolean") {
    return actual >= 1 ? 1 : 0;
  }

  if (target === null || target === undefined || !Number.isFinite(target)) {
    return null;
  }

  if (direction === "higher_better") {
    if (target <= 0) return null; // target tak valid utk rasio naik
    return clamp(actual / target);
  }

  // lower_better
  if (target < 0) return null;
  if (target === 0) {
    // Target nol = tak boleh ada sama sekali: tepat 0 → 1.0, selebihnya gagal.
    return actual <= 0 ? 1 : 0;
  }
  if (actual <= 0) return ATTAINMENT_CAP; // sempurna (mis. 0 menit telat)
  return clamp(target / actual);
}
