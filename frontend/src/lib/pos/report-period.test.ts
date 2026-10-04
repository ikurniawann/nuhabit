import { describe, expect, it } from "vitest";
import { formatPeriodLabel, resolveReportPeriod, validateReportRange, wibDateString } from "./report-period";

describe("report-period", () => {
  // 2026-09-05 18:30 WIB = 11:30 UTC (Sabtu)
  const now = new Date("2026-09-05T11:30:00Z");

  it("tanggal WIB melewati batas hari UTC", () => {
    expect(wibDateString(new Date("2026-09-05T17:30:00Z"))).toBe("2026-09-06");
    expect(wibDateString(now)).toBe("2026-09-05");
  });

  it("pintasan hari/minggu/bulan/tahun (minggu mulai Senin, sampai = hari ini)", () => {
    expect(resolveReportPeriod("today", now)).toEqual({ date_from: "2026-09-05", date_to: "2026-09-05" });
    expect(resolveReportPeriod("week", now)).toEqual({ date_from: "2026-08-31", date_to: "2026-09-05" });
    expect(resolveReportPeriod("month", now)).toEqual({ date_from: "2026-09-01", date_to: "2026-09-05" });
    expect(resolveReportPeriod("year", now)).toEqual({ date_from: "2026-01-01", date_to: "2026-09-05" });
    // Senin → minggu ini dimulai hari itu juga
    expect(resolveReportPeriod("week", new Date("2026-08-31T01:00:00Z")).date_from).toBe("2026-08-31");
  });

  it("validasi rentang manual", () => {
    expect(validateReportRange("2026-09-01", "2026-09-05")).toBeNull();
    expect(validateReportRange("2026-09-06", "2026-09-05")).toMatch(/melebihi/);
    expect(validateReportRange("5/9/2026", "2026-09-05")).toMatch(/Format/);
  });

  it("label periode", () => {
    expect(formatPeriodLabel("2026-09-05", "2026-09-05")).toBe("5 Sep 2026");
    expect(formatPeriodLabel("2026-09-01", "2026-09-05")).toBe("1 Sep 2026 s.d. 5 Sep 2026");
  });
});
