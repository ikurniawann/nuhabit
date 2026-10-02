import { describe, expect, it } from "vitest";
import {
  allocateCreditValue,
  breakageOnExpiry,
  computeValidUntil,
  effectivePassStatus,
  generatePassCode,
  isValueSplitValid,
  outstandingLiability,
  redeemValue,
  remainingCreditValue,
  suggestValueSplit,
} from "./pass";

describe("allocateCreditValue", () => {
  it("membagi nilai per kredit tanpa selisih pembulatan", () => {
    const parts = [0, 1, 2].map((used) => allocateCreditValue(1_000_000, 3, used));
    expect(parts).toEqual([333_333.33, 333_333.34, 333_333.33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1_000_000, 2);
  });

  it("mendukung redeem beberapa kredit sekaligus dan berhenti di batas kredit", () => {
    expect(allocateCreditValue(700_000, 7, 0, 2)).toBe(200_000);
    expect(allocateCreditValue(700_000, 7, 6, 5)).toBe(100_000);
    expect(allocateCreditValue(700_000, 7, 7)).toBe(0);
    expect(allocateCreditValue(500_000, 0, 0)).toBe(0);
  });

  it("menghitung sisa nilai", () => {
    expect(remainingCreditValue(900_000, 3, 1)).toBe(600_000);
    expect(remainingCreditValue(900_000, 3, 3)).toBe(0);
  });
});

describe("pembagian nilai paket", () => {
  it("mengusulkan pembagian rata per sesi", () => {
    expect(suggestValueSplit(1_200_000, 7, 0, false)).toEqual({ class_value: 1_200_000, pt_value: 0, facility_value: 0 });
    expect(suggestValueSplit(1_000_000, 3, 1, true)).toEqual({ class_value: 750_000, pt_value: 250_000, facility_value: 0 });
    expect(suggestValueSplit(300_000, 0, 0, true)).toEqual({ class_value: 0, pt_value: 0, facility_value: 300_000 });
  });

  it("memvalidasi total dan kecocokan kredit", () => {
    const base = { price: 1_000_000, class_credits: 3, pt_credits: 1, facility_access: false };
    expect(isValueSplitValid({ ...base, class_value: 750_000, pt_value: 250_000, facility_value: 0 })).toBeNull();
    expect(isValueSplitValid({ ...base, class_value: 700_000, pt_value: 250_000, facility_value: 0 })).toMatch(/sama dengan harga/);
    expect(isValueSplitValid({ ...base, class_value: 750_000, pt_value: 0, facility_value: 250_000 })).toMatch(/facility/);
    expect(isValueSplitValid({ ...base, class_credits: 0, pt_credits: 0, class_value: 0, pt_value: 0, facility_value: 1_000_000 })).toMatch(/kredit kelas/);
  });
});

describe("masa berlaku & status", () => {
  const balance = { class_total: 3, pt_total: 0, class_used: 0, pt_used: 0 };
  const pass = { status: "active" as const, valid_from: "2026-10-05", valid_until: "2026-10-18", facility_access: false };

  it("3x dalam 2 minggu berakhir hari ke-14, freeze memperpanjang", () => {
    expect(computeValidUntil("2026-10-05", 14)).toBe("2026-10-18");
    expect(computeValidUntil("2026-10-05", 14, 7)).toBe("2026-10-25");
  });

  it("menentukan status efektif dari tanggal dan saldo", () => {
    expect(effectivePassStatus(pass, balance, "2026-10-04")).toBe("scheduled");
    expect(effectivePassStatus(pass, balance, "2026-10-10")).toBe("active");
    expect(effectivePassStatus(pass, balance, "2026-10-19")).toBe("expired");
    expect(effectivePassStatus(pass, { ...balance, class_used: 3 }, "2026-10-10")).toBe("exhausted");
    expect(effectivePassStatus({ ...pass, facility_access: true }, { ...balance, class_used: 3 }, "2026-10-10")).toBe("active");
    expect(effectivePassStatus({ ...pass, status: "cancelled" }, balance, "2026-10-10")).toBe("cancelled");
  });
});

describe("utang & breakage", () => {
  const p = { class_value: 750_000, pt_value: 250_000, facility_value: 0, price_paid: 1_000_000 };
  const b = { class_total: 3, pt_total: 1, class_used: 1, pt_used: 0 };
  const none = { class: 0, pt: 0, facility: 0 };

  it("utang = harga − nilai yang sudah diakui (bukan sisa kredit)", () => {
    expect(outstandingLiability({ ...p, status: "active", breakage_recognized: false }, { ...none, class: 250_000 })).toBe(750_000);
    // penyesuaian kredit manual tidak mengubah utang
    expect(outstandingLiability({ ...p, status: "active", breakage_recognized: false }, none)).toBe(1_000_000);
    expect(outstandingLiability({ ...p, status: "active", breakage_recognized: true }, none)).toBe(0);
    expect(outstandingLiability({ ...p, status: "cancelled", breakage_recognized: false }, none)).toBe(0);
  });

  it("nilai redeem mengikuti jumlah kredit yang sudah di-redeem; kredit kompensasi bernilai 0", () => {
    expect(redeemValue(750_000, 3, 0)).toBe(250_000);
    expect(redeemValue(750_000, 3, 3)).toBe(0);
  });

  it("breakage mengakui seluruh sisa nilai + facility", () => {
    expect(breakageOnExpiry({ ...p, facility_value: 100_000 }, b, { ...none, class: 250_000 })).toEqual({
      class_qty: 2,
      class_amount: 500_000,
      pt_qty: 1,
      pt_amount: 250_000,
      facility_amount: 100_000,
    });
  });
});

describe("generatePassCode", () => {
  it("membuat kode NH- 6 karakter tanpa karakter ambigu", () => {
    const code = generatePassCode();
    expect(code).toMatch(/^NH-[2-9A-HJ-NP-Z]{6}$/);
  });
});
