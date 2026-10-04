/**
 * Kalkulasi satu run payroll (EPIC-008): hapus hasil lama, hitung tiap
 * karyawan aktif lewat calculator.ts, simpan payroll_details, lalu tulis
 * total run. Angka uang hanya berasal dari calculatePayroll; modul ini
 * memetakan hasilnya ke kolom dan menjumlahkan total.
 */

import type { PgClient } from "@/lib/pg/create-client";
import { ApiError } from "@/lib/api/auth";
import { loadHolidayIndex } from "@/lib/hris/holidays-db";
import { calculatePayroll, type PayrollInput, type PayrollResult } from "./calculator";
import { loadPayrollConfig } from "./config";
import { loadEmployeePayrollInput } from "./inputs";
import { periodBounds } from "./period";
import { canCalculateRun } from "./run-status";

/** Baris payroll_details dari hasil kalkulator + input yang dibekukan ke slip. */
export function payrollDetailRow(
  runId: string,
  employeeId: string,
  result: PayrollResult,
  input: PayrollInput
) {
  return {
    payroll_run_id: runId,
    employee_id: employeeId,
    base_salary: result.baseSalary,
    fixed_allowance: result.fixedAllowance,
    variable_allowance: result.variableAllowance,
    transport_allowance: result.transportAllowance,
    meal_allowance: result.mealAllowance,
    housing_allowance: result.housingAllowance,
    overtime_pay: result.overtimePay,
    thr: result.thr,
    bonus: result.bonus,
    other_earning: result.otherEarning,
    gross_salary: result.grossSalary,
    bpjs_tk_jht_deduction: result.bpjsTkJhtDeduction,
    bpjs_tk_jp_deduction: result.bpjsTkJpDeduction,
    bpjs_kes_deduction: result.bpjsKesDeduction,
    tapera_deduction: result.taperaDeduction,
    pph21_deduction: result.pph21Deduction,
    unpaid_leave_deduction: result.unpaidLeaveDeduction,
    late_deduction: result.lateDeduction,
    loan_deduction: result.loanDeduction,
    loan_details: JSON.stringify(input.loanBreakdown ?? []),
    other_deduction: result.otherDeduction,
    total_deductions: result.totalDeductions,
    net_salary: result.netSalary,
    bpjs_tk_jht_employer: result.bpjsTkJhtEmployer,
    bpjs_tk_jp_employer: result.bpjsTkJpEmployer,
    bpjs_tk_jkk_employer: result.bpjsTkJkkEmployer,
    bpjs_tk_jkm_employer: result.bpjsTkJkmEmployer,
    bpjs_kes_employer: result.bpjsKesEmployer,
    tapera_employer: result.taperaEmployer,
    taxable_income: result.taxableIncome,
    ptkp_amount: result.ptkpAmount,
    pph21_annual: result.pph21Annual,
    pph21_monthly: result.pph21Monthly,
    working_days: input.workingDays,
    present_days: input.presentDays,
    late_days: input.lateDays,
    unpaid_leave_days: input.unpaidLeaveDays,
    // TOTAL jam lembur (hari kerja + hari libur). Sejak EPIC-036 Fase F
    // input.overtimeHours hanya memuat jam hari kerja karena tarifnya
    // dipisah; kolom ini tetap total supaya slip gaji tidak melaporkan jam
    // lembur lebih sedikit dari yang dikerjakan.
    overtime_hours: (input.overtimeHours ?? 0) + (input.overtimeHolidayHours ?? 0),
    prorate_factor: input.prorateFactor ?? 1,
    full_base_salary: input.baseSalary,
    status: "calculated",
  };
}

export interface RunTotals {
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_bjtk_employee: number;
  total_bjtk_employer: number;
  total_pph21: number;
}

/** Jumlahkan total run dari hasil per karyawan yang tersimpan. */
export function sumRunTotals(results: PayrollResult[]): RunTotals {
  const totals: RunTotals = {
    total_gross: 0,
    total_deductions: 0,
    total_net: 0,
    total_bjtk_employee: 0,
    total_bjtk_employer: 0,
    total_pph21: 0,
  };
  for (const r of results) {
    totals.total_gross += r.grossSalary;
    totals.total_deductions += r.totalDeductions;
    totals.total_net += r.netSalary;
    totals.total_bjtk_employee +=
      r.bpjsTkJhtDeduction + r.bpjsTkJpDeduction + r.bpjsKesDeduction + r.taperaDeduction;
    totals.total_bjtk_employer += r.totalEmployerContribution;
    totals.total_pph21 += r.pph21Deduction;
  }
  return totals;
}

