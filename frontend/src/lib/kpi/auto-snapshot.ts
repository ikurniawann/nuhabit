import { getPool } from "@/lib/db";
import { runKpiSnapshot } from "./snapshot";

/**
 * Auto-snapshot KPI bulanan (EPIC-010 Fase E) — self-healing, tanpa
 * dependency cron: dipanggil berkala dari instrumentation.ts. Bila bulan
 * LALU belum punya scorecard sama sekali (padahal ada karyawan aktif),
 * snapshot dijalankan otomatis. Server mati tanggal 1? Tertangkap pada
 * pengecekan berikutnya. Idempoten — aman dipanggil berulang.
 */

export const AUTO_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam

/** Periode bulan lalu dlm WIB (bukan UTC) agar pergantian bulan akurat. */
export function previousPeriodWib(now: Date = new Date()): {
  periodYear: number;
  periodMonth: number;
} {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  let year = wib.getUTCFullYear();
  let month = wib.getUTCMonth(); // 0-11 → bulan lalu dlm 1-12
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  return { periodYear: year, periodMonth: month };
}

export async function ensurePreviousMonthSnapshot(): Promise<
  "ran" | "already_exists" | "no_employees"
> {
  const pool = getPool();
  const { periodYear, periodMonth } = previousPeriodWib();

  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM performance.kpi_scorecards
        WHERE period_year = $1 AND period_month = $2)::int AS scorecards,
       (SELECT count(*) FROM hris.employees WHERE is_active)::int AS employees`,
    [periodYear, periodMonth]
  );
  const { scorecards, employees } = rows[0];
  if (employees === 0) return "no_employees";
  if (scorecards > 0) return "already_exists";

  const summary = await runKpiSnapshot({ periodYear, periodMonth });
  console.log(
    `[kpi-auto-snapshot] ${periodMonth}/${periodYear}: ` +
      `${summary.scorecards_upserted} scorecard dibuat otomatis`
  );
  return "ran";
}

let started = false;

/** Daftarkan pengecekan berkala — sekali per proses server. */
export function startKpiAutoSnapshot(): void {
  if (started) return;
  started = true;

  const tick = () => {
    ensurePreviousMonthSnapshot().catch((error) => {
      console.error("[kpi-auto-snapshot] gagal:", error);
    });
  };
  // Cek saat boot (delay kecil agar pool & app siap) lalu tiap interval.
  setTimeout(tick, 30_000);
  setInterval(tick, AUTO_SNAPSHOT_INTERVAL_MS);
}
