import { describe, expect, it } from "vitest";
import { nextWeekday, parseQuickCapture, quickCapturePayload, scheduleFor } from "./quick-capture";

// Senin 26 Oktober 2026.
const today = "2026-10-26";

describe("parseQuickCapture", () => {
  it("keeps a plain title due today", () => {
    expect(parseQuickCapture("  Siapkan laporan  harian ", today)).toEqual({
      title: "Siapkan laporan harian",
      due_date: today,
      recurrence: "once",
    });
  });

  it("reads due words and priority marks from the end", () => {
    expect(parseQuickCapture("Kirim laporan stok besok !!", today)).toEqual({
      title: "Kirim laporan stok",
      due_date: "2026-10-27",
      recurrence: "once",
      priority: "urgent",
    });
    expect(parseQuickCapture("Telepon vendor lusa !", today)).toMatchObject({ title: "Telepon vendor", due_date: "2026-10-28", priority: "high" });
    expect(parseQuickCapture("Rapat tim hari ini", today)).toMatchObject({ title: "Rapat tim", due_date: today });
  });

  it("reads a weekday as the next one, at least tomorrow", () => {
    expect(parseQuickCapture("Bayar supplier jumat", today)).toMatchObject({ title: "Bayar supplier", due_date: "2026-10-30" });
    expect(parseQuickCapture("Rekap absensi senin", today)).toMatchObject({ title: "Rekap absensi", due_date: "2026-11-02" });
    expect(nextWeekday("2026-10-31", 0)).toBe("2026-11-01");
  });

  it("reads a cadence phrase", () => {
    expect(parseQuickCapture("Cek stok setiap hari", today)).toMatchObject({ title: "Cek stok", recurrence: "daily" });
    expect(parseQuickCapture("Laporan setiap minggu", today)).toMatchObject({ title: "Laporan", recurrence: "weekly" });
    expect(parseQuickCapture("Tutup buku setiap bulan !", today)).toMatchObject({ title: "Tutup buku", recurrence: "monthly", priority: "high" });
  });

  it("never eats the whole title", () => {
    expect(parseQuickCapture("besok", today)).toMatchObject({ title: "besok" });
    expect(parseQuickCapture("   ", today)).toBeNull();
  });
});

describe("scheduleFor and quickCapturePayload", () => {
  it("derives the weekday and day of month from the due date", () => {
    expect(scheduleFor("weekly", "2026-10-30")).toEqual({ weekly_day: 5, monthly_day: null, due_date: null });
    expect(scheduleFor("weekly", "2026-11-01")).toEqual({ weekly_day: 7, monthly_day: null, due_date: null });
    expect(scheduleFor("monthly", "2026-10-31")).toEqual({ weekly_day: null, monthly_day: 28, due_date: null });
    expect(scheduleFor("once", today)).toEqual({ weekly_day: null, monthly_day: null, due_date: today });
  });

  it("builds the create body for the signed-in employee", () => {
    const q = parseQuickCapture("Cek stok setiap hari !!", today);
    expect(quickCapturePayload(q!, "e-1", "d-1")).toEqual({
      title: "Cek stok",
      recurrence: "daily",
      weekly_day: null,
      monthly_day: null,
      due_date: null,
      priority: "urgent",
      assignee_employee_id: "e-1",
      department_id: "d-1",
      subtasks: [],
    });
  });
});
