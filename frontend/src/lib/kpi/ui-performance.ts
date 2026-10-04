/** Logika tampilan Performance Review & KPI berjalan (tanpa React). */

/** pg numeric (string) → angka; null bila kosong/tidak valid. */
export function toScore(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Warna teks nilai: ≥90 hijau, ≥75 biru, ≥60 kuning, sisanya merah. */
export function scoreToneClass(value: number | null): string {
  if (value === null) return "text-gray-400";
  if (value >= 90) return "text-emerald-600";
  if (value >= 75) return "text-blue-600";
  if (value >= 60) return "text-amber-600";
  return "text-red-600";
}

/** Nilai tampilan; 0 dianggap "belum dinilai" bila `zeroAsEmpty`. */
export function formatScore(value: number | null, digits: number, zeroAsEmpty = false): string {
  if (value === null || (zeroAsEmpty && value === 0)) return "—";
  return value.toFixed(digits);
}

export function categoryClass(category: string): string {
  if (category === "Istimewa") return "bg-emerald-100 text-emerald-700";
  if (category === "Baik") return "bg-blue-100 text-blue-700";
  if (category === "Cukup") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

/** Kuartal berjalan (1-4) dari bulan 0-based. */
export function quarterOf(monthIndex: number): number {
  return Math.floor(monthIndex / 3) + 1;
}

type Numeric = number | string | null | undefined;

export interface QuarterSummary {
  quarter?: number;
  year?: number;
  monthScores: { month: number; score: number | null }[];
  avg: number | null;
}

/** Ringkas KPI kuartal berjalan milik sendiri (fallback: baris pertama). */
export function summarizeMyQuarter(data: {
  employees: { id: string; avg_score: Numeric; months: { month: number; score: Numeric }[] | null }[];
  months: number[];
  year?: number;
  quarter?: number;
  my_employee_id?: string | null;
}): QuarterSummary {
  const mine = data.employees.find((e) => e.id === data.my_employee_id) ?? data.employees[0];
  return {
    quarter: data.quarter,
    year: data.year,
    monthScores: data.months.map((month) => ({
      month,
      score: toScore((mine?.months ?? []).find((row) => row.month === month)?.score),
    })),
    avg: toScore(mine?.avg_score),
  };
}

/** Siklus yang mencakup hari ini, atau yang terbaru. */
export function pickCurrentCycle<T extends { start_date: string; end_date: string }>(
  cycles: readonly T[],
  todayIso: string
): T | undefined {
  return cycles.find((c) => c.start_date <= todayIso && todayIso <= c.end_date) ?? cycles[0];
}

export interface MyReviewSummary {
  cycleName: string;
  grand: number | null;
  category: string | null;
  status: string;
  selfDone: boolean;
  signed: boolean;
}

/** Review milik sendiri pada siklus; null bila tidak ada. Nilai 0 = belum dinilai. */
export function summarizeMyReview(
  cycleName: string,
  data: {
    my_employee_id?: string | null;
    reviews: {
      employee_id: string;
      status: string;
      category: string | null;
      grand_total_score: Numeric;
      self_done?: boolean;
      employee_sign_date: string | null;
    }[];
  }
): MyReviewSummary | null {
  const mine = data.reviews.find((r) => r.employee_id === data.my_employee_id);
  if (!mine) return null;
  const grand = toScore(mine.grand_total_score);
  return {
    cycleName,
    grand: grand === 0 ? null : grand,
    category: mine.category,
    status: mine.status,
    selfDone: Boolean(mine.self_done),
    signed: mine.employee_sign_date !== null,
  };
}

/** Jumlah tugas hari ini yang masih pending. */
export function countPendingToday(
  occurrences: readonly { occurrence_date: string; status: string }[],
  todayIso: string
): number {
  return occurrences.filter((o) => o.occurrence_date === todayIso && o.status === "pending").length;
}
