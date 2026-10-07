import { describe, expect, it } from "vitest";
import { computeOntime } from "@/lib/kpi/attendance-ontime";
import type { EmployeeShiftRow } from "@/lib/hris/shifts";

// Jadwal Senin-Jumat (ISO dow 1-5), efektif sepanjang masa
const weekdaySchedule: EmployeeShiftRow[] = [1, 2, 3, 4, 5].map((dow) => ({
  day_of_week: dow,
  shift_id: `shift-${dow}`,
  effective_from: "2026-01-01",
  effective_to: null,
}));

// Periode uji: Senin 2026-07-06 s/d Minggu 2026-07-12 (5 hari kerja)
const START = "2026-07-06";
const END = "2026-07-12";

describe("computeOntime", () => {
  it("full on-time week → 1.0 dengan sample = hari terjadwal", () => {
    const result = computeOntime({
      scheduleRows: weekdaySchedule,
      attendanceRows: [
        { date: "2026-07-06", is_late: false },
        { date: "2026-07-07", is_late: false },
        { date: "2026-07-08", is_late: false },
        { date: "2026-07-09", is_late: false },
        { date: "2026-07-10", is_late: false },
      ],
      leaveDays: new Set(),
      startIso: START,
      endIso: END,
    });
    expect(result.actual).toBe(1);
    expect(result.sampleSize).toBe(5);
  });

  it("telat & mangkir menurunkan rasio", () => {
    // 5 hari terjadwal: 2 on-time, 1 telat, 2 mangkir (tanpa row)
    const result = computeOntime({
      scheduleRows: weekdaySchedule,
      attendanceRows: [
        { date: "2026-07-06", is_late: false },
        { date: "2026-07-07", is_late: true },
        { date: "2026-07-08", is_late: false },
      ],
      leaveDays: new Set(),
      startIso: START,
      endIso: END,
    });
    expect(result.actual).toBe(0.4); // 2/5
  });

  it("cuti approved mengurangi penyebut (tidak menghukum)", () => {
    const result = computeOntime({
      scheduleRows: weekdaySchedule,
      attendanceRows: [
        { date: "2026-07-06", is_late: false },
        { date: "2026-07-07", is_late: false },
        { date: "2026-07-08", is_late: false },
        { date: "2026-07-09", is_late: false },
      ],
      leaveDays: new Set(["2026-07-10"]),
      startIso: START,
      endIso: END,
    });
    expect(result.actual).toBe(1); // 4/4
    expect(result.sampleSize).toBe(4);
  });

  it("tanpa jadwal → fallback basis hari hadir", () => {
    const result = computeOntime({
      scheduleRows: [],
      attendanceRows: [
        { date: "2026-07-06", is_late: false },
        { date: "2026-07-07", is_late: true },
      ],
      leaveDays: new Set(),
      startIso: START,
      endIso: END,
    });
    expect(result.actual).toBe(0.5);
    expect(result.sampleSize).toBe(2);
  });

  it("tanpa jadwal & tanpa kehadiran → null (dikeluarkan)", () => {
    const result = computeOntime({
      scheduleRows: [],
      attendanceRows: [],
      leaveDays: new Set(),
      startIso: START,
      endIso: END,
    });
    expect(result.actual).toBeNull();
    expect(result.sampleSize).toBe(0);
  });

  it("hadir di hari libur terjadwal tidak menambah pembilang basis jadwal", () => {
    // Sabtu 2026-07-11 tidak terjadwal — hadir pun tak dihitung ke rasio
    const result = computeOntime({
      scheduleRows: weekdaySchedule,
      attendanceRows: [
        { date: "2026-07-06", is_late: false },
        { date: "2026-07-11", is_late: false },
      ],
      leaveDays: new Set(),
      startIso: START,
      endIso: END,
    });
    expect(result.actual).toBe(0.2); // 1/5
  });
});
