import { describe, it, expect } from "vitest";
import {
  calculatePayroll,
  calculatePPh21ETR,
  calculateBPJS,
  calculateTHR,
  calculateOvertime,
  calculateUnpaidLeave,
  calculateJabatanExpense,
  getPTKPAmount,
  type PayrollInput,
} from "./calculator";
import {
  cumulativeLimitsToBrackets,
  DEFAULT_PAYROLL_CONFIG,
} from "./config";

const ALL_ENROLLED = {
  bpjsTkEnrolled: true,
  bpjsKesEnrolled: true,
  taperaEnrolled: true,
};

function baseInput(overrides: Partial<PayrollInput> = {}): PayrollInput {
  return {
    employeeId: "emp-1",
    periodMonth: 6,
    periodYear: 2026,
    baseSalary: 10_000_000,
    fixedAllowance: 2_000_000,
    workingDays: 22,
    presentDays: 22,
    joinDate: "2024-01-15",
    employmentStatus: "permanent",
    ptkpStatus: "TK/0",
    isTaxable: true,
    ...ALL_ENROLLED,
    ...overrides,
  };
}

describe("getPTKPAmount", () => {
  it("returns correct PTKP for each status", () => {
    expect(getPTKPAmount("TK/0")).toBe(54_000_000);
    expect(getPTKPAmount("K/3")).toBe(72_000_000);
    expect(getPTKPAmount("k/1")).toBe(63_000_000);
  });

  it("falls back to TK/0 for unknown status", () => {
    expect(getPTKPAmount("X/9")).toBe(54_000_000);
  });
});

describe("cumulativeLimitsToBrackets", () => {
  it("converts cumulative limits (as stored in DB) to bracket widths", () => {
    const brackets = cumulativeLimitsToBrackets(
      [60_000_000, 250_000_000, 500_000_000, 5_000_000_000],
      [0.05, 0.15, 0.25, 0.3, 0.35]
    );
    expect(brackets).toEqual([
      { width: 60_000_000, rate: 0.05 },
      { width: 190_000_000, rate: 0.15 },
      { width: 250_000_000, rate: 0.25 },
      { width: 4_500_000_000, rate: 0.3 },
      { width: Infinity, rate: 0.35 },
    ]);
  });
});

describe("calculatePPh21ETR", () => {
  it("computes progressive tax across brackets (reference case)", () => {
    // Neto tahunan 120jt, TK/0 → PKP 66jt → 60jt×5% + 6jt×15% = 3.9jt
    const result = calculatePPh21ETR(120_000_000, "TK/0");
    expect(result.annual).toBe(3_900_000);
    expect(result.monthly).toBe(325_000);
  });

  it("stays in first bracket at exactly 60jt PKP", () => {
    // 114jt − PTKP 54jt = PKP tepat 60jt → 3jt (semua lapisan pertama)
    const result = calculatePPh21ETR(114_000_000, "TK/0");
    expect(result.annual).toBe(3_000_000);
  });

  it("returns zero when income below PTKP", () => {
    const result = calculatePPh21ETR(50_000_000, "TK/0");
    expect(result.annual).toBe(0);
    expect(result.monthly).toBe(0);
  });

  it("rounds PKP down to full thousands (ketentuan DJP)", () => {
    // PKP 500 rupiah → dibulatkan ke 0 → pajak 0
    const result = calculatePPh21ETR(54_000_500, "TK/0");
    expect(result.annual).toBe(0);
  });

  it("crosses all brackets for very high income", () => {
    // PKP = 6M (di atas 5M): 3jt + 28.5jt + 62.5jt + 1.35B + (6M−5M... )
    // width: 60jt(5%)+190jt(15%)+250jt(25%)+4.5B(30%)+sisanya 35%
    // PKP 6.054B → sisa lapisan 5: 6.054B − 5B = 1.054B × 35% = 368.9jt
    const pkp = 6_054_000_000;
    const result = calculatePPh21ETR(pkp + 54_000_000, "TK/0");
    const expected =
      60_000_000 * 0.05 +
      190_000_000 * 0.15 +
      250_000_000 * 0.25 +
      4_500_000_000 * 0.3 +
      (pkp - 5_000_000_000) * 0.35;
    expect(result.annual).toBe(Math.round(expected));
  });
});

