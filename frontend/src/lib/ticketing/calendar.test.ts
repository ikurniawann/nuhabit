import { describe, expect, test } from "vitest";
import { addDaysIso, dateRangeError, daysBetweenIso, eachDayIso } from "./calendar";

describe("aritmetika tanggal kalender", () => {
  test("addDaysIso melewati batas bulan, tahun, dan kabisat", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDaysIso("2026-10-04", -6)).toBe("2026-09-28");
  });

  test("daysBetweenIso", () => {
    expect(daysBetweenIso("2026-01-01", "2026-04-03")).toBe(92);
    expect(daysBetweenIso("2026-10-04", "2026-10-04")).toBe(0);
  });

  test("eachDayIso inklusif", () => {
    expect(eachDayIso("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });
});

describe("dateRangeError", () => {
  test("rentang sah → null", () => {
    expect(dateRangeError("2026-01-01", "2026-04-03", 92)).toBeNull();
  });

  test("tanggal tak sah atau terbalik", () => {
    expect(dateRangeError("2026-02-30", "2026-03-01", 92)).toBe("Rentang tanggal tidak valid");
    expect(dateRangeError("2026-03-02", "2026-03-01", 92)).toBe("Rentang tanggal tidak valid");
    expect(dateRangeError("", "", 92)).toBe("Rentang tanggal tidak valid");
  });

  test("melewati batas hari", () => {
    expect(dateRangeError("2026-01-01", "2026-04-04", 92)).toBe("Rentang maksimum 92 hari");
  });
});
