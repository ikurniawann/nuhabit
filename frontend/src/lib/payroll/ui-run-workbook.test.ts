import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { PayrollRunDetail, PayrollRunDetailRow } from "@/features/hris/payroll/types";
import { buildPayrollRunWorkbook } from "./ui-run-workbook";

function detail(overrides: Partial<PayrollRunDetailRow> = {}): PayrollRunDetailRow {
  return {
    id: "slip-1", employee_id: "employee-1", status: "calculated",
    base_salary: 5_000_000, fixed_allowance: 0, variable_allowance: 0,
    transport_allowance: 0, meal_allowance: 0, housing_allowance: 0,
    overtime_pay: 0, thr: 0, bonus: 0, other_earning: 0,
    gross_salary: 5_000_000, bpjs_tk_jht_deduction: 250_000,
    bpjs_tk_jp_deduction: 0, bpjs_kes_deduction: 0, tapera_deduction: 0,
    pph21_deduction: 0, unpaid_leave_deduction: 0, late_deduction: 0,
    loan_deduction: 0, other_deduction: 0, total_deductions: 250_000,
    net_salary: 4_750_000,
    employee: {
      id: "employee-1", nip: "00017", full_name: "Siti",
      bank_name: "BCA", bank_account: "0012345678", department: { name: "Coach" },
    },
    ...overrides,
  };
}

function run(rows: PayrollRunDetailRow[]): PayrollRunDetail {
  return {
    id: "run-1", run_name: "Payroll Oktober 2026", period_month: 10, period_year: 2026,
    status: "paid", total_employees: rows.length, total_gross: 5_000_000,
    total_net: 4_750_000, total_deductions: 250_000, total_pph21: 0,
    total_bjtk_employee: 250_000, total_bjtk_employer: 0,
    created_at: "2026-10-31T00:00:00Z", payroll_details: rows,
  };
}

describe("payroll XLSX draft", () => {
  it("preserves leading zeroes in bank accounts after XLSX export and import", async () => {
    const workbook = await buildPayrollRunWorkbook(run([detail()]));
    const bytes = await workbook.xlsx.writeBuffer();
    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(bytes);
    const sheet = imported.getWorksheet("Rincian");
    expect(sheet?.getCell("E7").value).toBe("0012345678");
    expect(sheet?.getCell("E7").numFmt).toBe("@");
    expect(sheet?.getCell("A7").value).toBe("00017");
    expect(sheet?.getCell("AA7").value).toBe(4_750_000);
    expect(sheet?.getCell("AB7").value).toMatchObject({ formula: "ROUND(P7-Z7-AA7,2)" });
    expect(imported.getWorksheet("Ringkasan")?.getCell("B9").value).toEqual({
      formula: "SUM(Rincian!AA7:AA7)", result: 4_750_000,
    });
  });

  it("flags missing bank details and a payroll mismatch", async () => {
    const workbook = await buildPayrollRunWorkbook(run([detail({
      net_salary: 4_700_000,
      employee: { id: "employee-1", nip: "00017", full_name: "Siti", bank_name: null, bank_account: null },
    })]));
    const summary = workbook.getWorksheet("Ringkasan");
    expect(summary?.getCell("B12").value).toBe(1);
    expect(summary?.getCell("B13").value).toBe(1);
    expect(workbook.getWorksheet("Rincian")?.getCell("AB7").value).toEqual({
      formula: "ROUND(P7-Z7-AA7,2)", result: 50_000,
    });
  });
});
