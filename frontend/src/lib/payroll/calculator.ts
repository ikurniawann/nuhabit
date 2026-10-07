/**
 * Payroll Calculation Engine
 * Indonesia 2026 Compliance (PPh 21 progresif tahunan, BPJS, THR, Tapera)
 *
 * Engine ini MURNI (tanpa akses DB). Konfigurasi tarif berasal dari
 * `loadPayrollConfig` (lib/payroll/config.ts) — konstanta default hanya
 * fallback. Pemuatan data karyawan ada di lib/payroll/inputs.ts.
 */

import {
  DEFAULT_PAYROLL_CONFIG,
  type PayrollConfig,
} from "./config";

// ============================================================
// TYPES
// ============================================================

import type { LoanInstallmentDetail } from "./loans";

export interface PayrollInput {
  employeeId: string;
  periodMonth: number;
  periodYear: number;

  // Earnings
  baseSalary: number;
  fixedAllowance: number;
  variableAllowance?: number;
  transportAllowance?: number;
  mealAllowance?: number;
  housingAllowance?: number;
  /** Jam lembur pada HARI KERJA biasa. */
  overtimeHours?: number;
  overtimeRate?: number;
  /**
   * Jam lembur pada HARI LIBUR RESMI (EPIC-036 Fase F), dibayar terpisah dengan
   * `overtimeHolidayRate`. 0/undefined → perhitungan identik dengan sebelum
   * fase ini.
   */
  overtimeHolidayHours?: number;
  overtimeHolidayRate?: number;
  bonus?: number;

  // Attendance
  workingDays: number;
  presentDays: number;
  lateDays?: number;
  lateMinutes?: number;
  unpaidLeaveDays?: number;

  /** Total cicilan pinjaman jatuh tempo periode ini (lib/payroll/loans) */
  loanDeduction?: number;
  /**
   * Rincian per pinjaman untuk slip gaji. Tidak ikut perhitungan — hanya
   * dibawa agar route penghitung dapat membekukannya ke payroll_details.
   */
  loanBreakdown?: LoanInstallmentDetail[];

  // Employee status
  joinDate: string;
  employmentStatus: string;
  /**
   * Tipe kontrak AKTIF dari hris.employment_contracts (Fase C).
   * null/undefined = karyawan tanpa record kontrak → fallback aturan lama.
   */
  contractType?: "pkwt" | "pkwtt" | null;
  /**
   * Faktor proraté masuk/keluar tengah periode (0..1) dari cakupan kontrak —
   * diterapkan ke gaji pokok + tunjangan bulanan. Default 1 (bulan penuh).
   */
  prorateFactor?: number;
  ptkpStatus: string;
  isTaxable: boolean;

  // Benefits enrollment
  bpjsTkEnrolled: boolean;
  bpjsKesEnrolled: boolean;
  taperaEnrolled: boolean;

  // Options
  includeThr?: boolean; // Include THR in calculation (default: false)
}

export interface PayrollResult {
  // Earnings
  baseSalary: number;
  fixedAllowance: number;
  variableAllowance: number;
  transportAllowance: number;
  mealAllowance: number;
  housingAllowance: number;
  overtimePay: number;
  thr: number;
  bonus: number;
  otherEarning: number;
  grossSalary: number;

  // Deductions (Employee)
  bpjsTkJhtDeduction: number;
  bpjsTkJpDeduction: number;
  bpjsKesDeduction: number;
  taperaDeduction: number;
  pph21Deduction: number;
  unpaidLeaveDeduction: number;
  lateDeduction: number;
  loanDeduction: number;
  otherDeduction: number;
  totalDeductions: number;

  // Attendance snapshot
  overtimeHours: number;

  // Net
  netSalary: number;

  // Employer Contributions
  bpjsTkJhtEmployer: number;
  bpjsTkJpEmployer: number;
  bpjsTkJkkEmployer: number;
  bpjsTkJkmEmployer: number;
  bpjsKesEmployer: number;
  taperaEmployer: number;
  totalEmployerContribution: number;

