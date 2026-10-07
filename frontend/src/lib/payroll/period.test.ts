import { describe, it, expect } from "vitest";
import {
  eachDateOfPeriod,
  countScheduledDays,
  clampedLeaveDays,
  periodCoverage,
  mergeDateRanges,
  dateColToIso,
  addDaysIso,
  realizedOvertimeHours,
  splitOvertimeHours,
  computeLateStats,
  overtimeHoursFromTimes,
  type AttendancePeriodRow,
} from "./period";
import type { EmployeeShiftRow } from "@/lib/hris/shifts";
import { indexHolidays } from "@/lib/hris/holidays";

const SHIFT_ID = "shift-1";

/** Pola Senin–Jumat kerja, Sabtu–Minggu libur, berlaku sepanjang 2026. */
function weekdayPattern(): EmployeeShiftRow[] {
  const rows: EmployeeShiftRow[] = [];
  for (let dow = 1; dow <= 7; dow++) {
    rows.push({
      day_of_week: dow,
      shift_id: dow <= 5 ? SHIFT_ID : null,
      effective_from: "2026-01-01",
      effective_to: null,
    });
  }
  return rows;
}

function att(partial: Partial<AttendancePeriodRow> & { date: string }): AttendancePeriodRow {
  return {
    status: "present",
    clock_out: `${partial.date}T10:00:00Z`,
    is_late: false,
    late_minutes: 0,
    overtime_hours: 0,
    ...partial,
  };
}

describe("eachDateOfPeriod", () => {
  it("lists inclusive dates", () => {
    const dates = eachDateOfPeriod("2026-06-28", "2026-07-02");
    expect(dates).toEqual([
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
    ]);
  });
});

describe("countScheduledDays", () => {
  it("counts weekday shifts for June 2026 (22 hari kerja)", () => {
    // Juni 2026: 30 hari, mulai Senin → 22 hari Senin–Jumat
    const result = countScheduledDays(weekdayPattern(), "2026-06-01", "2026-06-30");
    expect(result.hasSchedule).toBe(true);
    expect(result.scheduledDays).toBe(22);
  });

  it("returns hasSchedule=false when employee has no pattern at all", () => {
    const result = countScheduledDays([], "2026-06-01", "2026-06-30");
    expect(result.hasSchedule).toBe(false);
    expect(result.scheduledDays).toBe(0);
  });

  it("respects effective ranges (pola berakhir di tengah periode)", () => {
    const rows = weekdayPattern().map((row) => ({
      ...row,
      effective_to: "2026-06-12", // pola berhenti setelah 12 Juni
    }));
    const result = countScheduledDays(rows, "2026-06-01", "2026-06-30");
    // 1–12 Juni: Senin 1 Jun … Jumat 12 Jun = 10 hari kerja
    expect(result.scheduledDays).toBe(10);
  });
});

describe("clampedLeaveDays", () => {
  it("counts only the portion inside the period (cuti lintas bulan)", () => {
    const leave = { start_date: "2026-05-28", end_date: "2026-06-03" };
    expect(clampedLeaveDays(leave, "2026-06-01", "2026-06-30")).toBe(3);
  });

  it("counts full range when inside the period", () => {
    const leave = { start_date: "2026-06-10", end_date: "2026-06-12" };
    expect(clampedLeaveDays(leave, "2026-06-01", "2026-06-30")).toBe(3);
  });

  it("returns 0 when leave is entirely outside the period", () => {
    const leave = { start_date: "2026-07-01", end_date: "2026-07-05" };
    expect(clampedLeaveDays(leave, "2026-06-01", "2026-06-30")).toBe(0);
  });
});