describe("calculateBPJS", () => {
  it("applies BPJS TK cap on high salary", () => {
    const result = calculateBPJS(20_000_000, ALL_ENROLLED);
    // JHT 2% dari cap 10.414.000
    expect(result.employee.bpjsTkJht).toBe(208_280);
    // Kes 1% dari cap 12.000.000
    expect(result.employee.bpjsKes).toBe(120_000);
  });

  it("skips JP below 5jt salary threshold", () => {
    const result = calculateBPJS(4_000_000, ALL_ENROLLED);
    expect(result.employee.bpjsTkJp).toBe(0);
    expect(result.employee.bpjsTkJht).toBe(80_000);
  });

  it("gates tapera on taperaEnrolled, not bpjsTkEnrolled (regression)", () => {
    const noTapera = calculateBPJS(10_000_000, {
      ...ALL_ENROLLED,
      taperaEnrolled: false,
    });
    expect(noTapera.employee.tapera).toBe(0);
    expect(noTapera.employer.tapera).toBe(0);
    expect(noTapera.employee.bpjsTkJht).toBeGreaterThan(0);

    const onlyTapera = calculateBPJS(10_000_000, {
      bpjsTkEnrolled: false,
      bpjsKesEnrolled: false,
      taperaEnrolled: true,
    });
    expect(onlyTapera.employee.tapera).toBe(250_000);
    expect(onlyTapera.employee.bpjsTkJht).toBe(0);
  });

  it("zeroes everything when nothing enrolled", () => {
    const result = calculateBPJS(10_000_000, {
      bpjsTkEnrolled: false,
      bpjsKesEnrolled: false,
      taperaEnrolled: false,
    });
    expect(result.employee.total).toBe(0);
    expect(result.employer.total).toBe(0);
  });
});

describe("calculateTHR", () => {
  it("gives full THR when joined before the period year", () => {
    expect(calculateTHR(10_000_000, "2024-03-01", 2026)).toBe(10_000_000);
  });

  it("prorates THR for mid-year join", () => {
    // Join 1 Juli 2026 → ±6 bulan kerja → ±setengah gaji
    const thr = calculateTHR(12_000_000, "2026-07-01", 2026);
    expect(thr).toBeGreaterThan(5_000_000);
    expect(thr).toBeLessThan(7_000_000);
  });
});

describe("calculateOvertime / calculateUnpaidLeave / calculateJabatanExpense", () => {
  it("computes overtime with multiplier", () => {
    expect(calculateOvertime(10, 50_000, 1.5)).toBe(750_000);
  });

  it("computes unpaid leave from daily rate", () => {
    expect(calculateUnpaidLeave(11_000_000, 22, 2)).toBe(1_000_000);
  });

  it("returns zero unpaid leave deduction when workingDays is 0", () => {
    expect(calculateUnpaidLeave(11_000_000, 0, 2)).toBe(0);
  });

  it("caps biaya jabatan at yearly max", () => {
    // 5% × 144jt = 7.2jt > cap 6jt
    expect(calculateJabatanExpense(144_000_000)).toBe(6_000_000);
    // 5% × 60jt = 3jt < cap
    expect(calculateJabatanExpense(60_000_000)).toBe(3_000_000);
  });
});