  // Tax Details
  taxableIncome: number;
  ptkpAmount: number;
  pph21Annual: number;
  pph21Monthly: number;

  // Cost to Company
  costToCompany: number;
}

export interface BPJSEnrollment {
  bpjsTkEnrolled: boolean;
  bpjsKesEnrolled: boolean;
  taperaEnrolled: boolean;
}

// Ambang gaji minimum kepesertaan Jaminan Pensiun
const JP_MIN_SALARY = 5_000_000;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get PTKP amount based on status
 */
export function getPTKPAmount(
  ptkpStatus: string,
  config: PayrollConfig = DEFAULT_PAYROLL_CONFIG
): number {
  const { ptkp } = config;
  switch (ptkpStatus.toUpperCase()) {
    case "TK/0": return ptkp.tk0;
    case "TK/1": return ptkp.tk1;
    case "TK/2": return ptkp.tk2;
    case "TK/3": return ptkp.tk3;
    case "K/0": return ptkp.k0;
    case "K/1": return ptkp.k1;
    case "K/2": return ptkp.k2;
    case "K/3": return ptkp.k3;
    default: return ptkp.tk0;
  }
}

/**
 * PPh 21 progresif atas penghasilan kena pajak tahunan.
 * Bracket dinyatakan sebagai LEBAR per lapisan (bukan batas kumulatif).
 */
export function calculatePPh21ETR(
  annualTaxableIncome: number,
  ptkpStatus: string,
  config: PayrollConfig = DEFAULT_PAYROLL_CONFIG
): { annual: number; monthly: number } {
  const ptkpAmount = getPTKPAmount(ptkpStatus, config);
  // PKP dibulatkan ke ribuan penuh ke bawah sesuai ketentuan DJP
  const taxableIncome = Math.floor(Math.max(0, annualTaxableIncome - ptkpAmount) / 1000) * 1000;

  let taxAmount = 0;
  let remaining = taxableIncome;

  for (const bracket of config.pph21Brackets) {
    if (remaining <= 0) break;
    const taxableInBracket = Math.min(remaining, bracket.width);
    taxAmount += taxableInBracket * bracket.rate;
    remaining -= bracket.width;
  }

  return {
    annual: Math.round(taxAmount),
    monthly: Math.round(taxAmount / 12),
  };
}

/**
 * Calculate BPJS deductions & employer contributions.
 * Tapera dihitung di sini SATU kali, mengikuti flag `taperaEnrolled`
 * (sebelumnya keliru mengikuti bpjsTkEnrolled dan terhitung ganda).
 */