describe("realizedOvertimeHours", () => {
  it("pays approved hours when attendance exists without system overtime", () => {
    const total = realizedOvertimeHours(
      [{ date: "2026-06-10", hours: 2 }],
      [att({ date: "2026-06-10" })]
    );
    expect(total).toBe(2);
  });

  it("caps at actual attendance overtime when system computed less", () => {
    const total = realizedOvertimeHours(
      [{ date: "2026-06-10", hours: 3 }],
      [att({ date: "2026-06-10", overtime_hours: 1.5 })]
    );
    expect(total).toBe(1.5);
  });

  it("pays nothing when there is no clock_out that day", () => {
    const total = realizedOvertimeHours(
      [{ date: "2026-06-10", hours: 2 }],
      [att({ date: "2026-06-10", clock_out: null })]
    );
    expect(total).toBe(0);
  });

  it("pays nothing when there is no attendance row that day", () => {
    const total = realizedOvertimeHours([{ date: "2026-06-10", hours: 2 }], []);
    expect(total).toBe(0);
  });

  it("sums multiple realized requests", () => {
    const total = realizedOvertimeHours(
      [
        { date: "2026-06-10", hours: 2 },
        { date: "2026-06-11", hours: 1.5 },
        { date: "2026-06-12", hours: 4 }, // tidak masuk kerja → 0
      ],
      [att({ date: "2026-06-10" }), att({ date: "2026-06-11" })]
    );
    expect(total).toBe(3.5);
  });
});

// EPIC-036 Fase F — lembur pada hari libur resmi dibayar dengan multiplier
// terpisah, jadi jamnya harus dipisah lebih dulu.
describe("splitOvertimeHours", () => {
  // 17 Agustus 2026 (Senin) libur nasional; 18 Agustus hari kerja biasa.
  const holidays = indexHolidays([
    {
      holiday_date: "2026-08-17",
      name: "Hari Kemerdekaan Republik Indonesia",
      type: "nasional",
      deducts_leave: false,
    },
  ]);

  it("memisahkan jam lembur hari libur dari hari kerja", () => {
    const split = splitOvertimeHours(
      [
        { date: "2026-08-17", hours: 3 },
        { date: "2026-08-18", hours: 2 },
      ],
      [att({ date: "2026-08-17" }), att({ date: "2026-08-18" })],
      holidays
    );
    expect(split).toEqual({ regularHours: 2, holidayHours: 3, totalHours: 5 });
  });

  it("cuti bersama tetap hari libur untuk lembur, meski memotong jatah cuti", () => {
    const cutiBersama = indexHolidays([
      {
        holiday_date: "2026-03-20",
        name: "Cuti Bersama Idul Fitri",
        type: "cuti_bersama",
        deducts_leave: true,
      },
    ]);
    const split = splitOvertimeHours(
      [{ date: "2026-03-20", hours: 4 }],
      [att({ date: "2026-03-20" })],
      cutiBersama
    );
    expect(split).toEqual({ regularHours: 0, holidayHours: 4, totalHours: 4 });
  });

  it("tanpa hari libur, seluruh jam masuk tarif hari kerja", () => {
    const split = splitOvertimeHours(
      [{ date: "2026-06-10", hours: 2 }],
      [att({ date: "2026-06-10" })],
      indexHolidays([])
    );
    expect(split).toEqual({ regularHours: 2, holidayHours: 0, totalHours: 2 });
  });

  it("aturan realisasi tetap berlaku: tanpa clock_out tidak dibayar", () => {
    const split = splitOvertimeHours(
      [{ date: "2026-08-17", hours: 3 }],
      [att({ date: "2026-08-17", clock_out: null })],
      holidays
    );
    expect(split).toEqual({ regularHours: 0, holidayHours: 0, totalHours: 0 });
  });

  it("totalHours selalu sama dengan realizedOvertimeHours", () => {
    const requests = [
      { date: "2026-08-17", hours: 3 },
      { date: "2026-08-18", hours: 1.5 },
    ];
    const rows = [att({ date: "2026-08-17" }), att({ date: "2026-08-18" })];
    expect(splitOvertimeHours(requests, rows, holidays).totalHours).toBe(
      realizedOvertimeHours(requests, rows)
    );
  });
});

