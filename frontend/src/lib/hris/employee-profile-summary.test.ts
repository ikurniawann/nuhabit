import { describe, expect, it } from "vitest";
import {
  calculateTenure,
  leaveBalanceUsage,
  summarizeAttendance,
} from "./employee-profile-summary";

describe("calculateTenure", () => {
  const now = new Date(2026, 9, 4);
  it("tahun dan bulan", () => {
    expect(calculateTenure("2024-07-01", now)).toBe("2 yr 3 mo");
  });
  it("lintas tahun dengan bulan lebih kecil tidak menggelembungkan tahun", () => {
    expect(calculateTenure("2025-12-01", now)).toBe("10 mo");
    expect(calculateTenure("2024-12-15", now)).toBe("1 yr 10 mo");
  });
  it("bulan yang sama → baru bergabung", () => {
    expect(calculateTenure("2026-10-01", now)).toBe("Just joined");
  });
  it("tanggal rusak → -", () => {
    expect(calculateTenure("x", now)).toBe("-");
  });
});

describe("summarizeAttendance", () => {
  it("menghitung hadir, terlambat, absen, dan total jam", () => {
    expect(
      summarizeAttendance([
        { status: "present", is_late: true, work_hours: 8 },
        { status: "present", work_hours: 7.5 },
        { status: "absent", work_hours: null },
      ])
    ).toEqual({ present: 2, late: 1, absent: 1, totalHours: 15.5 });
  });
});

describe("leaveBalanceUsage", () => {
  it("kolom baru *_days", () => {
    expect(leaveBalanceUsage({ total_days: 12, used_days: 3, remaining_days: 9 })).toEqual({
      remaining: 9,
      total: 12,
      used: 3,
      percent: 25,
    });
  });
  it("kolom lama dan batas 100%", () => {
    expect(leaveBalanceUsage({ quota: 2, used: 5, balance: -3 })).toEqual({
      remaining: -3,
      total: 2,
      used: 5,
      percent: 100,
    });
  });
});