export function calculateBPJS(
  monthlySalary: number,
  enrollment: BPJSEnrollment,
  config: PayrollConfig = DEFAULT_PAYROLL_CONFIG
) {
  const { bpjsTkEnrolled, bpjsKesEnrolled, taperaEnrolled } = enrollment;
  const rates = config.bpjsRates;
  const calcSalaryTk = Math.min(monthlySalary, config.bpjsCaps.bpjsTk);
  const calcSalaryKes = Math.min(monthlySalary, config.bpjsCaps.bpjsKes);

  // Employee deductions
  const bpjsTkJht = bpjsTkEnrolled ? calcSalaryTk * rates.bpjsTkJht : 0;
  const bpjsTkJp = bpjsTkEnrolled && monthlySalary >= JP_MIN_SALARY
    ? calcSalaryTk * rates.bpjsTkJp
    : 0;
  const bpjsKes = bpjsKesEnrolled ? calcSalaryKes * rates.bpjsKes : 0;
  const tapera = taperaEnrolled ? calcSalaryTk * rates.tapera : 0;

  const totalEmployee = bpjsTkJht + bpjsTkJp + bpjsKes + tapera;

  // Employer contributions
  const bpjsTkJhtEmployer = bpjsTkEnrolled ? calcSalaryTk * rates.bpjsTkJhtEmployer : 0;
  const bpjsTkJpEmployer = bpjsTkEnrolled ? calcSalaryTk * rates.bpjsTkJpEmployer : 0;
  const bpjsTkJkkEmployer = bpjsTkEnrolled ? calcSalaryTk * rates.bpjsTkJkkEmployer : 0;
  const bpjsTkJkmEmployer = bpjsTkEnrolled ? calcSalaryTk * rates.bpjsTkJkmEmployer : 0;
  const bpjsKesEmployer = bpjsKesEnrolled ? calcSalaryKes * rates.bpjsKesEmployer : 0;
  const taperaEmployer = taperaEnrolled ? calcSalaryTk * rates.taperaEmployer : 0;

  const totalEmployer = bpjsTkJhtEmployer + bpjsTkJpEmployer + bpjsTkJkkEmployer +
                        bpjsTkJkmEmployer + bpjsKesEmployer + taperaEmployer;

  return {
    employee: {
      bpjsTkJht: Math.round(bpjsTkJht),
      bpjsTkJp: Math.round(bpjsTkJp),
      bpjsKes: Math.round(bpjsKes),
      tapera: Math.round(tapera),
      total: Math.round(totalEmployee),
    },
    employer: {
      bpjsTkJht: Math.round(bpjsTkJhtEmployer),
      bpjsTkJp: Math.round(bpjsTkJpEmployer),
      bpjsTkJkk: Math.round(bpjsTkJkkEmployer),
      bpjsTkJkm: Math.round(bpjsTkJkmEmployer),
      bpjsKes: Math.round(bpjsKesEmployer),
      tapera: Math.round(taperaEmployer),
      total: Math.round(totalEmployer),
    },
  };
}

/**
 * Calculate THR prorata
 */
export function calculateTHR(
  baseSalary: number,
  joinDate: string,
  periodYear: number
): number {
  const join = new Date(joinDate);
  const currentYear = new Date(periodYear, 0, 1); // Jan 1 of period year

  // If joined before this year, full THR
  if (join < currentYear) {
    return baseSalary;
  }

  // Prorata based on months worked
  const monthsWorked = Math.floor((new Date(periodYear, 11, 31).getTime() - join.getTime()) / (1000 * 60 * 60 * 24 * 30));
  const prorata = Math.min(12, Math.max(1, monthsWorked)) / 12;

  return Math.round(baseSalary * prorata);
}

/**
 * Calculate overtime pay
 */
export function calculateOvertime(
  overtimeHours: number,
  hourlyRate: number,
  multiplier: number = DEFAULT_PAYROLL_CONFIG.overtimeMultiplier
): number {
  return Math.round(overtimeHours * hourlyRate * multiplier);
}

/**
 * Calculate unpaid leave deduction
 */
export function calculateUnpaidLeave(
  baseSalary: number,
  workingDays: number,
  unpaidLeaveDays: number
): number {
  if (workingDays <= 0) return 0;
  const dailyRate = baseSalary / workingDays;
  return Math.round(dailyRate * unpaidLeaveDays);
}

/**
 * Potongan keterlambatan sesuai kebijakan (keputusan owner: konfigurabel).
 * off → 0; per_minute → menit telat × tarif; flat → kejadian telat × tarif.
 */
export function calculateLateDeduction(
  lateMinutes: number,
  lateDays: number,
  config: PayrollConfig = DEFAULT_PAYROLL_CONFIG
): number {
  const { mode, amount } = config.lateDeduction;
  if (mode === "per_minute") return Math.round(lateMinutes * amount);
  if (mode === "flat") return Math.round(lateDays * amount);
  return 0;
}

/**
 * Biaya jabatan tahunan: persentase dari bruto, dibatasi maksimum per tahun.
 */
export function calculateJabatanExpense(
  annualGross: number,
  config: PayrollConfig = DEFAULT_PAYROLL_CONFIG
): number {
  return Math.min(
    annualGross * config.jabatanExpense.percentage,
    config.jabatanExpense.maxPerYear
  );
}

// ============================================================
// MAIN CALCULATION FUNCTION
// ============================================================

