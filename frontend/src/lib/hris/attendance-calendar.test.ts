import { describe, it, expect } from "vitest";
import {
  currentMonthWib,
  dateKey,
  indexByWibDate,
  monthBounds,
  monthGrid,
  monthRange,
  resolveDaySchedule,
  shiftClock,
  wibDateKey,
} from "./attendance-calendar";

describe("wibDateKey", () => {
  it("moves a UTC-serialised pg date back to the WIB calendar day", () => {
    expect(wibDateKey("2026-10-03T17:00:00.000Z")).toBe("2026-10-04");
  });

  it("falls back to the first 10 chars for unparsable input", () => {
    expect(wibDateKey("bukan-tanggal")).toBe("bukan-tang");
  });
});

describe("month helpers", () => {
  it("builds month bounds including leap February", () => {
    expect(monthBounds(2028, 1)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthRange("2026-10")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(dateKey(2026, 0, 5)).toBe("2026-01-05");
  });

  it("reads the current month in WIB", () => {
    expect(currentMonthWib(new Date("2026-09-30T18:00:00Z"))).toBe("2026-10");
    expect(currentMonthWib(new Date("2026-09-30T16:00:00Z"))).toBe("2026-09");
  });

  it("lays out the calendar grid from Sunday", () => {
    // Oktober 2026 dimulai Kamis (4), 31 hari → 35 sel
    expect(monthGrid(2026, 9)).toEqual({ daysInMonth: 31, firstWeekday: 4, totalCells: 35 });
    // Agustus 2026 dimulai Sabtu (6) → 42 sel
    expect(monthGrid(2026, 7).totalCells).toBe(42);
  });
});

describe("shiftClock", () => {
  it("formats HH:MM:SS as HH.MM", () => {
    expect(shiftClock("08:00:00")).toBe("08.00");
    expect(shiftClock(null)).toBe("");
  });
});

describe("resolveDaySchedule", () => {
  const base = { effective_from: "2026-01-01", effective_to: null };
  const schedule = [
    { ...base, day_of_week: 1, shift_id: "pagi" },
    { ...base, day_of_week: 7, shift_id: null },
  ];

  it("returns the scheduled shift on a work day", () => {
    expect(resolveDaySchedule(schedule, "2026-10-05")).toEqual({
      scheduled: schedule[0],
      isDayOff: false,
    });
  });

  it("flags a day-off row and an unscheduled day", () => {
    expect(resolveDaySchedule(schedule, "2026-10-04")).toEqual({ scheduled: null, isDayOff: true });
    expect(resolveDaySchedule(schedule, "2026-10-06")).toEqual({ scheduled: null, isDayOff: false });
    expect(resolveDaySchedule([], "2026-10-06")).toEqual({ scheduled: null, isDayOff: false });
  });
});

describe("indexByWibDate", () => {
  it("keys rows by WIB date", () => {
    const rows = [{ id: "a", date: "2026-10-03T17:00:00.000Z" }];
    expect(indexByWibDate(rows)).toEqual({ "2026-10-04": rows[0] });
  });
});
