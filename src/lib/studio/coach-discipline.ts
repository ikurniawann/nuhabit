/**
 * Disiplin coach (EPIC-067 T-067-A8). Logika murni — query di
 * coach-discipline-server.ts. Keputusan client no. 3: pelanggaran tercatat di
 * KPI, memotong porsi komisi per kejadian, dan memicu usulan SP setelah N
 * kejadian dalam satu periode — semua angka bisa diatur.
 */

export const INCIDENT_KINDS = ["no_show", "short_notice_leave", "late"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_KIND_LABEL: Record<IncidentKind, string> = {
  no_show: "Tidak hadir tanpa kabar",
  short_notice_leave: "Cuti mendadak",
  late: "Terlambat",
};

export interface DisciplineRules {
  /** Potongan komisi per kejadian (% dari komisi kotor bulan kejadian). */
  deduction_percent: Record<IncidentKind, number>;
  /** Batas total potongan per coach per bulan. */
  max_deduction_percent: number;
  /** Jumlah kejadian aktif dalam jendela hari yang memicu usulan SP berikutnya. */
  warning_threshold: number;
  warning_window_days: number;
}

/** Default usulan — dikonfirmasi ke client, bisa diubah di pengaturan. */
export const DEFAULT_DISCIPLINE_RULES: DisciplineRules = {
  deduction_percent: { no_show: 15, short_notice_leave: 5, late: 5 },
  max_deduction_percent: 50,
  warning_threshold: 3,
  warning_window_days: 90,
};

export const DISCIPLINE_SETTING_KEY = "discipline_rules";

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : fallback;

export function normalizeDisciplineRules(raw: unknown): DisciplineRules {
  const o = raw && typeof raw === "object" ? (raw as Partial<Record<keyof DisciplineRules, unknown>>) : {};
  const d = DEFAULT_DISCIPLINE_RULES;
  const ded = (o.deduction_percent && typeof o.deduction_percent === "object" ? o.deduction_percent : {}) as Record<string, unknown>;
  const deduction_percent = {} as Record<IncidentKind, number>;
  for (const k of INCIDENT_KINDS) deduction_percent[k] = clampInt(ded[k], 0, 100, d.deduction_percent[k]);
  return {
    deduction_percent,
    max_deduction_percent: clampInt(o.max_deduction_percent, 0, 100, d.max_deduction_percent),
    warning_threshold: clampInt(o.warning_threshold, 1, 20, d.warning_threshold),
    warning_window_days: clampInt(o.warning_window_days, 7, 365, d.warning_window_days),
  };
}

/** Total potongan bulan itu: jumlah persentase kejadian aktif, dibatasi maksimum. */
export function monthDeductionPercent(incidents: { deduction_percent: number }[], max: number): number {
  const sum = incidents.reduce((s, i) => s + Number(i.deduction_percent), 0);
  return Math.min(max, Math.round(sum * 100) / 100);
}

/** Terapkan potongan ke komisi kotor (rupiah, dibulatkan ke sen). */
export function applyDeduction(gross: number, percent: number): { gross_amount: number; deduction_percent: number; deduction_amount: number; amount: number } {
  const pct = Math.min(100, Math.max(0, percent));
  const grossCents = Math.round(gross * 100);
  const deductionCents = Math.round((grossCents * pct) / 100);
  return { gross_amount: grossCents / 100, deduction_percent: pct, deduction_amount: deductionCents / 100, amount: (grossCents - deductionCents) / 100 };
}

/**
 * Usulan SP: kejadian aktif dalam jendela yang belum masuk SP yang sudah
 * diterbitkan/diusulkan mencapai ambang → usulkan level berikutnya (maks SP3).
 */
export function warningProposal(input: {
  incidents: { id: string; occurred_on: string }[];
  coveredIncidentIds: Set<string>;
  lastIssuedLevel: number;
  hasOpenProposal: boolean;
  threshold: number;
}): { level: number; incident_ids: string[] } | null {
  if (input.hasOpenProposal) return null;
  const fresh = input.incidents.filter((i) => !input.coveredIncidentIds.has(i.id));
  if (fresh.length < input.threshold) return null;
  return { level: Math.min(3, input.lastIssuedLevel + 1), incident_ids: fresh.map((i) => i.id) };
}

export function warningLabel(level: number): string {
  return `SP${level}`;
}