/**
 * Calculate complete payroll for an employee
 */
export async function calculatePayroll(
  input: PayrollInput,
  config: PayrollConfig = DEFAULT_PAYROLL_CONFIG
): Promise<PayrollResult> {
  const {
    fixedAllowance,
    variableAllowance = 0,
    transportAllowance = 0,
    mealAllowance = 0,
    housingAllowance = 0,
    overtimeHours = 0,
    overtimeRate = config.overtimeMultiplier,
    overtimeHolidayHours = 0,
    overtimeHolidayRate = config.overtimeHolidayMultiplier,
    bonus = 0,
    workingDays,
    lateDays = 0,
    lateMinutes = 0,
    unpaidLeaveDays = 0,
    loanDeduction = 0,
    joinDate,
    employmentStatus,
    ptkpStatus,
    isTaxable,
    bpjsTkEnrolled,
    bpjsKesEnrolled,
    taperaEnrolled,
  } = input;

  // Proraté masuk/keluar tengah periode: komponen bulanan tetap dibayar
  // sebesar porsi cakupan kontrak. Gaji penuh tetap dipakai untuk THR
  // (hak tahunan) dan tarif per jam lembur.
  const prorateFactor = Math.min(1, Math.max(0, input.prorateFactor ?? 1));
  const fullBaseSalary = input.baseSalary;
  const baseSalary = Math.round(fullBaseSalary * prorateFactor);

  // ========== EARNINGS ==========

  // Upah per jam lembur = gaji pokok penuh / pembagi (Kepmenaker: 173).
  const hourlyRate =
    config.overtimeHourlyDivisor > 0
      ? fullBaseSalary / config.overtimeHourlyDivisor
      : 0;
  // Lembur hari libur resmi dibayar dengan multiplier terpisah (PP 35/2021 —
  // 2× vs 1,5×). Dijumlahkan, bukan menggantikan: satu periode bisa memuat
  // keduanya. Tanpa jam libur, hasilnya identik dengan sebelum EPIC-036 Fase F.
  const overtimePay =
    calculateOvertime(overtimeHours, hourlyRate, overtimeRate) +
    calculateOvertime(overtimeHolidayHours, hourlyRate, overtimeHolidayRate);

  // Kelayakan THR (Fase C): karyawan ber-kontrak aktif (PKWT ATAU PKWTT —
  // keduanya berhak THR per Permenaker 6/2016). Karyawan tanpa record
  // kontrak memakai aturan lama (employment_status permanent).
  const thrEligible =
    input.contractType != null || employmentStatus === 'permanent';
  const thr = (input.includeThr && thrEligible)
    ? calculateTHR(fullBaseSalary, joinDate, input.periodYear)
    : 0;

  // Tunjangan bulanan ikut proraté (bonus/lembur/THR tidak)
  const paidFixedAllowance = Math.round(fixedAllowance * prorateFactor);
  const paidVariableAllowance = Math.round(variableAllowance * prorateFactor);
  const paidTransportAllowance = Math.round(transportAllowance * prorateFactor);
  const paidMealAllowance = Math.round(mealAllowance * prorateFactor);
  const paidHousingAllowance = Math.round(housingAllowance * prorateFactor);

  // Total gross salary
  const grossSalary =
    baseSalary +
    paidFixedAllowance +
    paidVariableAllowance +
    paidTransportAllowance +
    paidMealAllowance +
    paidHousingAllowance +
    overtimePay +
    thr +
    bonus;

  // ========== DEDUCTIONS ==========

  // BPJS + Tapera dihitung sekali dari basis gaji tetap yang DIBAYAR
  // (base + fixed, sudah proraté)
  const bpjsResult = calculateBPJS(
    baseSalary + paidFixedAllowance,
    { bpjsTkEnrolled, bpjsKesEnrolled, taperaEnrolled },
    config
  );
  const taperaDeduction = bpjsResult.employee.tapera;

  // Unpaid leave deduction
  const unpaidLeaveDeduction = calculateUnpaidLeave(baseSalary, workingDays, unpaidLeaveDays);

  // Potongan keterlambatan (konfigurabel; nonaktif by default)
  const lateDeduction = calculateLateDeduction(lateMinutes, lateDays, config);

  // Penghasilan neto tahunan untuk PPh21:
  // bruto − iuran karyawan (BPJS + Tapera) − biaya jabatan
  const annualGross = grossSalary * 12;
  const annualContributions = bpjsResult.employee.total * 12;
  const jabatanExpense = calculateJabatanExpense(annualGross, config);
  const annualTaxableIncome = Math.max(
    0,
    annualGross - annualContributions - jabatanExpense
  );

  // PPh 21 calculation
  let pph21Annual = 0;
  let pph21Deduction = 0;
  if (isTaxable) {
    const pph21Result = calculatePPh21ETR(annualTaxableIncome, ptkpStatus, config);
    pph21Annual = pph21Result.annual;
    pph21Deduction = pph21Result.monthly;
  }

  // Total deductions
  const totalDeductions =
    bpjsResult.employee.bpjsTkJht +
    bpjsResult.employee.bpjsTkJp +
    bpjsResult.employee.bpjsKes +
    taperaDeduction +
    pph21Deduction +
    unpaidLeaveDeduction +
    lateDeduction +
    loanDeduction;

  // Net salary (take home pay)
  const netSalary = grossSalary - totalDeductions;

  // ========== EMPLOYER CONTRIBUTIONS ==========

  const totalEmployerContribution = bpjsResult.employer.total;

  // Cost to Company
  const costToCompany = grossSalary + totalEmployerContribution;

  // ========== RETURN RESULT ==========

  return {
    // Earnings (nilai yang dibayar — sudah proraté bila kontrak parsial)
    baseSalary: Math.round(baseSalary),
    fixedAllowance: paidFixedAllowance,
    variableAllowance: paidVariableAllowance,
    transportAllowance: paidTransportAllowance,
    mealAllowance: paidMealAllowance,
    housingAllowance: paidHousingAllowance,
    overtimePay: Math.round(overtimePay),
    thr: Math.round(thr),
    bonus: Math.round(bonus),
    otherEarning: 0,
    grossSalary: Math.round(grossSalary),

    // Deductions (Employee)
    bpjsTkJhtDeduction: bpjsResult.employee.bpjsTkJht,
    bpjsTkJpDeduction: bpjsResult.employee.bpjsTkJp,
    bpjsKesDeduction: bpjsResult.employee.bpjsKes,
    taperaDeduction: Math.round(taperaDeduction),
    pph21Deduction: Math.round(pph21Deduction),
    unpaidLeaveDeduction: Math.round(unpaidLeaveDeduction),
    lateDeduction: Math.round(lateDeduction),
    loanDeduction: Math.round(loanDeduction),
    otherDeduction: 0,
    totalDeductions: Math.round(totalDeductions),

    // Attendance snapshot
    overtimeHours,

    // Net
    netSalary: Math.round(netSalary),

    // Employer Contributions
    bpjsTkJhtEmployer: bpjsResult.employer.bpjsTkJht,
    bpjsTkJpEmployer: bpjsResult.employer.bpjsTkJp,
    bpjsTkJkkEmployer: bpjsResult.employer.bpjsTkJkk,
    bpjsTkJkmEmployer: bpjsResult.employer.bpjsTkJkm,
    bpjsKesEmployer: bpjsResult.employer.bpjsKes,
    taperaEmployer: bpjsResult.employer.tapera,
    totalEmployerContribution: Math.round(totalEmployerContribution),

    // Tax Details
    taxableIncome: Math.round(annualTaxableIncome),
    ptkpAmount: getPTKPAmount(ptkpStatus, config),
    pph21Annual: Math.round(pph21Annual),
    pph21Monthly: Math.round(pph21Deduction),

    // Cost to Company
    costToCompany: Math.round(costToCompany),
  };
}
