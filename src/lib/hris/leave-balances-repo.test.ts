import { describe, expect, it } from "vitest";
import { proratedAnnualQuota } from "./leave-balances-repo";

describe("proratedAnnualQuota", () => {
  it("masuk tahun lain atau tanpa tanggal: 12 hari", () => {
    expect(proratedAnnualQuota("2024-05-10", 2026)).toBe(12);
    expect(proratedAnnualQuota(null, 2026)).toBe(12);
  });
  it("masuk di tahun berjalan: bulan masuk ikut dihitung", () => {
    expect(proratedAnnualQuota("2026-01-20", 2026)).toBe(12);
    expect(proratedAnnualQuota("2026-07-01", 2026)).toBe(6);
    expect(proratedAnnualQuota("2026-12-15", 2026)).toBe(1);
  });
});
