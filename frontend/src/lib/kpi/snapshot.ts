import { getPool } from "@/lib/db";
import { computeAttainment, type KpiDirection } from "./attainment";
import { composeScore, type ScorecardComponent } from "./scorecard";
import { resolveTarget, type KpiTargetRow } from "./targets";
import {
  collectAttOntime,
  collectLogbookCompliance,
  collectPoFulfillment,
  collectPosCashVariance,
  collectTaskCompletion,
  type CollectorMap,
  type CollectorValue,
  type KpiEmployee,
} from "./collectors";
import {
  collectAttLateRatio,
  collectLeaveDiscipline,
  collectLeaveSla,
  collectPayrollTimeliness,
  collectPosSalesShift,
  collectTeamOntime,
  collectVendorPayOntime,
  collectVendorPaySla,
} from "./collectors-wave2";

/**
 * Orkestrator snapshot KPI bulanan (EPIC-010 Fase B) — IDEMPOTEN:
 * re-run periode sama meng-upsert snapshot & scorecard draft; scorecard
 * berstatus 'final' TIDAK ditimpa (dilewati & dilaporkan).
 * Indikator di luar gelombang kolektor (mis. supervisor_rubric manual)
 * bernilai null → dikeluarkan composeScore (redistribusi bobot).
 */

/** Indikator ber-kolektor per-karyawan (gelombang 1 + 2) */
const EMPLOYEE_COLLECTOR_CODES = [
  "att_ontime",
  "pos_cash_variance",
  "logbook_compliance",
  "po_fulfillment",
  "team_ontime",
  "pos_sales_shift",
  "leave_request_discipline",
  "att_late_ratio",
  "task_completion",
] as const;

/** Indikator level-organisasi: satu nilai dibagikan ke pemegang indikator */
const ORG_COLLECTOR_CODES = [
  "leave_sla",
  "vendor_pay_ontime",
  "vendor_pay_sla",
  "payroll_paid_ontime",
  "payroll_ready_h2",
] as const;

export interface SnapshotSummary {
  period_year: number;
  period_month: number;
  employees: number;
  snapshots_upserted: number;
  scorecards_upserted: number;
  scorecards_skipped_final: number;
  collectors: Record<string, number>;
}

interface IndicatorRow {
  id: string;
  code: string;
  direction: KpiDirection;
  default_target: string | number | null;
  is_active: boolean;
}

function periodRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${lastDay}` };
}

const toNum = (value: string | number | null): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function runKpiSnapshot(input: {
  periodYear: number;
  periodMonth: number;
}): Promise<SnapshotSummary> {
  const pool = getPool();
  const { periodYear, periodMonth } = input;
  const { start, end } = periodRange(periodYear, periodMonth);

  // 1. Karyawan aktif + role akun tertaut (tanpa akun → 'employee')
  const employeesRes = await pool.query(
    `SELECT e.id, e.user_id, e.department_id, COALESCE(u.role, 'employee') AS role_code
     FROM hris.employees e
     LEFT JOIN configuration.users u ON u.id = e.user_id
     WHERE e.is_active = true`
  );
  const employees: KpiEmployee[] = employeesRes.rows;

  // 2. Katalog + bobot role + target
  const [indicatorsRes, roleWeightsRes, deptWeightsRes, targetsRes] = await Promise.all([
    pool.query(
      `SELECT id, code, direction, default_target, is_active
       FROM performance.kpi_indicators WHERE is_active = true`
    ),
    pool.query(
      `SELECT ri.role_code, ri.indicator_id, ri.weight::float AS weight, i.code
       FROM performance.kpi_role_indicators ri
       JOIN performance.kpi_indicators i ON i.id = ri.indicator_id
       WHERE i.is_active = true`
    ),
    pool.query(
      `SELECT di.department_id, di.indicator_id, di.weight::float AS weight, i.code
       FROM performance.kpi_department_indicators di
       JOIN performance.kpi_indicators i ON i.id = di.indicator_id
       WHERE i.is_active = true`
    ),
    pool.query(
      `SELECT indicator_id, period_year, period_month, role_code,
              department_id, employee_id, target::float AS target
       FROM performance.kpi_targets`
    ),
  ]);

  const indicatorsById = new Map<string, IndicatorRow>(
    indicatorsRes.rows.map((row: IndicatorRow) => [row.id, row])
  );
  const targetsByIndicator = new Map<string, KpiTargetRow[]>();
  for (const row of targetsRes.rows) {
    const list = targetsByIndicator.get(row.indicator_id) ?? [];
    list.push(row);
    targetsByIndicator.set(row.indicator_id, list);
  }
  const roleComponents = new Map<
    string,
    { code: string; indicatorId: string; weight: number }[]
  >();
  for (const row of roleWeightsRes.rows) {
    const list = roleComponents.get(row.role_code) ?? [];
    list.push({ code: row.code, indicatorId: row.indicator_id, weight: row.weight });
    roleComponents.set(row.role_code, list);
  }
  // Konfigurasi per DEPARTEMEN (owner 2026-08-31) — diutamakan; departemen
  // yang belum dikonfigurasi memakai pemetaan peran di atas sebagai bawaan.
  const deptComponents = new Map<
    string,
    { code: string; indicatorId: string; weight: number }[]
  >();
  for (const row of deptWeightsRes.rows) {
    const list = deptComponents.get(row.department_id) ?? [];
    list.push({ code: row.code, indicatorId: row.indicator_id, weight: row.weight });
    deptComponents.set(row.department_id, list);
  }

  // 3. Jalankan kolektor gelombang 1 + 2
  const [
    attOntime,
    cashVariance,
    logbook,
    poFulfillment,
    posSalesShift,
    leaveDiscipline,
    attLateRatio,
    taskCompletion,
    leaveSla,
    vendorPayOntime,
    vendorPaySla,
    payrollTimeliness,
  ] = await Promise.all([
    collectAttOntime(pool, employees, start, end),
    collectPosCashVariance(pool, start, end),
    collectLogbookCompliance(pool, employees, start, end),
    collectPoFulfillment(pool, start, end),
    collectPosSalesShift(pool, start, end),
    collectLeaveDiscipline(pool, start, end),
    collectAttLateRatio(pool, employees, start, end),
    collectTaskCompletion(pool, employees, start, end),
    collectLeaveSla(pool, start, end),
    collectVendorPayOntime(pool, start, end),
    collectVendorPaySla(pool, start, end),
    collectPayrollTimeliness(pool, periodYear, periodMonth),
  ]);
  // team_ontime diturunkan dari hasil att_ontime (tanpa query tambahan)
  const teamOntime = collectTeamOntime(employees, attOntime);

  const collected: Record<(typeof EMPLOYEE_COLLECTOR_CODES)[number], CollectorMap> = {
    att_ontime: attOntime,
    pos_cash_variance: cashVariance,
    logbook_compliance: logbook,
    po_fulfillment: poFulfillment,
    team_ontime: teamOntime,
    pos_sales_shift: posSalesShift,
    leave_request_discipline: leaveDiscipline,
    att_late_ratio: attLateRatio,
    task_completion: taskCompletion,
  };
  const orgCollected: Record<(typeof ORG_COLLECTOR_CODES)[number], CollectorValue | null> = {
    leave_sla: leaveSla,
    vendor_pay_ontime: vendorPayOntime,
    vendor_pay_sla: vendorPaySla,
    payroll_paid_ontime: payrollTimeliness.paidOntime,
    payroll_ready_h2: payrollTimeliness.readyH2,
  };

  // 4. Scorecard final yang tak boleh ditimpa + snapshot MANUAL tersimpan
  //    (mis. supervisor_rubric) agar re-run tidak membuang nilai rubrik.
  const [finalsRes, manualRes] = await Promise.all([
    pool.query(
      `SELECT employee_id FROM performance.kpi_scorecards
       WHERE period_year = $1 AND period_month = $2 AND status = 'final'`,
      [periodYear, periodMonth]
    ),
    pool.query(
      `SELECT s.employee_id, s.indicator_id, s.attainment::float AS attainment
       FROM performance.kpi_snapshots s
       JOIN performance.kpi_indicators i ON i.id = s.indicator_id
       WHERE s.period_year = $1 AND s.period_month = $2
         AND i.source_kind = 'manual'`,
      [periodYear, periodMonth]
    ),
  ]);
  const finalEmployees = new Set(finalsRes.rows.map((r) => r.employee_id));
  const manualAttainment = new Map<string, number | null>(
    manualRes.rows.map((r) => [`${r.employee_id}:${r.indicator_id}`, r.attainment])
  );

  // 5. Hitung attainment DI MEMORI dulu, lalu upsert BATCH (bukan N+1) —
  //    karyawan ber-scorecard FINAL dibekukan total: snapshot-nya pun tidak
  //    di-refresh agar jejak audit tetap cocok dgn breakdown yang terkunci.
  interface SnapshotRow {
    employeeId: string;
    indicatorId: string;
    actual: number | null;
    target: number | null;
    attainment: number | null;
    sampleSize: number | null;
    sourceDetail: unknown;
  }
  interface ScorecardRow {
    employeeId: string;
    roleCode: string;
    score: number | null;
    rawScore: number | null;
    usedWeight: number;
    breakdown: unknown;
  }
  const snapshotRows: SnapshotRow[] = [];
  const scorecardRows: ScorecardRow[] = [];

  for (const employee of employees) {
    if (finalEmployees.has(employee.id)) continue; // beku total
    const components =
      (employee.department_id ? deptComponents.get(employee.department_id) : undefined) ??
      roleComponents.get(employee.role_code) ??
      [];
    if (components.length === 0) continue; // tanpa konfigurasi (mis. direksi)

    const scorecardComponents: ScorecardComponent[] = [];

    for (const component of components) {
      const indicator = indicatorsById.get(component.indicatorId);
      if (!indicator) continue;

      const isEmployeeCollected = (
        EMPLOYEE_COLLECTOR_CODES as readonly string[]
      ).includes(indicator.code);
      const isOrgCollected = (ORG_COLLECTOR_CODES as readonly string[]).includes(
        indicator.code
      );
      const value = isEmployeeCollected
        ? collected[
            indicator.code as (typeof EMPLOYEE_COLLECTOR_CODES)[number]
          ].get(employee.id)
        : isOrgCollected
          ? orgCollected[indicator.code as (typeof ORG_COLLECTOR_CODES)[number]] ??
            undefined
          : undefined;
      const hasCollector = isEmployeeCollected || isOrgCollected;

      const target = resolveTarget(
        targetsByIndicator.get(indicator.id) ?? [],
        {
          employeeId: employee.id,
          departmentId: employee.department_id,
          roleCode: employee.role_code,
          periodMonth,
          periodYear,
        },
        toNum(indicator.default_target)
      );

      const attainment =
        value === undefined
          ? // indikator manual (rubrik) pakai snapshot tersimpan;
            // gelombang 3 tanpa data → null
            manualAttainment.get(`${employee.id}:${indicator.id}`) ?? null
          : computeAttainment({
              direction: indicator.direction,
              actual: value.actual,
              target,
            });

      // Snapshot utk semua indikator ber-kolektor yang menghasilkan data
      if (hasCollector && value !== undefined) {
        snapshotRows.push({
          employeeId: employee.id,
          indicatorId: indicator.id,
          actual: value?.actual ?? null,
          target,
          attainment,
          sampleSize: value?.sampleSize ?? null,
          sourceDetail: value?.sourceDetail ?? null,
        });
      }

      scorecardComponents.push({
        code: indicator.code,
        weight: component.weight,
        attainment,
      });
    }

    const score = composeScore(scorecardComponents);
    scorecardRows.push({
      employeeId: employee.id,
      roleCode: employee.role_code,
      score: score.score,
      rawScore: score.rawScore,
      usedWeight: score.usedWeight,
      breakdown: score.breakdown,
    });
  }

  // 6. Tulis dalam SATU transaksi (gagal parsial → rollback bersih)
  let snapshotsUpserted = 0;
  let scorecardsUpserted = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (snapshotRows.length > 0) {
      const res = await client.query(
        `INSERT INTO performance.kpi_snapshots
           (employee_id, indicator_id, period_year, period_month,
            actual, target, attainment, sample_size, source_detail)
         SELECT * FROM unnest(
           $1::uuid[], $2::uuid[], $3::int[], $4::int[],
           $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::jsonb[]
         )
         ON CONFLICT (employee_id, indicator_id, period_year, period_month)
         DO UPDATE SET actual = EXCLUDED.actual, target = EXCLUDED.target,
           attainment = EXCLUDED.attainment,
           sample_size = EXCLUDED.sample_size,
           source_detail = EXCLUDED.source_detail, updated_at = now()`,
        [
          snapshotRows.map((r) => r.employeeId),
          snapshotRows.map((r) => r.indicatorId),
          snapshotRows.map(() => periodYear),
          snapshotRows.map(() => periodMonth),
          snapshotRows.map((r) => r.actual),
          snapshotRows.map((r) => r.target),
          snapshotRows.map((r) => r.attainment),
          snapshotRows.map((r) => r.sampleSize),
          snapshotRows.map((r) => JSON.stringify(r.sourceDetail)),
        ]
      );
      snapshotsUpserted = res.rowCount ?? 0;
    }

    if (scorecardRows.length > 0) {
      const res = await client.query(
        `INSERT INTO performance.kpi_scorecards
           (employee_id, period_year, period_month, role_code,
            score, raw_score, used_weight, breakdown, status)
         SELECT *, 'draft' FROM unnest(
           $1::uuid[], $2::int[], $3::int[], $4::varchar[],
           $5::numeric[], $6::numeric[], $7::numeric[], $8::jsonb[]
         )
         ON CONFLICT (employee_id, period_year, period_month)
         DO UPDATE SET role_code = EXCLUDED.role_code, score = EXCLUDED.score,
           raw_score = EXCLUDED.raw_score, used_weight = EXCLUDED.used_weight,
           breakdown = EXCLUDED.breakdown, updated_at = now()
         WHERE performance.kpi_scorecards.status = 'draft'`,
        [
          scorecardRows.map((r) => r.employeeId),
          scorecardRows.map(() => periodYear),
          scorecardRows.map(() => periodMonth),
          scorecardRows.map((r) => r.roleCode),
          scorecardRows.map((r) => r.score),
          scorecardRows.map((r) => r.rawScore),
          scorecardRows.map((r) => r.usedWeight),
          scorecardRows.map((r) => JSON.stringify(r.breakdown)),
        ]
      );
      // rowCount akurat: baris final yang lolos race ikut tersaring WHERE
      scorecardsUpserted = res.rowCount ?? 0;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    period_year: periodYear,
    period_month: periodMonth,
    employees: employees.length,
    snapshots_upserted: snapshotsUpserted,
    scorecards_upserted: scorecardsUpserted,
    scorecards_skipped_final: finalEmployees.size,
    collectors: {
      att_ontime: attOntime.size,
      pos_cash_variance: cashVariance.size,
      logbook_compliance: logbook.size,
      po_fulfillment: poFulfillment.size,
      team_ontime: teamOntime.size,
      pos_sales_shift: posSalesShift.size,
      leave_request_discipline: leaveDiscipline.size,
      att_late_ratio: attLateRatio.size,
      leave_sla: leaveSla ? 1 : 0,
      vendor_pay_ontime: vendorPayOntime ? 1 : 0,
      vendor_pay_sla: vendorPaySla ? 1 : 0,
      payroll_paid_ontime: payrollTimeliness.paidOntime ? 1 : 0,
      payroll_ready_h2: payrollTimeliness.readyH2 ? 1 : 0,
    },
  };
}

/**
 * Susun ulang scorecard SATU karyawan dari kpi_snapshots tersimpan
 * (dipakai setelah input manual mis. rubrik atasan — Fase C).
 * Scorecard 'final' tidak ditimpa; return null bila role tanpa komponen.
 */
export async function recomposeScorecard(input: {
  employeeId: string;
  periodYear: number;
  periodMonth: number;
}): Promise<{ score: number | null; status: "updated" | "skipped_final" | "no_components" }> {
  const pool = getPool();
  const { employeeId, periodYear, periodMonth } = input;

  const employeeRes = await pool.query(
    `SELECT e.id, COALESCE(u.role, 'employee') AS role_code
     FROM hris.employees e
     LEFT JOIN configuration.users u ON u.id = e.user_id
     WHERE e.id = $1`,
    [employeeId]
  );
  if (employeeRes.rows.length === 0) return { score: null, status: "no_components" };
  const roleCode: string = employeeRes.rows[0].role_code;

  const [componentsRes, snapshotsRes, existingRes] = await Promise.all([
    pool.query(
      `SELECT ri.indicator_id, ri.weight::float AS weight, i.code
       FROM performance.kpi_role_indicators ri
       JOIN performance.kpi_indicators i ON i.id = ri.indicator_id
       WHERE ri.role_code = $1 AND i.is_active = true`,
      [roleCode]
    ),
    pool.query(
      `SELECT indicator_id, attainment::float AS attainment
       FROM performance.kpi_snapshots
       WHERE employee_id = $1 AND period_year = $2 AND period_month = $3`,
      [employeeId, periodYear, periodMonth]
    ),
    pool.query(
      `SELECT status FROM performance.kpi_scorecards
       WHERE employee_id = $1 AND period_year = $2 AND period_month = $3`,
      [employeeId, periodYear, periodMonth]
    ),
  ]);

  if (componentsRes.rows.length === 0) return { score: null, status: "no_components" };
  if (existingRes.rows[0]?.status === "final")
    return { score: null, status: "skipped_final" };

  const attainmentByIndicator = new Map<string, number | null>(
    snapshotsRes.rows.map((row) => [row.indicator_id, row.attainment])
  );
  const score = composeScore(
    componentsRes.rows.map((row) => ({
      code: row.code,
      weight: row.weight,
      attainment: attainmentByIndicator.get(row.indicator_id) ?? null,
    }))
  );

  await pool.query(
    `INSERT INTO performance.kpi_scorecards
       (employee_id, period_year, period_month, role_code,
        score, raw_score, used_weight, breakdown, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
     ON CONFLICT (employee_id, period_year, period_month)
     DO UPDATE SET role_code = EXCLUDED.role_code, score = EXCLUDED.score,
       raw_score = EXCLUDED.raw_score, used_weight = EXCLUDED.used_weight,
       breakdown = EXCLUDED.breakdown, updated_at = now()
     WHERE performance.kpi_scorecards.status = 'draft'`,
    [
      employeeId,
      periodYear,
      periodMonth,
      roleCode,
      score.score,
      score.rawScore,
      score.usedWeight,
      JSON.stringify(score.breakdown),
    ]
  );
  return { score: score.score, status: "updated" };
}