describe("calculatePayroll (integration)", () => {
  it("computes full payroll for the reference employee", async () => {
    // base 10jt + fixed 2jt, TK/0, semua terdaftar
    const result = await calculatePayroll(baseInput());

    expect(result.grossSalary).toBe(12_000_000);
    // Iuran karyawan atas basis 12jt (TK di-cap 10.414.000)
    expect(result.bpjsTkJhtDeduction).toBe(208_280);
    expect(result.bpjsTkJpDeduction).toBe(104_140);
    expect(result.bpjsKesDeduction).toBe(120_000);
    expect(result.taperaDeduction).toBe(260_350);
    // Neto tahunan = 144jt − 8.313.240 − biaya jabatan 6jt = 129.686.760
    expect(result.taxableIncome).toBe(129_686_760);
    // PKP 75.686.000 → 3jt + 15.686.000×15% = 5.352.900 / tahun
    expect(result.pph21Annual).toBe(5_352_900);
    expect(result.pph21Deduction).toBe(446_075);
    expect(result.totalDeductions).toBe(1_138_845);
    expect(result.netSalary).toBe(10_861_155);
  });

  it("does not double-count tapera in taxable income (regression)", async () => {
    const withTapera = await calculatePayroll(baseInput());
    const withoutTapera = await calculatePayroll(
      baseInput({ taperaEnrolled: false })
    );
    // Selisih penghasilan neto tahunan = tepat 12× iuran tapera bulanan
    expect(withoutTapera.taxableIncome - withTapera.taxableIncome).toBe(
      withTapera.taperaDeduction * 12
    );
  });

  it("skips PPh21 when not taxable", async () => {
    const result = await calculatePayroll(baseInput({ isTaxable: false }));
    expect(result.pph21Deduction).toBe(0);
    expect(result.pph21Annual).toBe(0);
  });

  it("includes THR only for permanent employees with includeThr", async () => {
    const withThr = await calculatePayroll(baseInput({ includeThr: true }));
    expect(withThr.thr).toBe(10_000_000);

    const probation = await calculatePayroll(
      baseInput({ includeThr: true, employmentStatus: "probation" })
    );
    expect(probation.thr).toBe(0);

    const noFlag = await calculatePayroll(baseInput());
    expect(noFlag.thr).toBe(0);
  });

  it("deducts unpaid leave days", async () => {
    const result = await calculatePayroll(
      baseInput({ unpaidLeaveDays: 2, workingDays: 20 })
    );
    expect(result.unpaidLeaveDeduction).toBe(1_000_000);
  });

  it("uses config overrides instead of defaults", async () => {
    const config = {
      ...DEFAULT_PAYROLL_CONFIG,
      bpjsRates: { ...DEFAULT_PAYROLL_CONFIG.bpjsRates, bpjsTkJht: 0.04 },
    };
    const result = await calculatePayroll(baseInput(), config);
    // 4% dari cap 10.414.000
    expect(result.bpjsTkJhtDeduction).toBe(416_560);
  });

  it("pays overtime at baseSalary/173 × multiplier (Kepmenaker)", async () => {
    const result = await calculatePayroll(baseInput({ overtimeHours: 10 }));
    // 10jt/173 = 57.803,47 × 10 jam × 1.5 = 867.052
    expect(result.overtimePay).toBe(867_052);
    expect(result.overtimeHours).toBe(10);
  });

  it("applies no late deduction when mode off (default)", async () => {
    const result = await calculatePayroll(
      baseInput({ lateDays: 3, lateMinutes: 45 })
    );
    expect(result.lateDeduction).toBe(0);
  });

  it("applies per-minute late deduction", async () => {
    const config = {
      ...DEFAULT_PAYROLL_CONFIG,
      lateDeduction: { mode: "per_minute" as const, amount: 1000 },
    };
    const result = await calculatePayroll(
      baseInput({ lateDays: 3, lateMinutes: 45 }),
      config
    );
    expect(result.lateDeduction).toBe(45_000);
    // masuk total potongan → mengurangi take-home
    const baseline = await calculatePayroll(baseInput(), config);
    expect(baseline.netSalary - result.netSalary).toBe(45_000);
  });

  it("applies flat per-occurrence late deduction", async () => {
    const config = {
      ...DEFAULT_PAYROLL_CONFIG,
      lateDeduction: { mode: "flat" as const, amount: 25_000 },
    };
    const result = await calculatePayroll(
      baseInput({ lateDays: 3, lateMinutes: 45 }),
      config
    );
    expect(result.lateDeduction).toBe(75_000);
  });
});