interface SkippedEmployee {
  employee_id: string;
  full_name: string;
  reason: string;
}

interface ActiveEmployee {
  id: string;
  full_name: string;
  nip: string | null;
  is_active: boolean;
  employment_status: string;
  join_date: string;
}

export async function calculatePayrollRun(
  db: PgClient,
  runId: string,
  options: { includeThr: boolean }
) {
  const { data: run } = await db.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) throw ApiError.notFound("Payroll run tidak ditemukan");
  if (!canCalculateRun(run.status)) {
    throw ApiError.badRequest("Hanya payroll draft yang bisa dihitung");
  }

  // Konfigurasi tarif dari DB (payroll_settings + tax config tahun periode)
  const config = await loadPayrollConfig(db, run.period_year);

  // Hasil lama dibuang supaya hitung ulang tidak menggandakan detail
  const { error: deleteError } = await db
    .from("payroll_details")
    .delete()
    .eq("payroll_run_id", runId);
  if (deleteError) throw new Error(`Gagal membersihkan hasil lama: ${deleteError.message}`);

  const { data, error: empError } = await db
    .from("employees")
    .select("id, full_name, nip, is_active, employment_status, join_date")
    .eq("is_active", true);
  if (empError) throw new Error(`Gagal memuat karyawan: ${empError.message}`);
  const employees = (data ?? []) as ActiveEmployee[];
  if (employees.length === 0) {
    throw ApiError.badRequest("Tidak ada karyawan aktif ditemukan");
  }

  // Hari libur periode dimuat SEKALI untuk semua karyawan (EPIC-036 Fase F)
  const bounds = periodBounds(run.period_month, run.period_year);
  const holidays = await loadHolidayIndex(bounds.start, bounds.end);

  const saved: (Record<string, unknown> & { employee: Pick<ActiveEmployee, "id" | "full_name" | "nip"> })[] = [];
  const savedResults: PayrollResult[] = [];
  const skipped: SkippedEmployee[] = [];
  const skip = (employee: ActiveEmployee, reason: string) =>
    skipped.push({ employee_id: employee.id, full_name: employee.full_name, reason });

  for (const employee of employees) {
    const input = await loadEmployeePayrollInput(db, employee, run.period_month, run.period_year, {
      includeThr: options.includeThr,
      holidays,
    });
    if (!input) {
      skip(employee, "Belum ada struktur gaji aktif");
      continue;
    }

    let result: PayrollResult;
    try {
      result = await calculatePayroll(input, config);
    } catch (calcError) {
      console.error(`[payroll] kalkulasi gagal untuk ${employee.id}:`, calcError);
      skip(employee, "Gagal menghitung");
      continue;
    }

    const { data: detail, error } = await db
      .from("payroll_details")
      .insert(payrollDetailRow(runId, employee.id, result, input))
      .select("*")
      .single();
    if (error) {
      console.error(`[payroll] gagal menyimpan detail ${employee.id}:`, error);
      skip(employee, "Gagal menyimpan detail");
      continue;
    }

    // Embed dibuang oleh wrapper pg di RETURNING; tempelkan data karyawan
    // agar respons & summary tetap membawa nama karyawan.
    saved.push({
      ...detail,
      employee: { id: employee.id, full_name: employee.full_name, nip: employee.nip },
    });
    savedResults.push(result);
  }

  const totals = sumRunTotals(savedResults);
  await db
    .from("payroll_runs")
    .update({ total_employees: saved.length, ...totals, updated_at: new Date().toISOString() })
    .eq("id", runId);

  return {
    data: saved,
    summary: {
      total_employees: saved.length,
      employee_names: saved.map((row) => row.employee.full_name ?? "Unknown"),
      skipped,
      ...totals,
    },
    message: `Payroll berhasil dihitung untuk ${saved.length} karyawan${skipped.length ? `, ${skipped.length} dilewati` : ""}`,
  };
}
