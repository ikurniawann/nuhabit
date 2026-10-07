import { describe, expect, it } from "vitest";
import { firstDayOfMonthWib, monthToDateWib, todayWib } from "./report-dates";

describe("report-dates WIB", () => {
  it("uses Jakarta calendar, not UTC midnight", () => {
    // 16 Agu 2026 00:30 WIB = 15 Agu 17:30 UTC
    const earlyAugust = new Date("2026-08-15T17:30:00.000Z");
    expect(todayWib(earlyAugust)).toBe("2026-08-16");
    expect(firstDayOfMonthWib(earlyAugust)).toBe("2026-08-01");
    expect(monthToDateWib(earlyAugust)).toEqual({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-16",
    });
  });

  it("rolls to the next month on the 1st WIB", () => {
    const firstSeptember = new Date("2026-08-31T17:30:00.000Z");
    expect(todayWib(firstSeptember)).toBe("2026-09-01");
    expect(firstDayOfMonthWib(firstSeptember)).toBe("2026-09-01");
  });
});
