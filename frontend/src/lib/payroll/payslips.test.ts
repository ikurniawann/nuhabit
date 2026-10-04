import { describe, expect, it } from "vitest";
import { periodLabelId } from "./period";
import { payslipAmounts, resolvePayslipScope, type PayslipPdfRow } from "./payslips";

describe("resolvePayslipScope", () => {
  const hr = { role: "hrd", employeeId: "emp-hr" };
  const staff = { role: "employee", employeeId: "emp-1" };

  it("non-HR selalu dipaksa ke slip miliknya (tampilan personal)", () => {
    expect(resolvePayslipScope(staff, undefined)).toEqual({ meView: true, employeeId: "emp-1" });
    expect(resolvePayslipScope(staff, "emp-2")).toEqual({ meView: true, employeeId: "emp-1" });
  });

  it("HR: me = personal, tanpa filter = semua, eksplisit = karyawan itu", () => {
    expect(resolvePayslipScope(hr, "me")).toEqual({ meView: true, employeeId: "emp-hr" });
    expect(resolvePayslipScope(hr, undefined)).toEqual({ meView: false, employeeId: null });
    expect(resolvePayslipScope(hr, "emp-9")).toEqual({ meView: false, employeeId: "emp-9" });
  });

  it("akun tanpa record karyawan pada tampilan personal → undefined (daftar kosong)", () => {
    expect(resolvePayslipScope({ role: "employee", employeeId: null }, undefined).employeeId).toBeUndefined();
  });
});

describe("payslipAmounts", () => {
  it("kolom numeric string → number, kosong → 0, loan_details non-array → []", () => {
    const row = {
      base_salary: "10000000.00",
      net_salary: "9123456.78",
      thr: null,
      loan_details: null,
    } as unknown as PayslipPdfRow;
    const amounts = payslipAmounts(row);
    expect(amounts.base_salary).toBe(10_000_000);
    expect(amounts.net_salary).toBe(9_123_456.78);
    expect(amounts.thr).toBe(0);
    expect(amounts.bonus).toBe(0);
    expect(amounts.loan_details).toEqual([]);
  });
});

describe("periodLabelId", () => {
  it("nama bulan Indonesia", () => {
    expect(periodLabelId(1, 2026)).toBe("Januari 2026");
    expect(periodLabelId(12, 2026)).toBe("Desember 2026");
    expect(periodLabelId(null, 2026)).toBe("Januari 2026");
  });
});
