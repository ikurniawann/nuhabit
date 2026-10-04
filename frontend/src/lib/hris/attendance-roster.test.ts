import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

const { buildRoster } = await import("./attendance-roster");
type Row = Parameters<typeof buildRoster>[0][number];

const base: Row = {
  employee_id: "e1",
  full_name: "Budi",
  nip: null,
  photo_url: null,
  department_name: null,
  job_title: null,
  has_schedule: true,
  scheduled_shift_id: "s1",
  shift_name: "Pagi",
  shift_start: "08:00:00",
  shift_end: "16:00:00",
  late_tolerance_minutes: 10,
  is_overnight: false,
  attendance_id: null,
  clock_in: null,
  clock_out: null,
  work_hours: null,
  is_late: null,
  late_minutes: null,
  clock_in_photo_url: null,
  clock_out_photo_url: null,
  attendance_shift_id: null,
  leave_id: null,
  leave_type: null,
};

describe("buildRoster", () => {
  it("menghitung ringkasan per status dan memetakan absensi", () => {
    const { summary, employees } = buildRoster(
      [
        { ...base, attendance_id: "a1", clock_in: "2026-10-01T01:00:00Z", work_hours: "8.5", is_late: false },
        { ...base, employee_id: "e2", attendance_id: "a2", is_late: true, late_minutes: 15 },
        { ...base, employee_id: "e3", leave_id: "l1", leave_type: "annual" },
        { ...base, employee_id: "e4", has_schedule: false, scheduled_shift_id: null, shift_start: null },
      ],
      { date: "2026-10-01", today: "2026-10-02", isPublicHoliday: false, now: new Date("2026-10-02T03:00:00Z") }
    );
    expect(summary.hadir).toBe(1);
    expect(summary.terlambat).toBe(1);
    expect(summary.cuti).toBe(1);
    expect(summary.tanpa_jadwal).toBe(1);
    expect(summary.scheduled).toBe(3);
    expect(employees[0].attendance?.work_hours).toBe(8.5);
    expect(employees[2].leave).toEqual({ id: "l1", leave_type: "annual" });
    expect(employees[3].shift).toBeNull();
  });
});
