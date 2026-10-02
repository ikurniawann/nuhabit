/**
 * Logika murni Komisi Coach (EPIC-056) — tanpa DB supaya mudah diuji.
 * Uang dihitung dalam sen supaya pembagian tidak menumpuk selisih pembulatan.
 */

export interface CommissionSettings {
  class_pool_percent: number;
  pt_pool_percent: number;
  share_head_coach: number;
  share_coach: number;
}

/** Default dari Excel owner: 10% revenue kelas + 40% revenue Personal Training; Head Coach 20%, Coach 16%. */
export const DEFAULT_COMMISSION_SETTINGS: CommissionSettings = {
  class_pool_percent: 10,
  pt_pool_percent: 40,
  share_head_coach: 20,
  share_coach: 16,
};

export const COMMISSION_STATUS_LABEL = { draft: "Draft", approved: "Disetujui", paid: "Dibayar" } as const;

export interface CommissionCoach {
  id: string;
  level: "coach" | "head_coach";
  /** Override persentase per coach (null = ikut peran). */
  commission_share_percent: number | null;
}

export interface CommissionResult {
  class_pool: number;
  pt_pool: number;
  total_pool: number;
  allocated_percent: number;
  allocated_amount: number;
  /** Sisa pool yang tidak dialokasikan → revenue perusahaan (opsi B). */
  retained_amount: number;
  over_allocated: boolean;
  lines: { coach_id: string; share_percent: number; amount: number }[];
}

const cents = (v: number) => Math.round(v * 100);
const rupiah = (c: number) => c / 100;

export function shareFor(coach: CommissionCoach, settings: CommissionSettings): number {
  if (coach.commission_share_percent !== null && coach.commission_share_percent !== undefined) return Number(coach.commission_share_percent);
  return coach.level === "head_coach" ? settings.share_head_coach : settings.share_coach;
}

/**
 * Hitung pool & pembagian. Opsi B (keputusan owner): persentase per orang
 * tetap; total < 100% → sisa = revenue perusahaan; total > 100% → ditandai
 * over_allocated (approve diblokir), nominal tetap dihitung apa adanya untuk pratinjau.
 */
export function computeCommission(input: {
  classRevenue: number;
  ptRevenue: number;
  settings: CommissionSettings;
  coaches: CommissionCoach[];
}): CommissionResult {
  const classPool = Math.round((cents(input.classRevenue) * input.settings.class_pool_percent) / 100);
  const ptPool = Math.round((cents(input.ptRevenue) * input.settings.pt_pool_percent) / 100);
  const total = classPool + ptPool;
  const lines = input.coaches.map((c) => {
    const share = shareFor(c, input.settings);
    return { coach_id: c.id, share_percent: share, amount: rupiah(Math.round((total * share) / 100)) };
  });
  const allocatedPercent = Math.round(lines.reduce((s, l) => s + l.share_percent, 0) * 100) / 100;
  const allocated = lines.reduce((s, l) => s + cents(l.amount), 0);
  return {
    class_pool: rupiah(classPool),
    pt_pool: rupiah(ptPool),
    total_pool: rupiah(total),
    allocated_percent: allocatedPercent,
    allocated_amount: rupiah(allocated),
    retained_amount: rupiah(Math.max(total - allocated, 0)),
    over_allocated: allocatedPercent > 100,
    lines,
  };
}

/** "2026-10" ↔ tanggal 1 bulan. */
export function periodToDate(period: string): string {
  return `${period}-01`;
}

export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

export function periodLabel(period: string): string {
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${months[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
