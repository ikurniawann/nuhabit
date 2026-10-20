/** Rentang tanggal, cabang dan tab laporan gym di URL. Tanggal adalah hari kalender (YYYY-MM-DD, inklusif) di zona cabang filter, atau WIB untuk semua cabang. */

export const REPORT_TABS = [
  { value: "kehadiran", label: "Kehadiran" },
  { value: "okupansi", label: "Okupansi" },
  { value: "pendapatan", label: "Pendapatan" },
  { value: "member", label: "Member" },
  { value: "coach", label: "Coach" },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]["value"];

export const RANGE_PRESETS = [
  { value: "7d", label: "7 hari terakhir" },
  { value: "30d", label: "30 hari terakhir" },
  { value: "90d", label: "90 hari terakhir" },
  { value: "this_month", label: "Bulan ini" },
  { value: "last_month", label: "Bulan lalu" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export interface ReportParams {
  from: string;
  to: string;
  branch_id: string;
  tab: ReportTab;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Hari ini di WIB sebagai YYYY-MM-DD. */
export function wibToday(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Geser hari kalender YYYY-MM-DD sebanyak n hari. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Rentang preset yang berakhir di today (atau di akhir bulan lalu). */
export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "this_month":
      return { from: monthStart, to: today };
    case "last_month": {
      const to = addDays(monthStart, -1);
      return { from: `${to.slice(0, 8)}01`, to };
    }
    default:
      return { from: addDays(today, -29), to: today };
  }
}

/** Preset yang cocok dengan rentang, bila ada. */
export function matchPreset(from: string, to: string, today: string): RangePreset | null {
  return RANGE_PRESETS.find((p) => {
    const r = presetRange(p.value, today);
    return r.from === from && r.to === to;
  })?.value ?? null;
}

/** Baca parameter laporan; rentang kosong atau rusak menjadi 30 hari terakhir. */
export function parseReportParams(search: URLSearchParams, today: string): ReportParams {
  const fallback = presetRange("30d", today);
  let from = search.get("from") ?? "";
  let to = search.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) ({ from, to } = fallback);
  const tab = search.get("tab");
  return {
    from,
    to,
    branch_id: search.get("branch_id") ?? "",
    tab: REPORT_TABS.some((t) => t.value === tab) ? (tab as ReportTab) : "kehadiran",
  };
}

/** Query string halaman; nilai default tidak ditulis. */
export function reportParamsToSearch(params: ReportParams, today: string): string {
  const out = new URLSearchParams();
  const fallback = presetRange("30d", today);
  if (params.from !== fallback.from || params.to !== fallback.to) {
    out.set("from", params.from);
    out.set("to", params.to);
  }
  if (params.branch_id) out.set("branch_id", params.branch_id);
  if (params.tab !== "kehadiran") out.set("tab", params.tab);
  return out.toString();
}

/** Query string API: rentang dan cabang. */
export function reportApiQuery(params: ReportParams): string {
  const out = new URLSearchParams({ from: params.from, to: params.to });
  if (params.branch_id) out.set("branch_id", params.branch_id);
  return out.toString();
}
