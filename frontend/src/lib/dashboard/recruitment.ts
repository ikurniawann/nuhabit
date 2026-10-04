/**
 * Agregasi murni untuk dashboard & analitik rekrutmen (kandidat per status,
 * sumber, brand, minggu). Route hanya mengambil baris lalu memanggil fungsi ini.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = ["hired", "rejected", "archived"];

export const SOURCE_LABELS: Record<string, string> = {
  portal: "Website Portal",
  referral: "Referral",
  jobstreet: "JobStreet",
  instagram: "Instagram",
  jobfair: "Job Fair",
  internal: "Internal",
  other: "Lainnya",
};

const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, "3month": 90, "6month": 180 };
const PERIOD_MONTHS: Record<string, number> = { month: 1, "3month": 3, "6month": 6 };

export function isActiveCandidate(status: string | null): boolean {
  return !CLOSED_STATUSES.includes(status ?? "");
}

/** Awal periode dalam hari tetap (week=7, month=30, 3month=90, 6month=180). */
export function periodStartByDays(period: string, now: Date, fallbackDays: number): Date {
  return new Date(now.getTime() - (PERIOD_DAYS[period] ?? fallbackDays) * DAY_MS);
}

/** Awal periode per bulan kalender (week = 7 hari); default 3 bulan. */
export function periodStartByCalendar(period: string, now: Date): Date {
  const start = new Date(now);
  if (period === "week") start.setDate(now.getDate() - 7);
  else start.setMonth(now.getMonth() - (PERIOD_MONTHS[period] ?? 3));
  return start;
}

/** Jumlah kandidat per sumber berlabel, terbesar dulu (pie chart dashboard). */
export function sourceDistribution(rows: Array<{ source: string | null }>) {
  const counts = new Map<string, number>();
  for (const { source } of rows) {
    if (source) counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts]
    .map(([source, value]) => ({ name: SOURCE_LABELS[source] || source, value }))
    .sort((a, b) => b.value - a.value);
}

/** Total + hired + rate (%, 1 desimal) per sumber yang dikenal. */
export function sourceConversion(rows: Array<{ source: string | null; status: string | null }>) {
  return Object.keys(SOURCE_LABELS)
    .map((source) => {
      const matching = rows.filter((row) => row.source === source);
      const hired = matching.filter((row) => row.status === "hired").length;
      const total = matching.length;
      return {
        source: SOURCE_LABELS[source],
        total,
        hired,
        rate: total > 0 ? Math.round((hired / total) * 1000) / 10 : 0,
      };
    })
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Perbandingan brand aktif: pelamar, aktif, hired, talent pool; pie = hired. */
export function brandComparison(
  brands: Array<{ id: string; name: string }>,
  rows: Array<{ brand_id: string | null; status: string | null }>,
  brandFilter: string | null
) {
  const barData = brands
    .filter((brand) => !brandFilter || brand.id === brandFilter)
    .map((brand) => {
      const mine = rows.filter((row) => row.brand_id === brand.id);
      return {
        brand: brand.name,
        applicants: mine.length,
        active: mine.filter((row) => isActiveCandidate(row.status)).length,
        hired: mine.filter((row) => row.status === "hired").length,
        in_pool: mine.filter((row) => row.status === "talent_pool").length,
      };
    })
    .filter((item) => item.applicants > 0);
  return { barData, pieData: barData.map((item) => ({ name: item.brand, value: item.hired })) };
}

const FUNNEL_STAGES: Array<[string, string]> = [
  ["applied", "Applied"],
  ["screening", "Screening"],
  ["psikotes", "Psikotes"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["hired", "Hired"],
  ["talent_pool", "Talent Pool"],
];

const OVERVIEW_STAGES: Array<[string, string]> = [...FUNNEL_STAGES, ["rejected", "Tolak"], ["archived", "Archived"]];

function countStatuses(rows: Array<{ status: string | null }>) {
  const counts = new Map<string, number>();
  for (const { status } of rows) {
    if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

/** Jumlah kandidat per tahap funnel. */
export function funnelStages(rows: Array<{ status: string | null }>) {
  const counts = countStatuses(rows);
  return FUNNEL_STAGES.map(([status, stage]) => ({ stage, count: counts.get(status) ?? 0 }));
}

export interface OverviewCandidate {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  position_id: string | null;
}

/** KPI analitik + jumlah kandidat aktif per posisi (untuk "sulit diisi"). */
export function overviewKpis(candidates: OverviewCandidate[]) {
  const total = candidates.length;
  const hired = candidates.filter((c) => c.status === "hired");
  const counts = countStatuses(candidates);
  const hiringRate = total > 0 ? (hired.length / total) * 100 : 0;

  const totalDays = hired.reduce(
    (sum, c) => sum + Math.floor((new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / DAY_MS),
    0
  );

  const activePerPosition = new Map<string, number>();
  for (const c of candidates) {
    if (c.position_id && isActiveCandidate(c.status)) {
      activePerPosition.set(c.position_id, (activePerPosition.get(c.position_id) ?? 0) + 1);
    }
  }

  return {
    kpis: {
      time_to_hire_avg: hired.length > 0 ? Math.round(totalDays / hired.length) : null,
      hiring_rate: Math.round(hiringRate * 100) / 100,
      total_applicants: total,
      total_hired: hired.length,
      total_rejected: counts.get("rejected") ?? 0,
      total_active: candidates.filter((c) => isActiveCandidate(c.status)).length,
      conversion_rates: OVERVIEW_STAGES.map(([status, stage]) => ({
        stage,
        rate: total > 0 ? Math.round(((counts.get(status) ?? 0) / total) * 100) : 0,
      })),
    },
    activePerPosition,
  };
}

/** 10 posisi dengan kandidat aktif terbanyak. */
export function hardToFill(activePerPosition: Map<string, number>, positions: Array<{ id: string; title: string }>) {
  return [...activePerPosition]
    .map(([positionId, count]) => ({
      position_id: positionId,
      position_title: positions.find((p) => p.id === positionId)?.title || "Unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 8 minggu terakhir (berakhir hari Minggu), terlama dulu, dengan label "Mon D". */
export function lastEightWeeks(today: Date) {
  const weeks: Array<{ label: string; start: Date; end: Date }> = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date(today);
    end.setDate(today.getDate() - today.getDay() - i * 7);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    weeks.push({ label: `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}`, start, end });
  }
  return weeks;
}

/** Jumlah lamaran per minggu untuk grafik mingguan. */
export function weeklyApplications(weeks: ReturnType<typeof lastEightWeeks>, rows: Array<{ created_at: string }>) {
  return weeks.map((week, index) => ({
    week: `Week ${index + 1}`,
    date: week.start.toISOString().split("T")[0],
    label: week.label,
    count: rows.filter((row) => {
      const createdAt = new Date(row.created_at);
      return createdAt >= week.start && createdAt <= week.end;
    }).length,
  }));
}

export interface StaleCandidateRow {
  id: string;
  full_name: string;
  status: string;
  updated_at: string;
  positions: { title: string | null } | null;
  brands: { name: string | null } | null;
}

/** Kandidat yang lama tidak bergerak; merah bila lebih dari 14 hari. */
export function attentionItem(row: StaleCandidateRow, now: number) {
  const days = Math.floor((now - new Date(row.updated_at).getTime()) / DAY_MS);
  return {
    id: row.id,
    full_name: row.full_name,
    status: row.status,
    position_title: row.positions?.title ?? null,
    brand_name: row.brands?.name ?? null,
    days_in_current_status: days,
    urgency: days > 14 ? "red" : "amber",
  } as const;
}
