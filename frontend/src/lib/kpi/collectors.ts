import type { Pool } from "pg";
import { dateColToIso } from "@/lib/payroll/period";
import type { EmployeeShiftRow } from "@/lib/hris/shifts";
import { computeOntime } from "./attendance-ontime";
import { safeRatio } from "./collect-math";

/**
 * Kolektor otomatis KPI gelombang 1 (EPIC-010 Fase B).
 * Semua query parameterized; hasil per karyawan = bahan kpi_snapshots
 * (actual + sample_size + source_detail utk audit).
 */

export interface CollectorValue {
  actual: number | null;
  sampleSize: number | null;
  sourceDetail: unknown;
}

/** key = employee_id */
export type CollectorMap = Map<string, CollectorValue>;

export interface KpiEmployee {
  id: string;
  user_id: string | null;
  department_id: string | null;
  role_code: string;
}

// ============================================================
// att_ontime — basis hari terjadwal (reuse resolver shifts), cuti approved
// tidak menghukum; tanpa jadwal → fallback basis hari hadir.
// ============================================================
export async function collectAttOntime(
  pool: Pool,
  employees: KpiEmployee[],
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const [scheduleRes, attendanceRes, leaveRes] = await Promise.all([
    pool.query(
      `SELECT employee_id, day_of_week, shift_id, effective_from, effective_to
       FROM hris.employee_shifts
       WHERE effective_from <= $2
         AND (effective_to IS NULL OR effective_to >= $1)`,
      [startIso, endIso]
    ),
    pool.query(
      `SELECT employee_id, date, is_late
       FROM hris.attendance
       WHERE date BETWEEN $1 AND $2 AND status = 'present'`,
      [startIso, endIso]
    ),
    pool.query(
      `SELECT employee_id, start_date, end_date
       FROM hris.leaves
       WHERE status = 'approved' AND start_date <= $2 AND end_date >= $1`,
      [startIso, endIso]
    ),
  ]);

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

  const attendance = new Map<string, { date: string; is_late: boolean | null }[]>();
  for (const row of attendanceRes.rows) {
    const date = dateColToIso(row.date);
    if (!date) continue;
    const list = attendance.get(row.employee_id) ?? [];
    list.push({ date, is_late: row.is_late });
    attendance.set(row.employee_id, list);
  }

  const leaveDays = new Map<string, Set<string>>();
  for (const row of leaveRes.rows) {
    const start = dateColToIso(row.start_date);
    const end = dateColToIso(row.end_date);
    if (!start || !end) continue;
    const set = leaveDays.get(row.employee_id) ?? new Set<string>();
    // hanya tanggal di dalam periode
    const from = start < startIso ? startIso : start;
    const to = end > endIso ? endIso : end;
    for (
      let d = new Date(`${from}T00:00:00Z`);
      d.toISOString().slice(0, 10) <= to;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      set.add(d.toISOString().slice(0, 10));
    }
    leaveDays.set(row.employee_id, set);
  }

  const result: CollectorMap = new Map();
  for (const employee of employees) {
    const ontime = computeOntime({
      scheduleRows: schedules.get(employee.id) ?? [],
      attendanceRows: attendance.get(employee.id) ?? [],
      leaveDays: leaveDays.get(employee.id) ?? new Set(),
      startIso,
      endIso,
    });
    result.set(employee.id, {
      actual: ontime.actual,
      sampleSize: ontime.sampleSize,
      sourceDetail: ontime.detail,
    });
  }
  return result;
}

