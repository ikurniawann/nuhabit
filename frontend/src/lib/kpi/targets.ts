/**
 * Resolusi target KPI (EPIC-010): baris kpi_targets paling spesifik menang.
 * Prioritas SCOPE (utama): employee > department > role > generic;
 * lalu PERIODE (sekunder): periode-eksak > periode-umum.
 * Fallback terakhir: default_target indikator.
 */

export interface KpiTargetRow {
  period_year: number | null;
  period_month: number | null;
  role_code: string | null;
  department_id: string | null;
  employee_id: string | null;
  target: number;
}

export interface TargetContext {
  employeeId: string;
  departmentId: string | null;
  roleCode: string;
  periodMonth: number;
  periodYear: number;
}

const SCOPE_EMPLOYEE = 8;
const SCOPE_DEPARTMENT = 4;
const SCOPE_ROLE = 2;
const SCOPE_GENERIC = 1;

function scopeRank(row: KpiTargetRow): number {
  if (row.employee_id) return SCOPE_EMPLOYEE;
  if (row.department_id) return SCOPE_DEPARTMENT;
  if (row.role_code) return SCOPE_ROLE;
  return SCOPE_GENERIC;
}

function matches(row: KpiTargetRow, ctx: TargetContext): boolean {
  if (row.employee_id && row.employee_id !== ctx.employeeId) return false;
  if (row.department_id && row.department_id !== ctx.departmentId) return false;
  if (row.role_code && row.role_code !== ctx.roleCode) return false;
  // Kolom periode independen: year-null+month-set = "bulan ini tiap tahun".
  if (row.period_year !== null && row.period_year !== ctx.periodYear)
    return false;
  if (row.period_month !== null && row.period_month !== ctx.periodMonth)
    return false;
  return true;
}

/** Spesifisitas periode: bulan-eksak (2) > tahun-saja (1) > umum (0). */
function periodRank(row: KpiTargetRow): number {
  return (row.period_month !== null ? 2 : 0) + (row.period_year !== null ? 1 : 0);
}

export function resolveTarget(
  rows: KpiTargetRow[],
  ctx: TargetContext,
  indicatorDefault: number | null
): number | null {
  const candidates = rows.filter((row) => matches(row, ctx));
  if (candidates.length === 0) return indicatorDefault;

  candidates.sort((a, b) => {
    const scope = scopeRank(b) - scopeRank(a);
    if (scope !== 0) return scope;
    return periodRank(b) - periodRank(a);
  });

  return candidates[0].target;
}
