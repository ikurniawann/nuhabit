import { describe, it, expect } from "vitest";
import {
  isLoanDue,
  loanDeductionForPeriod,
  loanInstallmentDetails,
  allocateLoanPayment,
  validateLoanLimits,
  computeLoanTerms,
  firstInstallmentPeriod,
  type LoanDeductionRow,
} from "./loans";

function loan(overrides: Partial<LoanDeductionRow> = {}): LoanDeductionRow {
  return {
    id: "loan-1",
    monthly_installment: 500_000,
    remaining_balance: 3_000_000,
    first_installment_month: 6,
    first_installment_year: 2026,
    status: "approved",
    is_active: true,
    ...overrides,
  };
}

describe("isLoanDue", () => {
  it("is due from the first installment period onward", () => {
    expect(isLoanDue(loan(), 6, 2026)).toBe(true);
    expect(isLoanDue(loan(), 12, 2026)).toBe(true);
    expect(isLoanDue(loan(), 1, 2027)).toBe(true);
  });

  it("is not due before the first installment period", () => {
    expect(isLoanDue(loan(), 5, 2026)).toBe(false);
    expect(isLoanDue(loan({ first_installment_year: 2027 }), 12, 2026)).toBe(false);
  });

  it("is not due when pending/rejected/inactive/zero balance/missing schedule", () => {
    expect(isLoanDue(loan({ status: "pending" }), 6, 2026)).toBe(false);
    expect(isLoanDue(loan({ is_active: false }), 6, 2026)).toBe(false);
    expect(isLoanDue(loan({ remaining_balance: 0 }), 6, 2026)).toBe(false);
    expect(isLoanDue(loan({ first_installment_month: null }), 6, 2026)).toBe(false);
  });
});

describe("loanDeductionForPeriod", () => {
  it("sums installments across due loans", () => {
    const total = loanDeductionForPeriod(
      [loan(), loan({ id: "loan-2", monthly_installment: 250_000 })],
      6,
      2026
    );
    expect(total).toBe(750_000);
  });

  it("caps the last installment at the remaining balance", () => {
    const total = loanDeductionForPeriod(
      [loan({ remaining_balance: 200_000 })],
      6,
      2026
    );
    expect(total).toBe(200_000);
  });

  it("ignores loans not yet due", () => {
    const total = loanDeductionForPeriod(
      [loan({ first_installment_month: 8 })],
      6,
      2026
    );
    expect(total).toBe(0);
  });
});

describe("allocateLoanPayment", () => {
  it("allocates the deducted amount oldest-first, one installment per loan", () => {
    const allocations = allocateLoanPayment(
      [
        loan({ id: "old", monthly_installment: 500_000, remaining_balance: 1_000_000 }),
        loan({ id: "new", monthly_installment: 300_000, remaining_balance: 900_000 }),
      ],
      800_000
    );
    expect(allocations).toEqual([
      { loanId: "old", amount: 500_000, newRemaining: 500_000, paidOff: false },
      { loanId: "new", amount: 300_000, newRemaining: 600_000, paidOff: false },
    ]);
  });

  it("marks a loan paid off when the balance reaches zero", () => {
    const allocations = allocateLoanPayment(
      [loan({ remaining_balance: 400_000, monthly_installment: 500_000 })],
      400_000
    );
    expect(allocations).toEqual([
      { loanId: "loan-1", amount: 400_000, newRemaining: 0, paidOff: true },
    ]);
  });

  it("never allocates more than the deducted amount (stale slip guard)", () => {
    const allocations = allocateLoanPayment(
      [
        loan({ id: "a", monthly_installment: 500_000 }),
        loan({ id: "b", monthly_installment: 500_000 }),
      ],
      600_000
    );
    expect(allocations.reduce((acc, a) => acc + a.amount, 0)).toBe(600_000);
    expect(allocations[1]).toMatchObject({ loanId: "b", amount: 100_000 });
  });
});

describe("validateLoanLimits", () => {
  const base = {
    monthlyInstallment: 2_000_000,
    baseSalary: 10_000_000,
    maxInstallmentPercent: 30,
    activeLoanCount: 0,
    maxActiveLoans: 1,
  };

  it("passes within limits", () => {
    expect(validateLoanLimits(base)).toBeNull();
  });

  it("rejects installment above percent-of-salary cap", () => {
    expect(
      validateLoanLimits({ ...base, monthlyInstallment: 3_500_000 })
    ).toMatch(/melebihi batas 30%/);
  });

  it("rejects when active loan count reaches the max", () => {
    expect(validateLoanLimits({ ...base, activeLoanCount: 1 })).toMatch(
      /pinjaman aktif/
    );
  });

  it("rejects when employee has no active salary structure", () => {
    expect(validateLoanLimits({ ...base, baseSalary: null })).toMatch(
      /struktur gaji/
    );
  });
});

