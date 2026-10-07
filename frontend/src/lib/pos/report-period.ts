/**
 * Pintasan periode laporan (Desktop → Drive → Reports, owner 2026-09-05):
 * Hari ini / Minggu ini / Bulan ini / Tahun ini, dihitung dalam WIB.
 * "Sampai" selalu hari ini (bukan akhir periode) karena data masa depan kosong.
 */

export const REPORT_PERIOD_SHORTCUTS = ["today", "week", "month", "year"] as const;
export type ReportPeriodShortcut = (typeof REPORT_PERIOD_SHORTCUTS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriodShortcut, string> = {
  today: "Hari ini",
  week: "Minggu ini",
  month: "Bulan ini",
  year: "Tahun ini",
};

const WIB_OFFSET_MS = 7 * 3_600_000;

/** Tanggal WIB (YYYY-MM-DD) dari instan `now`. */
export function wibDateString(now: Date): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pure: rentang tanggal (WIB) untuk pintasan; minggu dimulai Senin. */
export function resolveReportPeriod(
  shortcut: ReportPeriodShortcut,
  now: Date = new Date()
): { date_from: string; date_to: string } {
  const today = wibDateString(now);
  if (shortcut === "today") return { date_from: today, date_to: today };
  if (shortcut === "week") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Minggu
    const sinceMonday = (dow + 6) % 7;
    return { date_from: shiftDays(today, -sinceMonday), date_to: today };
  }
  if (shortcut === "month") return { date_from: `${today.slice(0, 7)}-01`, date_to: today };
  return { date_from: `${today.slice(0, 4)}-01-01`, date_to: today };
}

/** Pure: validasi rentang manual; balik pesan error bila tidak valid. */
export function validateReportRange(from: string, to: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return "Format tanggal harus YYYY-MM-DD";
  if (from > to) return "Tanggal dari tidak boleh melebihi tanggal sampai";
  return null;
}

/** Label periode untuk judul sheet, mis. "1 Sep 2026 s.d. 5 Sep 2026". */
export function formatPeriodLabel(from: string, to: string): string {
  const f = (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString("id-ID", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
  return from === to ? f(from) : `${f(from)} s.d. ${f(to)}`;
}
