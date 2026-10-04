import { describe, expect, it } from "vitest";
import {
  findOpenSequenceViolation,
  generateMonthlyPeriods,
  getOpenPeriodBlockReason,
} from "./fiscal-periods";

describe("generateMonthlyPeriods", () => {
  it("12 period bulanan, hanya period pertama OPEN", () => {
    const periods = generateMonthlyPeriods("2026-01-01", "2026-12-31");
    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({ period_no: 1, start_date: "2026-01-01", end_date: "2026-01-31", status: "OPEN" });
    expect(periods[11]).toMatchObject({ start_date: "2026-12-01", end_date: "2026-12-31", status: "CLOSED" });
  });

  it("menolak rentang terbalik", () => {
    expect(() => generateMonthlyPeriods("2026-12-31", "2026-01-01")).toThrow("end_date harus >= start_date");
  });
});

describe("findOpenSequenceViolation", () => {
  it("null bila period OPEN hanya satu atau berurutan setelah CLOSED", () => {
    expect(
      findOpenSequenceViolation([
        { period_no: 1, status: "CLOSED" },
        { period_no: 2, status: "OPEN" },
      ])
    ).toBeNull();
  });

  it("menyebut period sebelumnya yang masih OPEN", () => {
    expect(
      findOpenSequenceViolation([
        { period_no: 2, status: "OPEN" },
        { period_no: 1, name: "Januari 2026", status: "OPEN" },
      ])
    ).toBe(
      "Tidak bisa OPEN period 2: period 1 (Januari 2026) belum CLOSED. Tutup period sebelumnya terlebih dahulu."
    );
  });
});

describe("getOpenPeriodBlockReason", () => {
  it("memblok OPEN bila period sebelumnya masih OPEN", () => {
    const periods = [
      { period_no: 1, status: "OPEN" },
      { period_no: 2, status: "CLOSED" },
    ];
    expect(getOpenPeriodBlockReason(periods, 2)).toBe("Tutup period 1 terlebih dahulu sebelum OPEN period 2.");
    expect(getOpenPeriodBlockReason(periods, 1)).toBeNull();
  });
});
