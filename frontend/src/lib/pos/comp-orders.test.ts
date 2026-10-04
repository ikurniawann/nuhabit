import { describe, expect, it } from "vitest";
import { compReceiptLabel, isCompType, kolQuotaAllows, monthStartWibIso } from "./comp-orders";

describe("kolQuotaAllows", () => {
  it("limit NULL = tanpa batas", () => {
    expect(
      kolQuotaAllows({ monthlyLimitIdr: null, usedThisMonthIdr: 9e9, orderGrossIdr: 9e9 }).ok
    ).toBe(true);
  });
  it("dalam kuota lolos, lewat kuota ditolak dgn angka jelas", () => {
    expect(
      kolQuotaAllows({ monthlyLimitIdr: 500_000, usedThisMonthIdr: 400_000, orderGrossIdr: 100_000 }).ok
    ).toBe(true);
    const over = kolQuotaAllows({
      monthlyLimitIdr: 500_000,
      usedThisMonthIdr: 400_000,
      orderGrossIdr: 100_001,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.reason).toContain("400.000");
      expect(over.reason).toContain("500.000");
    }
  });
});

describe("compReceiptLabel", () => {
  it("label per jenis, owner memuat nama penyetuju", () => {
    expect(compReceiptLabel("kol_comp")).toBe("KOL COMPLIMENTARY — GRATIS");
    expect(compReceiptLabel("owner_comp", "Ricky")).toBe("OWNER COMP — Disetujui: Ricky");
    expect(compReceiptLabel("owner_comp")).toBe("OWNER COMP — Disetujui: -");
    expect(compReceiptLabel(null)).toBeNull();
    expect(compReceiptLabel("lainnya")).toBeNull();
  });
});

describe("isCompType / monthStartWibIso", () => {
  it("hanya dua jenis komplimen yang dikenal", () => {
    expect(isCompType("kol_comp")).toBe(true);
    expect(isCompType("owner_comp")).toBe(true);
    expect(isCompType("gratis")).toBe(false);
  });
  it("awal bulan WIB dalam ISO UTC", () => {
    expect(monthStartWibIso(new Date("2026-08-23T20:00:00+07:00"))).toBe(
      "2026-07-31T17:00:00.000Z"
    );
  });
});

describe("FOC comp type", () => {
  it("mengakui foc_comp sebagai komplimen", () => {
    expect(isCompType("foc_comp")).toBe(true);
  });

  it("label struk FOC menyertakan penyetuju", () => {
    expect(compReceiptLabel("foc_comp", "Ricky")).toBe(
      "FOC (FREE OF CHARGE) — Disetujui: Ricky"
    );
    expect(compReceiptLabel("foc_comp", null)).toBe(
      "FOC (FREE OF CHARGE) — Disetujui: -"
    );
  });
});