// EPIC-036 Fase F — lembur di hari libur resmi dibayar dengan multiplier
// terpisah (PP 35/2021: 2× vs 1,5×).
describe("calculatePayroll — lembur hari libur (EPIC-036 Fase F)", () => {
  // upah sejam = 10.000.000 / 173 = 57.803,47
  const HOURLY = 10_000_000 / 173;

  it("jam hari kerja tetap memakai multiplier 1,5×", async () => {
    const result = await calculatePayroll(baseInput({ overtimeHours: 4 }));
    expect(result.overtimePay).toBe(Math.round(4 * HOURLY * 1.5));
  });

  it("jam hari libur memakai multiplier 2×", async () => {
    const result = await calculatePayroll(baseInput({ overtimeHolidayHours: 4 }));
    expect(result.overtimePay).toBe(Math.round(4 * HOURLY * 2));
  });

  it("periode bercampur menjumlahkan kedua tarif", async () => {
    const result = await calculatePayroll(
      baseInput({ overtimeHours: 3, overtimeHolidayHours: 2 })
    );
    expect(result.overtimePay).toBe(
      Math.round(3 * HOURLY * 1.5) + Math.round(2 * HOURLY * 2)
    );
  });

  it("tanpa jam hari libur, hasilnya identik dengan sebelum fase ini", async () => {
    const sesudah = await calculatePayroll(baseInput({ overtimeHours: 5 }));
    const eksplisitNol = await calculatePayroll(
      baseInput({ overtimeHours: 5, overtimeHolidayHours: 0 })
    );
    expect(sesudah.netSalary).toBe(eksplisitNol.netSalary);
    expect(sesudah.overtimePay).toBe(Math.round(5 * HOURLY * 1.5));
  });

  it("multiplier hari libur bisa ditimpa per pengajuan", async () => {
    const result = await calculatePayroll(
      baseInput({ overtimeHolidayHours: 2, overtimeHolidayRate: 3 })
    );
    expect(result.overtimePay).toBe(Math.round(2 * HOURLY * 3));
  });
});

describe("calculatePayroll — kontrak (Fase C)", () => {
  it("prorates monthly components for partial contract coverage", async () => {
    const result = await calculatePayroll(
      baseInput({
        prorateFactor: 0.5,
        contractType: "pkwt",
        transportAllowance: 500_000,
      })
    );
    expect(result.baseSalary).toBe(5_000_000);
    expect(result.fixedAllowance).toBe(1_000_000);
    expect(result.transportAllowance).toBe(250_000);
    // BPJS mengikuti gaji yang dibayar (6jt, di bawah cap): JHT 2% = 120rb
    expect(result.bpjsTkJhtDeduction).toBe(120_000);
  });

  it("keeps overtime hourly rate on FULL base salary despite proration", async () => {
    const half = await calculatePayroll(
      baseInput({ prorateFactor: 0.5, contractType: "pkwt", overtimeHours: 10 })
    );
    const full = await calculatePayroll(baseInput({ overtimeHours: 10 }));
    expect(half.overtimePay).toBe(full.overtimePay);
  });

  it("computes THR from FULL base salary even when prorated", async () => {
    const result = await calculatePayroll(
      baseInput({ prorateFactor: 0.5, contractType: "pkwtt", includeThr: true })
    );
    expect(result.thr).toBe(10_000_000);
  });

  it("makes PKWT employees THR-eligible via contract (bukan magic string)", async () => {
    const result = await calculatePayroll(
      baseInput({
        includeThr: true,
        contractType: "pkwt",
        employmentStatus: "contract",
      })
    );
    expect(result.thr).toBe(10_000_000);
  });

  it("falls back to legacy permanent rule when no contract record", async () => {
    const probation = await calculatePayroll(
      baseInput({ includeThr: true, contractType: null, employmentStatus: "probation" })
    );
    expect(probation.thr).toBe(0);

    const permanent = await calculatePayroll(
      baseInput({ includeThr: true, contractType: null, employmentStatus: "permanent" })
    );
    expect(permanent.thr).toBe(10_000_000);
  });

  it("deducts loan installment from net salary (Fase D)", async () => {
    const withLoan = await calculatePayroll(baseInput({ loanDeduction: 500_000 }));
    const baseline = await calculatePayroll(baseInput());
    expect(withLoan.loanDeduction).toBe(500_000);
    expect(baseline.netSalary - withLoan.netSalary).toBe(500_000);
    // Cicilan bukan pengurang pajak — PPh21 tidak berubah
    expect(withLoan.pph21Deduction).toBe(baseline.pph21Deduction);
  });

  it("treats prorateFactor 1 as a no-op (regression vs Fase A/B numbers)", async () => {
    const explicit = await calculatePayroll(baseInput({ prorateFactor: 1 }));
    const implicit = await calculatePayroll(baseInput());
    expect(explicit).toEqual(implicit);
    expect(implicit.netSalary).toBe(10_861_155);
  });
});
