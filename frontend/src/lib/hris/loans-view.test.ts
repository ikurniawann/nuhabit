import { describe, expect, it } from "vitest";
import {
  EMPTY_LOAN_FORM,
  employeeComboOptions,
  loanPaidPercent,
  loanPayload,
  loanSummary,
  loanTypeLabel,
  previewInstallment,
  validateLoanForm,
} from "./loans-view";

describe("loanTypeLabel", () => {
  it("label dikenal dan fallback ke kode", () => {
    expect(loanTypeLabel("kasbon")).toBe("Kasbon (Salary Advance)");
    expect(loanTypeLabel("lain")).toBe("lain");
  });
});

describe("employeeComboOptions", () => {
  it("menambahkan NIP bila ada", () => {
    expect(
      employeeComboOptions([
        { id: "1", full_name: "Ani", nip: "007" },
        { id: "2", full_name: "Budi", nip: null },
      ])
    ).toEqual([
      { value: "1", label: "Ani (007)" },
      { value: "2", label: "Budi" },
    ]);
  });
});

describe("previewInstallment", () => {
  it("tanpa bunga: pokok dibagi tenor, dibulatkan", () => {
    expect(previewInstallment({ ...EMPTY_LOAN_FORM, principal_amount: "1000000", tenor_months: "3" })).toBe(
      333_333
    );
  });

  it("bunga flat per bulan", () => {
    expect(
      previewInstallment({
        ...EMPTY_LOAN_FORM,
        principal_amount: "1000000",
        tenor_months: "10",
        interest_rate: "1",
      })
    ).toBe(110_000);
  });

  it("null bila pokok atau tenor kosong", () => {
    expect(previewInstallment(EMPTY_LOAN_FORM)).toBeNull();
    expect(previewInstallment({ ...EMPTY_LOAN_FORM, principal_amount: "500", tenor_months: "" })).toBeNull();
  });
});

describe("validateLoanForm & loanPayload", () => {
  it("karyawan wajib, lalu jumlah dan tenor", () => {
    expect(validateLoanForm(EMPTY_LOAN_FORM)).toBe("Pilih karyawan");
    expect(validateLoanForm({ ...EMPTY_LOAN_FORM, employee_id: "e1" })).toBe(
      "Jumlah pinjaman dan tenor wajib diisi"
    );
    expect(validateLoanForm({ ...EMPTY_LOAN_FORM, employee_id: "e1", principal_amount: "100" })).toBeNull();
  });

  it("payload berisi angka dan keperluan kosong dihilangkan", () => {
    expect(
      loanPayload({ ...EMPTY_LOAN_FORM, employee_id: "e1", principal_amount: "100", interest_rate: "" })
    ).toEqual({
      employee_id: "e1",
      loan_type: "kasbon",
      principal_amount: 100,
      interest_rate: 0,
      tenor_months: 3,
      purpose: undefined,
    });
  });
});

describe("ringkasan & progres", () => {
  it("menghitung pending dan sisa pinjaman berjalan", () => {
    expect(
      loanSummary([
        { status: "pending", remaining_balance: "500" },
        { status: "approved", remaining_balance: "1000" },
        { status: "approved", remaining_balance: 250 },
        { status: "paid_off", remaining_balance: 0 },
      ])
    ).toEqual({ pendingCount: 1, activeTotal: 1250 });
  });

  it("persentase terbayar dibulatkan dan aman saat total 0", () => {
    expect(loanPaidPercent({ paid_amount: "1", remaining_balance: "2" })).toBe(33);
    expect(loanPaidPercent({ paid_amount: 0, remaining_balance: 0 })).toBe(0);
    expect(loanPaidPercent({ paid_amount: 100, remaining_balance: 0 })).toBe(100);
  });
});