describe("loanInstallmentDetails", () => {
  const base = {
    id: "loan-1",
    loan_type: "kasbon",
    principal_amount: 3_000_000,
    monthly_installment: 1_000_000,
    tenor_months: 3,
    first_installment_month: 1,
    first_installment_year: 2026,
    status: "approved",
    is_active: true,
  };

  it("menomori angsuran dari pokok yang sudah terbayar", () => {
    const belum = loanInstallmentDetails([{ ...base, remaining_balance: 3_000_000 }], 1, 2026);
    expect(belum[0].installment_no).toBe(1);

    const sekali = loanInstallmentDetails([{ ...base, remaining_balance: 2_000_000 }], 2, 2026);
    expect(sekali[0].installment_no).toBe(2);

    const duaKali = loanInstallmentDetails([{ ...base, remaining_balance: 1_000_000 }], 3, 2026);
    expect(duaKali[0].installment_no).toBe(3);
    expect(duaKali[0].tenor_months).toBe(3);
  });

  it("tidak memotong melebihi sisa pinjaman pada angsuran terakhir", () => {
    const detail = loanInstallmentDetails([{ ...base, remaining_balance: 400_000 }], 3, 2026);
    expect(detail[0].amount).toBe(400_000);
    expect(detail[0].remaining_after).toBe(0);
  });

  it("mengabaikan pinjaman yang belum jatuh tempo", () => {
    const detail = loanInstallmentDetails(
      [{ ...base, remaining_balance: 3_000_000, first_installment_month: 5 }],
      2,
      2026
    );
    expect(detail).toHaveLength(0);
  });

  it("tetap benar walau satu periode terlewat (payroll telat dijalankan)", () => {
    // Sisa 1jt dari pokok 3jt berarti 2 angsuran sudah terbayar, sehingga
    // periode ini adalah angsuran ke-3: bukan ke-4 meski bulannya lompat.
    const detail = loanInstallmentDetails([{ ...base, remaining_balance: 1_000_000 }], 6, 2026);
    expect(detail[0].installment_no).toBe(3);
  });

  it("merinci setiap pinjaman saat karyawan punya lebih dari satu", () => {
    const detail = loanInstallmentDetails(
      [
        { ...base, remaining_balance: 3_000_000 },
        { ...base, id: "loan-2", loan_type: "darurat", remaining_balance: 500_000 },
      ],
      2,
      2026
    );
    expect(detail).toHaveLength(2);
    expect(detail.map((d) => d.loan_id)).toEqual(["loan-1", "loan-2"]);
  });
});

describe("computeLoanTerms (rumus lama dari route pengajuan pinjaman)", () => {
  it("tanpa bunga: pokok dibagi tenor", () => {
    expect(computeLoanTerms({ principal: 3_000_000, ratePercent: 0, tenorMonths: 3 })).toEqual({
      rawInstallment: 1_000_000,
      monthlyInstallment: 1_000_000,
      totalRepayment: 3_000_000,
    });
  });

  it("bunga flat: total = cicilan bulat × tenor", () => {
    const terms = computeLoanTerms({ principal: 1_000_000, ratePercent: 2, tenorMonths: 3 });
    // 1.000.000 × (1 + 0,02 × 3) / 3 = 353.333,33…
    expect(terms.rawInstallment).toBeCloseTo(353_333.333, 2);
    expect(terms.monthlyInstallment).toBe(353_333);
    expect(terms.totalRepayment).toBe(1_059_999);
  });

  it("pembulatan cicilan tanpa bunga", () => {
    const terms = computeLoanTerms({ principal: 1_000_000, ratePercent: 0, tenorMonths: 3 });
    expect(terms.monthlyInstallment).toBe(333_333);
    expect(terms.totalRepayment).toBe(999_999);
  });
});

describe("firstInstallmentPeriod", () => {
  it("bulan berikutnya", () => {
    expect(firstInstallmentPeriod(new Date(2026, 4, 20))).toEqual({ month: 6, year: 2026 });
  });
  it("Desember → Januari tahun depan", () => {
    expect(firstInstallmentPeriod(new Date(2026, 11, 31))).toEqual({ month: 1, year: 2027 });
  });
});
