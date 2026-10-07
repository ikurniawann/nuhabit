import type { Pool } from "pg";
import { dateColToIso, eachDateOfPeriod } from "@/lib/payroll/period";
import {
  resolveShiftForDate,
  type EmployeeShiftRow,
} from "@/lib/hris/shifts";
import { safeRatio } from "./collect-math";
import { computeTeamOntime, scheduledMinutesForShift, type ShiftDuration } from "./wave2-math";
import type { CollectorMap, CollectorValue, KpiEmployee } from "./collectors";

/**
 * Kolektor gelombang 2 (EPIC-010 Fase D). Dua bentuk:
 * - per-karyawan → CollectorMap;
 * - level-organisasi (leave_sla, vendor_*, payroll_*) → satu CollectorValue
 *   yang dibagikan ke semua karyawan yang role-nya memuat indikator tsb.
 */

// ============================================================
// team_ontime — rata-rata on-time anggota department (utk pos_supervisor);
// nilai per department dibagikan ke karyawan dept tsb.
// ============================================================
export function collectTeamOntime(
  employees: KpiEmployee[],
  attOntime: CollectorMap
): CollectorMap {
  const ontimeByEmployee = new Map<string, number>();
  for (const [employeeId, value] of attOntime) {
    if (value.actual !== null) ontimeByEmployee.set(employeeId, value.actual);
  }
  const byDepartment = computeTeamOntime(employees, ontimeByEmployee);

  const result: CollectorMap = new Map();
  for (const employee of employees) {
    if (!employee.department_id) continue;
    const dept = byDepartment.get(employee.department_id);
    if (!dept) continue;
    result.set(employee.id, {
      actual: dept.actual,
      sampleSize: dept.sampleSize,
      sourceDetail: { department_id: employee.department_id, ...(dept.sourceDetail as object) },
    });
  }
  return result;
}

