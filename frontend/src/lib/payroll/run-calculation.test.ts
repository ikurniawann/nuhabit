import { describe, expect, it } from "vitest";
import { calculatePayroll, type PayrollInput } from "./calculator";
import { DEFAULT_PAYROLL_CONFIG } from "./config";
import { periodBounds } from "./period";
import { payrollDetailRow, sumRunTotals } from "./run-calculation";

/**
 * Karakterisasi: pemetaan hasil kalkulator ke payroll_details dan total run
 * harus sama persis dengan route lama (sebelum dipindah ke lib).
 */

function input(overrides: Partial<PayrollInput> = {}): PayrollInput {
  return {
    employeeId: "emp-1",
    periodMonth: 6,
    periodYear: 2026,
    baseSalary: 10_000_000,
    fixedAllowance: 2_000_000,
    transportAllowance: 500_000,
    overtimeHours: 4,
    overtimeHolidayHours: 3,
    workingDays: 22,
    presentDays: 21,
    lateDays: 2,
    lateMinutes: 30,
    unpaidLeaveDays: 1,
    loanDeduction: 500_000,
    loanBreakdown: [
      {
        loan_id: "loan-1",
        loan_type: "kasbon",
        installment_no: 2,
        tenor_months: 6,
        amount: 500_000,
        remaining_before: 2_500_000,
        remaining_after: 2_000_000,
      },
    ],
    joinDate: "2024-01-15",
    employmentStatus: "permanent",
    prorateFactor: 0.9,
    ptkpStatus: "K/1",
    isTaxable: true,
    bpjsTkEnrolled: true,
    bpjsKesEnrolled: true,
    taperaEnrolled: false,
    ...overrides,
  };
}

describe("payrollDetailRow", () => {
  it("memetakan setiap angka hasil kalkulator tanpa diubah", async () => {
    const payrollInput = input();
    const result = await calculatePayroll(payrollInput, DEFAULT_PAYROLL_CONFIG);
    const row = payrollDetailRow("run-1", "emp-1", result, payrollInput);

    expect(row).toMatchObject({
      payroll_run_id: "run-1",
      employee_id: "emp-1",
      base_salary: result.baseSalary,
      gross_salary: result.grossSalary,
      pph21_deduction: result.pph21Deduction,
      loan_deduction: result.loanDeduction,
      total_deductions: result.totalDeductions,
      net_salary: result.netSalary,
      bpjs_kes_employer: result.bpjsKesEmployer,
      taxable_income: result.taxableIncome,
      pph21_annual: result.pph21Annual,
      working_days: 22,
      present_days: 21,
      late_days: 2,
      unpaid_leave_days: 1,
      prorate_factor: 0.9,
      full_base_salary: 10_000_000,
      status: "calculated",
    });
    // Jam lembur di slip = hari kerja + hari libur
    expect(row.overtime_hours).toBe(7);
    expect(JSON.parse(row.loan_details)).toEqual(payrollInput.loanBreakdown);
  });

  it("default: tanpa lembur libur, prorate 1, rincian pinjaman kosong", async () => {
    const payrollInput = input({
      overtimeHolidayHours: undefined,
      prorateFactor: undefined,
      loanBreakdown: undefined,
    });
    const result = await calculatePayroll(payrollInput, DEFAULT_PAYROLL_CONFIG);
    const row = payrollDetailRow("run-1", "emp-1", result, payrollInput);
    expect(row.overtime_hours).toBe(4);
    expect(row.prorate_factor).toBe(1);
    expect(row.loan_details).toBe("[]");
  });
});

describe("sumRunTotals", () => {
  it("menjumlahkan total run seperti loop lama", async () => {
    const a = await calculatePayroll(input(), DEFAULT_PAYROLL_CONFIG);
    const b = await calculatePayroll(
      input({ employeeId: "emp-2", baseSalary: 6_500_000, ptkpStatus: "TK/0", loanDeduction: 0 }),
      DEFAULT_PAYROLL_CONFIG
    );
    const totals = sumRunTotals([a, b]);
    expect(totals).toEqual({
      total_gross: a.grossSalary + b.grossSalary,
      total_deductions: a.totalDeductions + b.totalDeductions,
      total_net: a.netSalary + b.netSalary,
      total_bjtk_employee:
        a.bpjsTkJhtDeduction + a.bpjsTkJpDeduction + a.bpjsKesDeduction + a.taperaDeduction +
        (b.bpjsTkJhtDeduction + b.bpjsTkJpDeduction + b.bpjsKesDeduction + b.taperaDeduction),
      total_bjtk_employer: a.totalEmployerContribution + b.totalEmployerContribution,
      total_pph21: a.pph21Deduction + b.pph21Deduction,
    });
  });

  it("run kosong = nol semua", () => {
    expect(sumRunTotals([])).toEqual({
      total_gross: 0,
      total_deductions: 0,
      total_net: 0,
      total_bjtk_employee: 0,
      total_bjtk_employer: 0,
      total_pph21: 0,
    });
  });
});

describe("periodBounds", () => {
  it("akhir bulan termasuk kabisat", () => {
    expect(periodBounds(2, 2028)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodBounds(12, 2026)).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});
