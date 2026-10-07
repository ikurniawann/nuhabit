import { describe, expect, it } from "vitest";
import { resolveTarget, type KpiTargetRow } from "@/lib/kpi/targets";

const ctx = {
  employeeId: "emp-1",
  departmentId: "dept-1",
  roleCode: "pos",
  periodMonth: 7,
  periodYear: 2026,
};

const row = (partial: Partial<KpiTargetRow>): KpiTargetRow => ({
  period_year: null,
  period_month: null,
  role_code: null,
  department_id: null,
  employee_id: null,
  target: 0,
  ...partial,
});

describe("resolveTarget", () => {
  it("falls back to indicator default when no rows", () => {
    expect(resolveTarget([], ctx, 0.95)).toBe(0.95);
  });

  it("returns null when no rows and no default", () => {
    expect(resolveTarget([], ctx, null)).toBeNull();
  });

  it("employee-specific beats department, role, and generic", () => {
    const rows = [
      row({ target: 1 }),
      row({ role_code: "pos", target: 2 }),
      row({ department_id: "dept-1", target: 3 }),
      row({ employee_id: "emp-1", target: 4 }),
    ];
    expect(resolveTarget(rows, ctx, null)).toBe(4);
  });

  it("period-specific beats period-generic at same scope", () => {
    const rows = [
      row({ role_code: "pos", target: 2 }),
      row({ role_code: "pos", period_year: 2026, period_month: 7, target: 5 }),
    ];
    expect(resolveTarget(rows, ctx, null)).toBe(5);
  });

  it("rows for other scopes/periods are ignored", () => {
    const rows = [
      row({ employee_id: "emp-OTHER", target: 9 }),
      row({ department_id: "dept-OTHER", target: 9 }),
      row({ role_code: "hrd", target: 9 }),
      row({ period_year: 2026, period_month: 6, role_code: "pos", target: 9 }),
    ];
    expect(resolveTarget(rows, ctx, 0.9)).toBe(0.9);
  });

  it("same scope: bulan-eksak beats tahun-saja beats periode-umum", () => {
    const rows = [
      row({ role_code: "pos", target: 1 }),
      row({ role_code: "pos", period_year: 2026, target: 2 }),
      row({ role_code: "pos", period_year: 2026, period_month: 7, target: 3 }),
    ];
    expect(resolveTarget(rows, ctx, null)).toBe(3);
    // tanpa baris bulan-eksak → tahun-saja menang
    expect(resolveTarget(rows.slice(0, 2), ctx, null)).toBe(2);
  });

  it("month-only target (tanpa tahun) berlaku tiap tahun & bisa menang", () => {
    const rows = [
      row({ role_code: "pos", target: 1 }),
      row({ role_code: "pos", period_month: 7, target: 6 }),
    ];
    expect(resolveTarget(rows, ctx, null)).toBe(6);
    // bulan lain tidak match
    expect(
      resolveTarget(rows, { ...ctx, periodMonth: 8 }, null)
    ).toBe(1);
  });

  it("period-specific generic loses to period-generic employee scope", () => {
    // scope lebih spesifik menang atas periode lebih spesifik
    const rows = [
      row({ period_year: 2026, period_month: 7, target: 1 }),
      row({ employee_id: "emp-1", target: 7 }),
    ];
    expect(resolveTarget(rows, ctx, null)).toBe(7);
  });
});
