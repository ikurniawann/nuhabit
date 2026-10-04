import { describe, expect, it } from "vitest";
import { previousPeriodWib } from "@/lib/kpi/auto-snapshot";

describe("previousPeriodWib", () => {
  it("mid-month → bulan sebelumnya", () => {
    expect(previousPeriodWib(new Date("2026-07-19T05:00:00Z"))).toEqual({
      periodYear: 2026,
      periodMonth: 6,
    });
  });

  it("januari → desember tahun lalu", () => {
    expect(previousPeriodWib(new Date("2026-01-15T05:00:00Z"))).toEqual({
      periodYear: 2025,
      periodMonth: 12,
    });
  });

  it("pergantian bulan dihitung dlm WIB: 31 Jul 20:00 UTC = 1 Agu WIB → bulan lalu Juli", () => {
    expect(previousPeriodWib(new Date("2026-07-31T20:00:00Z"))).toEqual({
      periodYear: 2026,
      periodMonth: 7,
    });
  });

  it("1 Agu 00:30 WIB (31 Jul 17:30 UTC) → bulan lalu Juli", () => {
    expect(previousPeriodWib(new Date("2026-07-31T17:30:00Z"))).toEqual({
      periodYear: 2026,
      periodMonth: 7,
    });
  });
});
