import { describe, expect, test } from "vitest";
import {
  computeLateness,
  resolveScheduleRowForDate,
  resolveShiftForDate,
  scheduledWindow,
  type EmployeeShiftRow,
} from "./shifts";

const PAGI = {
  id: "shift-pagi",
  name: "Shift Pagi",
  start_time: "08:00:00",
  end_time: "16:00:00",
  late_tolerance_minutes: 10,
  is_overnight: false,
};

const MALAM = {
  id: "shift-malam",
  name: "Shift Malam",
  start_time: "22:00:00",
  end_time: "06:00:00",
  late_tolerance_minutes: 10,
  is_overnight: true,
};

function row(partial: Partial<EmployeeShiftRow>): EmployeeShiftRow {
  return {
    day_of_week: 1,
    shift_id: PAGI.id,
    effective_from: "2026-01-01",
    effective_to: null,
    ...partial,
  };
}

describe("resolveShiftForDate", () => {
  test("memilih baris sesuai hari (Senin=1) dan rentang efektif", () => {
    const rows = [row({ day_of_week: 1 }), row({ day_of_week: 2, shift_id: MALAM.id })];
    // 2026-07-20 = Senin
    expect(resolveShiftForDate(rows, "2026-07-20")?.shift_id).toBe(PAGI.id);
    // 2026-07-21 = Selasa
    expect(resolveShiftForDate(rows, "2026-07-21")?.shift_id).toBe(MALAM.id);
  });

  test("pola terbaru menang (effective_from paling akhir yang sudah berlaku)", () => {
    const rows = [
      row({ effective_from: "2026-01-01", shift_id: PAGI.id }),
      row({ effective_from: "2026-07-01", shift_id: MALAM.id }),
    ];
    expect(resolveShiftForDate(rows, "2026-07-20")?.shift_id).toBe(MALAM.id);
    expect(resolveShiftForDate(rows, "2026-03-02")?.shift_id).toBe(PAGI.id);
  });

  test("hormati effective_to dan pola belum berlaku", () => {
    const rows = [
      row({ effective_from: "2026-01-01", effective_to: "2026-06-30" }),
      row({ effective_from: "2026-09-01", shift_id: MALAM.id }),
    ];
    // Juli: pola lama sudah habis, pola baru belum mulai
    expect(resolveShiftForDate(rows, "2026-07-20")).toBeNull();
  });

  test("shift_id null berarti hari libur → null", () => {
    const rows = [row({ shift_id: null })];
    expect(resolveShiftForDate(rows, "2026-07-20")).toBeNull();
  });

  test("tidak ada jadwal sama sekali → null", () => {
    expect(resolveShiftForDate([], "2026-07-20")).toBeNull();
  });
});

describe("resolveScheduleRowForDate", () => {
  test("baris libur (shift_id null) tetap dikembalikan — beda dgn tanpa jadwal", () => {
    const rows = [row({ shift_id: null })];
    const winner = resolveScheduleRowForDate(rows, "2026-07-20");
    expect(winner).not.toBeNull();
    expect(winner?.shift_id).toBeNull();
    expect(resolveScheduleRowForDate([], "2026-07-20")).toBeNull();
  });

  test("pola terbaru menang termasuk saat menimpa libur", () => {
    const rows = [
      row({ effective_from: "2026-01-01", shift_id: null }),
      row({ effective_from: "2026-07-01", shift_id: MALAM.id }),
    ];
    expect(resolveScheduleRowForDate(rows, "2026-07-20")?.shift_id).toBe(MALAM.id);
    expect(resolveScheduleRowForDate(rows, "2026-03-02")?.shift_id).toBeNull();
  });
});

describe("scheduledWindow", () => {
  test("shift normal: mulai & selesai di hari yang sama (WIB)", () => {
    const window = scheduledWindow("2026-07-20", PAGI);
    expect(window.start.toISOString()).toBe("2026-07-20T01:00:00.000Z"); // 08:00 WIB
    expect(window.end.toISOString()).toBe("2026-07-20T09:00:00.000Z"); // 16:00 WIB
  });

  test("shift malam (overnight): selesai keesokan hari", () => {
    const window = scheduledWindow("2026-07-20", MALAM);
    expect(window.start.toISOString()).toBe("2026-07-20T15:00:00.000Z"); // 22:00 WIB
    expect(window.end.toISOString()).toBe("2026-07-20T23:00:00.000Z"); // 06:00 WIB besok
  });
});

describe("computeLateness", () => {
  test("clock-in dalam toleransi → tidak terlambat", () => {
    // 08:09 WIB = 01:09 UTC; toleransi 10 menit
    expect(
      computeLateness(new Date("2026-07-20T01:09:00Z"), "2026-07-20", PAGI)
    ).toEqual({ is_late: false, late_minutes: 0 });
  });

  test("clock-in lewat toleransi → terlambat, dihitung dari jam mulai shift", () => {
    // 08:25 WIB → terlambat 25 menit (melebihi toleransi 10)
    expect(
      computeLateness(new Date("2026-07-20T01:25:00Z"), "2026-07-20", PAGI)
    ).toEqual({ is_late: true, late_minutes: 25 });
  });

  test("clock-in lebih awal → tidak terlambat", () => {
    expect(
      computeLateness(new Date("2026-07-20T00:45:00Z"), "2026-07-20", PAGI)
    ).toEqual({ is_late: false, late_minutes: 0 });
  });
});
