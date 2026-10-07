import { describe, expect, it } from "vitest";
import {
  SHIFT_OFF,
  currentShiftPattern,
  shiftPatternPayload,
  summarizeShiftHistory,
} from "./employee-profile-shifts";

const row = (day: number, shift: string | null, from: string, to: string | null = null) => ({
  day_of_week: day,
  shift_id: shift,
  effective_from: from,
  effective_to: to,
  shift_name: shift ? `Shift ${shift}` : null,
});

describe("currentShiftPattern", () => {
  it("memilih baris efektif terbaru per hari; hari tanpa baris = libur", () => {
    const rows = [
      row(1, "A", "2026-01-01", "2026-05-31"),
      row(1, "B", "2026-06-01"),
      row(2, "A", "2026-11-01"),
    ];
    const pattern = currentShiftPattern(rows, "2026-10-04");
    expect(pattern[1]).toBe("B");
    expect(pattern[2]).toBe(SHIFT_OFF);
    expect(Object.keys(pattern)).toHaveLength(7);
  });
});

describe("shiftPatternPayload", () => {
  it("libur jadi null", () => {
    const payload = shiftPatternPayload({
      1: "A",
      2: SHIFT_OFF,
      3: SHIFT_OFF,
      4: SHIFT_OFF,
      5: SHIFT_OFF,
      6: SHIFT_OFF,
      7: SHIFT_OFF,
    });
    expect(payload[0]).toEqual({ day_of_week: 1, shift_id: "A" });
    expect(payload[1]).toEqual({ day_of_week: 2, shift_id: null });
  });
});

describe("summarizeShiftHistory", () => {
  it("mengelompokkan per tanggal mulai", () => {
    const rows = [
      row(1, "A", "2026-06-01"),
      row(2, null, "2026-06-01"),
      row(1, null, "2026-01-01", "2026-05-31"),
    ];
    expect(summarizeShiftHistory(rows)).toEqual([
      { from: "2026-06-01", to: null, summary: "Sen Shift A" },
      { from: "2026-01-01", to: "2026-05-31", summary: "libur semua" },
    ]);
  });
});