describe("computeLateStats", () => {
  it("sums late minutes from v2 attendance rows", () => {
    const stats = computeLateStats([
      att({ date: "2026-06-01", is_late: true, late_minutes: 12, status: "late" }),
      att({ date: "2026-06-02", is_late: true, late_minutes: 30, status: "late" }),
      att({ date: "2026-06-03" }),
    ]);
    expect(stats.lateDays).toBe(2);
    expect(stats.lateMinutes).toBe(42);
  });

  it("counts legacy status 'late' rows without late_minutes", () => {
    const stats = computeLateStats([
      att({ date: "2026-06-01", status: "late", is_late: null, late_minutes: null }),
    ]);
    expect(stats.lateDays).toBe(1);
    expect(stats.lateMinutes).toBe(0);
  });
});

describe("periodCoverage", () => {
  it("clamps a contract range to the period", () => {
    expect(periodCoverage("2026-06-15", "2026-08-01", "2026-06-01", "2026-06-30")).toEqual({
      start: "2026-06-15",
      end: "2026-06-30",
    });
  });

  it("treats null end (PKWTT) as unbounded", () => {
    expect(periodCoverage("2025-01-01", null, "2026-06-01", "2026-06-30")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
  });

  it("returns null when the range misses the period", () => {
    expect(periodCoverage("2026-07-01", null, "2026-06-01", "2026-06-30")).toBeNull();
    expect(
      periodCoverage("2026-01-01", "2026-05-31", "2026-06-01", "2026-06-30")
    ).toBeNull();
  });

  it("handles contract ending mid-period", () => {
    expect(periodCoverage("2026-01-01", "2026-06-10", "2026-06-01", "2026-06-30")).toEqual({
      start: "2026-06-01",
      end: "2026-06-10",
    });
  });
});

describe("dateColToIso", () => {
  it("converts pg Date objects (local midnight) without timezone shift", () => {
    // Driver pg mengembalikan kolom `date` sebagai Date di tengah malam
    // WAKTU LOKAL — toISOString() akan geser -1 hari di WIB; helper harus
    // memakai komponen lokal (regression temuan review Fase C).
    const localMidnight = new Date(2026, 5, 16); // 16 Juni 2026 lokal
    expect(dateColToIso(localMidnight)).toBe("2026-06-16");
  });

  it("slices ISO datetime strings and passes through plain dates", () => {
    expect(dateColToIso("2026-06-16")).toBe("2026-06-16");
    expect(dateColToIso("2026-06-16T00:00:00.000Z")).toBe("2026-06-16");
  });

  it("returns null for null/garbage", () => {
    expect(dateColToIso(null)).toBeNull();
    expect(dateColToIso(undefined)).toBeNull();
    expect(dateColToIso("bukan tanggal")).toBeNull();
  });
});

describe("mergeDateRanges / addDaysIso", () => {
  it("merges back-to-back PKWT renewal into one continuous coverage", () => {
    // Kontrak lama berakhir 15 Jun, perpanjangan mulai 16 Jun → satu cakupan
    const merged = mergeDateRanges([
      { start: "2026-06-16", end: "2026-06-30" },
      { start: "2026-06-01", end: "2026-06-15" },
    ]);
    expect(merged).toEqual([{ start: "2026-06-01", end: "2026-06-30" }]);
  });

  it("keeps ranges separate when there is a real gap", () => {
    const merged = mergeDateRanges([
      { start: "2026-06-01", end: "2026-06-10" },
      { start: "2026-06-20", end: "2026-06-30" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("merges overlapping ranges", () => {
    const merged = mergeDateRanges([
      { start: "2026-06-01", end: "2026-06-20" },
      { start: "2026-06-15", end: "2026-06-30" },
    ]);
    expect(merged).toEqual([{ start: "2026-06-01", end: "2026-06-30" }]);
  });

  it("addDaysIso crosses month boundaries", () => {
    expect(addDaysIso("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysIso("2026-07-01", -1)).toBe("2026-06-30");
  });
});

describe("overtimeHoursFromTimes", () => {
  it("computes normal same-day hours", () => {
    expect(overtimeHoursFromTimes("17:00", "19:30")).toBe(2.5);
  });

  it("handles overnight overtime (lewat tengah malam)", () => {
    expect(overtimeHoursFromTimes("22:00", "01:00")).toBe(3);
  });
});
