/**
 * Komposit skor scorecard (EPIC-010): skor = Σ (bobot × attainment),
 * skala 0–100 TANPA grade (keputusan owner 2026-07-19).
 * Komponen ber-attainment null (data kurang/aturan minimum data) dikeluarkan
 * dan bobotnya didistribusi ulang proporsional ke komponen tersisa.
 */

export interface ScorecardComponent {
  /** code indikator (kpi_indicators.code) */
  code: string;
  /** bobot role (Σ = 100) */
  weight: number;
  /** hasil computeAttainment; null = dikeluarkan */
  attainment: number | null;
}

export interface ScorecardBreakdownRow {
  code: string;
  weight: number;
  /** bobot setelah redistribusi (0 bila dikeluarkan) */
  effectiveWeight: number;
  attainment: number | null;
  /** kontribusi ke rawScore (effectiveWeight × attainment) */
  contribution: number;
}

export interface ScorecardResult {
  /** Skor final 0–100 (cap 100); null bila tidak ada komponen bernilai */
  score: number | null;
  /** Skor sebelum cap 100 — utk audit over-achievement */
  rawScore: number | null;
  /** Σ bobot komponen yang ikut dihitung (sebelum redistribusi) */
  usedWeight: number;
  /** code komponen yang dikeluarkan (attainment null) */
  excluded: string[];
  breakdown: ScorecardBreakdownRow[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function composeScore(
  components: ScorecardComponent[]
): ScorecardResult {
  const included = components.filter(
    (component) =>
      component.attainment !== null &&
      Number.isFinite(component.attainment) &&
      component.weight > 0
  );
  // excluded = semua komponen yang tidak ikut skor (attainment kosong ATAU
  // bobot 0) — agar audit trail lengkap.
  const excluded = components
    .filter(
      (component) =>
        component.attainment === null ||
        !Number.isFinite(component.attainment ?? NaN) ||
        component.weight <= 0
    )
    .map((component) => component.code);

  const usedWeight = included.reduce((acc, component) => acc + component.weight, 0);

  if (usedWeight <= 0) {
    return {
      score: null,
      rawScore: null,
      usedWeight: 0,
      excluded,
      breakdown: components.map((component) => ({
        code: component.code,
        weight: component.weight,
        effectiveWeight: 0,
        attainment: component.attainment,
        contribution: 0,
      })),
    };
  }

  // Redistribusi proporsional: bobot dinormalisasi kembali ke total 100.
  const scale = 100 / usedWeight;
  let rawScore = 0;
  const breakdown: ScorecardBreakdownRow[] = components.map((component) => {
    const isIncluded =
      component.attainment !== null &&
      Number.isFinite(component.attainment) &&
      component.weight > 0;
    const effectiveWeight = isIncluded ? component.weight * scale : 0;
    const contribution = isIncluded
      ? effectiveWeight * (component.attainment as number)
      : 0;
    rawScore += contribution;
    return {
      code: component.code,
      weight: component.weight,
      effectiveWeight: round2(effectiveWeight),
      attainment: component.attainment,
      contribution: round2(contribution),
    };
  });

  return {
    score: round2(Math.min(100, rawScore)),
    rawScore: round2(rawScore),
    usedWeight: round2(usedWeight),
    excluded,
    breakdown,
  };
}
