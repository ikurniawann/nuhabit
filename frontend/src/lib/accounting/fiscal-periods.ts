import type { FiscalPeriodStatus } from "@/lib/accounting/fiscal-types";

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export type GeneratedPeriod = {
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
};

/** Generate up to 12 monthly periods from fiscal year start/end. */
export function generateMonthlyPeriods(
  startDate: string,
  endDate: string
): GeneratedPeriod[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Tanggal fiscal tidak valid");
  }
  if (end < start) throw new Error("end_date harus >= start_date");

  const periods: GeneratedPeriod[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  for (let i = 1; i <= 12; i++) {
    const periodStart =
      i === 1
        ? start
        : new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(
      periodStart.getFullYear(),
      periodStart.getMonth() + 1,
      0
    );
    const periodEnd = monthEnd > end ? end : monthEnd;
    if (periodStart > end) break;

    const monthIdx = periodStart.getMonth();
    periods.push({
      period_no: i,
      name: `${MONTH_NAMES[monthIdx]} ${periodStart.getFullYear()}`,
      start_date: formatDateOnly(periodStart),
      end_date: formatDateOnly(periodEnd),
      // Hanya period pertama OPEN; sisanya CLOSED sampai period sebelumnya ditutup
      status: i === 1 ? "OPEN" : "CLOSED",
    });

    cursor = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
    if (periodEnd >= end) break;
  }

  return periods;
}

/**
 * Period N hanya boleh OPEN jika semua period sebelumnya sudah CLOSED.
 * Return pesan pelanggaran pertama, atau null jika urutan valid.
 */
export function findOpenSequenceViolation(
  periods: Array<{ period_no: number; name?: string; status: string }>
): string | null {
  const sorted = [...periods].sort((a, b) => a.period_no - b.period_no);
  for (const period of sorted) {
    if (period.status !== "OPEN") continue;
    const blockers = sorted.filter(
      (p) => p.period_no < period.period_no && p.status === "OPEN"
    );
    if (blockers.length > 0) {
      const prev = blockers[blockers.length - 1];
      return `Tidak bisa OPEN period ${period.period_no}: period ${prev.period_no}${
        prev.name ? ` (${prev.name})` : ""
      } belum CLOSED. Tutup period sebelumnya terlebih dahulu.`;
    }
  }
  return null;
}

/**
 * Cek apakah period boleh di-toggle ke OPEN dari state form saat ini.
 * Return pesan error atau null jika boleh.
 */
export function getOpenPeriodBlockReason(
  periods: Array<{ period_no: number; name?: string; status: string }>,
  targetPeriodNo: number
): string | null {
  const prevOpen = periods
    .filter((p) => p.period_no < targetPeriodNo && p.status === "OPEN")
    .sort((a, b) => b.period_no - a.period_no)[0];
  if (!prevOpen) return null;
  return `Tutup period ${prevOpen.period_no}${
    prevOpen.name ? ` (${prevOpen.name})` : ""
  } terlebih dahulu sebelum OPEN period ${targetPeriodNo}.`;
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