// ============================================================
// pos_sales_shift — rata-rata total_sales per shift TUTUP milik kasir
// ============================================================
export async function collectPosSalesShift(
  pool: Pool,
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id,
            AVG(COALESCE(s.total_sales, 0))::float AS avg_sales,
            COUNT(*)::int AS shift_count
     FROM pos.pos_shifts s
     JOIN hris.employees e ON e.user_id = s.cashier_id
     WHERE s.closed_at IS NOT NULL
       AND s.closed_at >= $1::date AND s.closed_at < ($2::date + 1)
     GROUP BY e.id`,
    [startIso, endIso]
  );
  const result: CollectorMap = new Map();
  for (const row of rows) {
    result.set(row.employee_id, {
      actual: row.avg_sales,
      sampleSize: row.shift_count,
      sourceDetail: { avg_sales: row.avg_sales, shift_count: row.shift_count },
    });
  }
  return result;
}

// ============================================================
// leave_request_discipline — pengajuan sebelum H (bukan susulan) / total,
// utk cuti non-cancelled yang MULAI dalam periode
// ============================================================
export async function collectLeaveDiscipline(
  pool: Pool,
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const { rows } = await pool.query(
    `SELECT employee_id,
            COUNT(*) FILTER (WHERE created_at::date <= start_date)::int AS ontime_requests,
            COUNT(*)::int AS total_requests
     FROM hris.leaves
     WHERE start_date BETWEEN $1 AND $2 AND status <> 'cancelled'
     GROUP BY employee_id`,
    [startIso, endIso]
  );
  const result: CollectorMap = new Map();
  for (const row of rows) {
    result.set(row.employee_id, {
      actual: safeRatio(row.ontime_requests, row.total_requests),
      sampleSize: row.total_requests,
      sourceDetail: {
        ontime_requests: row.ontime_requests,
        total_requests: row.total_requests,
      },
    });
  }
  return result;
}

// ============================================================
// att_late_ratio — Σ menit telat / Σ menit kerja terjadwal
// ============================================================
export async function collectAttLateRatio(
  pool: Pool,
  employees: KpiEmployee[],
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const [scheduleRes, shiftsRes, lateRes] = await Promise.all([
    pool.query(
      `SELECT employee_id, day_of_week, shift_id, effective_from, effective_to
       FROM hris.employee_shifts
       WHERE effective_from <= $2
         AND (effective_to IS NULL OR effective_to >= $1)`,
      [startIso, endIso]
    ),
    pool.query(
      `SELECT id, start_time, end_time, break_minutes, is_overnight
       FROM hris.shifts`
    ),
    pool.query(
      `SELECT employee_id, SUM(COALESCE(late_minutes, 0))::float AS late_minutes
       FROM hris.attendance
       WHERE date BETWEEN $1 AND $2 AND status = 'present'
       GROUP BY employee_id`,
      [startIso, endIso]
    ),
  ]);

  const shiftInfo = new Map<string, ShiftDuration>(
    shiftsRes.rows.map((row) => [row.id, row])
  );
  const schedules = new Map<string, EmployeeShiftRow[]>();
  for (const row of scheduleRes.rows) {
    const list = schedules.get(row.employee_id) ?? [];
    list.push({
      day_of_week: row.day_of_week,
      shift_id: row.shift_id,
      effective_from: dateColToIso(row.effective_from) ?? "",
      effective_to: dateColToIso(row.effective_to),
    });
    schedules.set(row.employee_id, list);
  }
  const lateByEmployee = new Map<string, number>(
    lateRes.rows.map((row) => [row.employee_id, row.late_minutes])
  );

  const result: CollectorMap = new Map();
  for (const employee of employees) {
    const scheduleRows = schedules.get(employee.id) ?? [];
    if (scheduleRows.length === 0) continue; // tanpa jadwal → tak terukur

    let scheduledMinutes = 0;
    let scheduledDays = 0;
    for (const dateIso of eachDateOfPeriod(startIso, endIso)) {
      const row = resolveShiftForDate(scheduleRows, dateIso);
      if (!row || !row.shift_id) continue;
      const shift = shiftInfo.get(row.shift_id);
      if (!shift) continue;
      scheduledMinutes += scheduledMinutesForShift(shift);
      scheduledDays += 1;
    }

    const lateMinutes = lateByEmployee.get(employee.id) ?? 0;
    result.set(employee.id, {
      actual: safeRatio(lateMinutes, scheduledMinutes),
      sampleSize: scheduledDays,
      sourceDetail: {
        late_minutes: lateMinutes,
        scheduled_minutes: scheduledMinutes,
        scheduled_days: scheduledDays,
      },
    });
  }
  return result;
}

// ============================================================
// Level organisasi — satu nilai dibagikan ke pemegang indikator via role
// ============================================================

/** leave_sla — rata-rata hari pengajuan → keputusan utk cuti diputus dlm periode */
export async function collectLeaveSla(
  pool: Pool,
  startIso: string,
  endIso: string
): Promise<CollectorValue | null> {
  const { rows } = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (approved_at - created_at)) / 86400)::float AS avg_days,
            COUNT(*)::int AS decided
     FROM hris.leaves
     WHERE approved_at IS NOT NULL
       AND approved_at >= $1::date AND approved_at < ($2::date + 1)`,
    [startIso, endIso]
  );
  const row = rows[0];
  if (!row || !row.decided) return null;
  return {
    actual: row.avg_days,
    sampleSize: row.decided,
    sourceDetail: { avg_days: row.avg_days, decided: row.decided },
  };
}

/**
 * Tanggal LUNAS SEJATI per termin: tanggal pembayaran saat kumulatif
 * pertama kali mencapai amount — koreksi/pembayaran ekstra SETELAH lunas
 * tidak menggeser tanggal. Hanya pembayaran status 'posted' yang dihitung
 * (pola resmi di route payments purchasing; draft/void diabaikan).
 */
const SETTLED_TERMS_CTE = `
  cum_pay AS (
    SELECT t.id AS term_id, t.due_date, t.amount, t.created_at,
           vp.payment_date,
           SUM(vp.amount) OVER (
             PARTITION BY t.id ORDER BY vp.payment_date, vp.id
           ) AS cum
    FROM purchasing.purchase_order_payment_terms t
    JOIN purchasing.vendor_payments vp
      ON vp.payment_term_id = t.id AND vp.status = 'posted'
    WHERE t.is_active
  ),
  settled AS (
    SELECT term_id, due_date, amount, created_at,
           MIN(payment_date) AS settled_date
    FROM cum_pay
    WHERE cum >= amount
    GROUP BY term_id, due_date, amount, created_at
  )`;