// ============================================================
// pos_cash_variance — Σ|variance| / Σ expected_cash shift TUTUP milik kasir
// (pos_shifts.cashier_id = users.id → employees.user_id)
// ============================================================
export async function collectPosCashVariance(
  pool: Pool,
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id,
            SUM(ABS(COALESCE(s.variance, 0)))::float AS sum_abs_variance,
            SUM(COALESCE(s.expected_cash, 0))::float AS sum_expected,
            COUNT(*)::int AS shift_count
     FROM pos.pos_shifts s
     JOIN hris.employees e ON e.user_id = s.cashier_id
     WHERE s.closed_at IS NOT NULL
       AND s.closed_at >= $1::date
       AND s.closed_at < ($2::date + 1)
     GROUP BY e.id`,
    [startIso, endIso]
  );

  const result: CollectorMap = new Map();
  for (const row of rows) {
    result.set(row.employee_id, {
      actual: safeRatio(row.sum_abs_variance, row.sum_expected),
      sampleSize: row.shift_count,
      sourceDetail: {
        sum_abs_variance: row.sum_abs_variance,
        sum_expected: row.sum_expected,
        shift_count: row.shift_count,
      },
    });
  }
  return result;
}

// ============================================================
// logbook_compliance — % item checklist selesai pada entry department
// karyawan dlm periode (nilai department dibagikan ke anggotanya)
// ============================================================
export async function collectLogbookCompliance(
  pool: Pool,
  employees: KpiEmployee[],
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const { rows } = await pool.query(
    `SELECT en.department_id,
            COUNT(*) FILTER (WHERE it.is_checked)::int AS checked_items,
            COUNT(*)::int AS total_items
     FROM hris.hris_logbook_entries en
     JOIN hris.hris_logbook_entry_items it ON it.entry_id = en.id
     WHERE en.entry_date BETWEEN $1 AND $2
     GROUP BY en.department_id`,
    [startIso, endIso]
  );

  const byDepartment = new Map<
    string,
    { checked: number; total: number }
  >();
  for (const row of rows) {
    byDepartment.set(row.department_id, {
      checked: row.checked_items,
      total: row.total_items,
    });
  }

  const result: CollectorMap = new Map();
  for (const employee of employees) {
    const dept = employee.department_id
      ? byDepartment.get(employee.department_id)
      : undefined;
    if (!dept) continue; // tanpa data dept → indikator dikeluarkan
    result.set(employee.id, {
      actual: safeRatio(dept.checked, dept.total),
      sampleSize: dept.total,
      sourceDetail: {
        department_id: employee.department_id,
        checked_items: dept.checked,
        total_items: dept.total,
      },
    });
  }
  return result;
}

// ============================================================
// po_fulfillment — Σ qty_received / Σ qty_ordered PO (non draft/cancelled)
// per pembuat PO (purchase_orders.created_by = users.id → employees.user_id)
// ============================================================
export async function collectPoFulfillment(
  pool: Pool,
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id,
            SUM(COALESCE(poi.qty_received, 0))::float AS sum_received,
            SUM(COALESCE(poi.qty_ordered, 0))::float AS sum_ordered,
            COUNT(DISTINCT po.id)::int AS po_count
     FROM purchasing.purchase_orders po
     JOIN purchasing.purchase_order_items poi ON poi.purchase_order_id = po.id
     JOIN hris.employees e ON e.user_id = po.created_by
     WHERE po.tanggal_po BETWEEN $1 AND $2
       AND po.status NOT IN ('draft', 'cancelled')
     GROUP BY e.id`,
    [startIso, endIso]
  );

  const result: CollectorMap = new Map();
  for (const row of rows) {
    result.set(row.employee_id, {
      actual: safeRatio(row.sum_received, row.sum_ordered),
      sampleSize: row.po_count,
      sourceDetail: {
        sum_received: row.sum_received,
        sum_ordered: row.sum_ordered,
        po_count: row.po_count,
      },
    });
  }
  return result;
}

// ============================================================
// task_completion — Task Departemen (owner 2026-08-30, MBO/task
// compliance): tugas ter-APPROVE Head Division ÷ tugas jatuh tempo periode.
// Occurrence ber-assignee dihitung ke karyawan itu; tanpa assignee
// dihitung ke SIAPA yang menandainya selesai (done_by); occurrence
// tanpa assignee yang tak pernah dikerjakan dihitung ke seluruh
// karyawan departemen (tanggung jawab bersama yang terlewat).
// ============================================================
export async function collectTaskCompletion(
  pool: Pool,
  employees: KpiEmployee[],
  startIso: string,
  endIso: string
): Promise<CollectorMap> {
  const { rows } = await pool.query<{
    department_id: string;
    assignee_employee_id: string | null;
    done_by: string | null;
    status: string;
    jumlah: number;
  }>(
    `SELECT t.department_id, t.assignee_employee_id, o.done_by, o.status,
            count(*)::int AS jumlah
     FROM hris.department_task_occurrences o
     JOIN hris.department_tasks t ON t.id = o.task_id
     WHERE o.occurrence_date BETWEEN $1 AND $2
     GROUP BY 1, 2, 3, 4`,
    [startIso, endIso]
  );
  if (rows.length === 0) return new Map();

  const perEmployee = new Map<string, { approved: number; due: number }>();
  const bump = (employeeId: string, approved: number, due: number) => {
    const cur = perEmployee.get(employeeId) ?? { approved: 0, due: 0 };
    cur.approved += approved;
    cur.due += due;
    perEmployee.set(employeeId, cur);
  };
  const deptMembers = new Map<string, string[]>();
  for (const emp of employees) {
    if (!emp.department_id) continue;
    const list = deptMembers.get(emp.department_id) ?? [];
    list.push(emp.id);
    deptMembers.set(emp.department_id, list);
  }

  for (const row of rows) {
    const approved = row.status === "approved" ? row.jumlah : 0;
    const owner = row.assignee_employee_id ?? row.done_by;
    if (owner) {
      bump(owner, approved, row.jumlah);
    } else {
      // tanpa assignee & tak pernah dikerjakan → beban bersama departemen
      for (const memberId of deptMembers.get(row.department_id) ?? []) {
        bump(memberId, 0, row.jumlah);
      }
    }
  }

  const result: CollectorMap = new Map();
  for (const emp of employees) {
    const agg = perEmployee.get(emp.id);
    if (!agg || agg.due === 0) continue; // tanpa tugas → indikator null (dikeluarkan)
    result.set(emp.id, {
      actual: agg.approved / agg.due,
      sampleSize: agg.due,
      sourceDetail: { approved: agg.approved, due: agg.due },
    });
  }
  return result;
}
