/** Nama bulan Indonesia untuk label periode (payroll, KPI, ESS). */
export const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

/** Singkatan 1-based: MONTH_SHORT_ID[10] = "Okt"; indeks 0 kosong. */
export const MONTH_SHORT_ID = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** 1-12 → "Oktober"; di luar rentang → "". */
export function monthName(month: number | null | undefined): string {
  return (month && MONTH_NAMES_ID[month - 1]) || "";
}

/** (10, 2026) → "Oktober 2026". */
export function monthYearLabel(month: number | null | undefined, year: number | null | undefined): string {
  return [monthName(month), year ?? ""].filter(Boolean).join(" ");
}