/** vendor_pay_ontime — termin jatuh tempo dlm periode yang lunas tepat waktu */
export async function collectVendorPayOntime(
  pool: Pool,
  startIso: string,
  endIso: string
): Promise<CollectorValue | null> {
  const { rows } = await pool.query(
    `WITH ${SETTLED_TERMS_CTE}
     SELECT COUNT(*) FILTER (
              WHERE s.settled_date IS NOT NULL AND s.settled_date <= t.due_date
            )::int AS ontime,
            COUNT(*)::int AS total
     FROM purchasing.purchase_order_payment_terms t
     LEFT JOIN settled s ON s.term_id = t.id
     WHERE t.due_date BETWEEN $1 AND $2 AND t.is_active`,
    [startIso, endIso]
  );
  const row = rows[0];
  if (!row || !row.total) return null;
  return {
    actual: safeRatio(row.ontime, row.total),
    sampleSize: row.total,
    sourceDetail: { ontime_terms: row.ontime, total_terms: row.total },
  };
}

/** vendor_pay_sla — rata-rata hari termin dibuat → lunas (lunas dlm periode) */
export async function collectVendorPaySla(
  pool: Pool,
  startIso: string,
  endIso: string
): Promise<CollectorValue | null> {
  const { rows } = await pool.query(
    `WITH ${SETTLED_TERMS_CTE}
     SELECT AVG(EXTRACT(EPOCH FROM (settled_date::timestamp - created_at)) / 86400)::float AS avg_days,
            COUNT(*)::int AS settled
     FROM settled
     WHERE settled_date BETWEEN $1 AND $2`,
    [startIso, endIso]
  );
  const row = rows[0];
  if (!row || !row.settled) return null;
  return {
    actual: Math.max(0, row.avg_days ?? 0),
    sampleSize: row.settled,
    sourceDetail: { avg_days: row.avg_days, settled_terms: row.settled },
  };
}

/**
 * payroll_paid_ontime & payroll_ready_h2 — run payroll PERIODE snapshot vs
 * tanggal gajian (payroll_settings.payroll_day).
 */
export async function collectPayrollTimeliness(
  pool: Pool,
  periodYear: number,
  periodMonth: number
): Promise<{ paidOntime: CollectorValue | null; readyH2: CollectorValue | null }> {
  const [{ rows: settingRows }, { rows: runRows }] = await Promise.all([
    pool.query(`SELECT payroll_day FROM hris.payroll_settings LIMIT 1`),
    pool.query(
      `SELECT status, approved_at, paid_at FROM hris.payroll_runs
       WHERE period_year = $1 AND period_month = $2`,
      [periodYear, periodMonth]
    ),
  ]);
  const payrollDay = Number(settingRows[0]?.payroll_day) || 25;
  if (runRows.length === 0) return { paidOntime: null, readyH2: null };

  const lastDay = new Date(Date.UTC(periodYear, periodMonth, 0)).getUTCDate();
  const dayClamped = Math.min(payrollDay, lastDay);
  // Batas = akhir hari gajian WIB (UTC+7) → 16:59:59 UTC hari yang sama.
  // Jangan 23:59:59 UTC — itu 06:59 WIB esoknya (7 jam kelonggaran palsu).
  const WIB_OFFSET_HOURS = 7;
  const payday = new Date(
    Date.UTC(periodYear, periodMonth - 1, dayClamped, 23 - WIB_OFFSET_HOURS, 59, 59)
  );
  const readyDeadline = new Date(payday);
  readyDeadline.setUTCDate(readyDeadline.getUTCDate() - 2);

  let paidOntimeCount = 0;
  let readyCount = 0;
  for (const run of runRows) {
    if (run.paid_at && new Date(run.paid_at) <= payday) paidOntimeCount += 1;
    if (run.approved_at && new Date(run.approved_at) <= readyDeadline) readyCount += 1;
  }
  const total = runRows.length;
  const detail = { payroll_day: payrollDay, runs: total };
  return {
    paidOntime: {
      actual: safeRatio(paidOntimeCount, total),
      sampleSize: total,
      sourceDetail: { ...detail, paid_ontime: paidOntimeCount },
    },
    readyH2: {
      actual: safeRatio(readyCount, total),
      sampleSize: total,
      sourceDetail: { ...detail, ready_h2: readyCount },
    },
  };
}
