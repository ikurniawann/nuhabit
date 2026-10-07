import { describe, expect, it } from "vitest";
import { buildHrisReport, monthRange, type HrisReportRows } from "./reports-summary";

const rows: HrisReportRows = {
  employees: [
    { id: "a", employment_status: "permanent", is_active: true, department_id: "d1", join_date: "2025-01-10", end_date: null },
    { id: "b", employment_status: "contract", is_active: true, department_id: "d1", join_date: "2026-06-05", end_date: null },
    { id: "c", employment_status: "resigned", is_active: false, department_id: "d2", join_date: "2024-03-01", end_date: "2026-04-30" },
    { id: "d", employment_status: "permanent", is_active: true, department_id: null, join_date: "2026-02-01", end_date: null },
  ],
  departments: [
    { id: "d1", name: "Bar" },
    { id: "d2", name: "Kitchen" },
  ],
  attendance: [
    { status: "present", is_late: true, work_hours: 8, date: "2026-06-02" },
    { status: "present", is_late: false, work_hours: 7, date: "2026-06-01" },
    { status: "absent", is_late: null, work_hours: null, date: "2026-06-01" },
  ],
  leaves: [
    { leave_type: "annual", status: "approved", total_days: 2 },
    { leave_type: "sick", status: "approved", total_days: 3 },
    { leave_type: "annual", status: "pending", total_days: 1 },
  ],
};

describe("monthRange", () => {
  it("Desember melompat ke tahun berikutnya", () => {
    expect(monthRange(12, 2026)).toEqual({ start: "2026-12-01", end: "2027-01-01" });
    expect(monthRange(6, 2026)).toEqual({ start: "2026-06-01", end: "2026-07-01" });
  });
});

describe("buildHrisReport", () => {
  const report = buildHrisReport(rows, 6, 2026);

  it("headcount, turnover dan departemen", () => {
    expect(report.period).toEqual({ month: 6, year: 2026 });
    expect(report.headcount).toMatchObject({
      total_active: 3,
      new_hires: 1,
      turnover_count: 1,
      turnover_rate: 25,
      by_status: [
        { status: "permanent", count: 2 },
        { status: "contract", count: 1 },
      ],
      by_department: [{ name: "Bar", count: 2 }],
    });
    expect(report.headcount.monthly_trend.map((m) => m.count)).toEqual([2, 3, 3, 3, 2, 3]);
  });

  it("absensi: rasio satu desimal dan tren harian terurut", () => {
    expect(report.attendance).toMatchObject({
      total_records: 3,
      present_count: 2,
      absent_count: 1,
      late_count: 1,
      present_rate: 66.7,
      late_rate: 50,
      avg_work_hours: 5,
    });
    expect(report.attendance.daily_trend.map(({ present, absent, late }) => [present, absent, late])).toEqual([
      [1, 1, 0],
      [1, 0, 1],
    ]);
  });

  it("cuti: hanya approved yang dijumlah, label Indonesia urut terbanyak", () => {
    expect(report.leaves).toEqual({
      approved_count: 2,
      pending_count: 1,
      total_days: 5,
      by_type: [
        { type: "Sakit", days: 3 },
        { type: "Tahunan", days: 2 },
      ],
    });
  });

  it("data kosong tidak membagi nol", () => {
    const empty = buildHrisReport({ employees: [], departments: [], attendance: [], leaves: [] }, 1, 2026);
    expect(empty.headcount.turnover_rate).toBe(0);
    expect(empty.attendance.present_rate).toBe(0);
    expect(empty.attendance.avg_work_hours).toBe(0);
  });
});
