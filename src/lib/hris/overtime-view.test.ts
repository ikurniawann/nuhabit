import { describe, expect, it } from "vitest";
import {
  EMPTY_OVERTIME_ASSIGN_FORM,
  countPendingEmployeeRequests,
  currentMonthValue,
  overtimeListParams,
  validateOvertimeAssignForm,
} from "./overtime-view";

describe("currentMonthValue", () => {
  it("format YYYY-MM dengan bulan dua digit", () => {
    expect(currentMonthValue(new Date(2026, 2, 15))).toBe("2026-03");
    expect(currentMonthValue(new Date(2026, 11, 1))).toBe("2026-12");
  });
});

describe("overtimeListParams", () => {
  it("memecah bulan jadi year + month", () => {
    expect(overtimeListParams("pending", "2026-10")).toEqual({ status: "pending", year: "2026", month: "10" });
  });

  it("status all dan bulan kosong tidak dikirim", () => {
    expect(overtimeListParams("all", "")).toEqual({ status: undefined, year: undefined, month: undefined });
  });
});

describe("validateOvertimeAssignForm", () => {
  const filled = {
    employee_id: "e1",
    date: "2026-10-04",
    start_time: "18:00",
    end_time: "21:00",
    reason: "stock opname",
  };

  it("urutan pesan galat sama seperti form", () => {
    expect(validateOvertimeAssignForm(EMPTY_OVERTIME_ASSIGN_FORM)).toBe("Pilih karyawan yang ditugaskan");
    expect(validateOvertimeAssignForm({ ...filled, end_time: "" })).toBe("Tanggal dan jam lembur wajib diisi");
    expect(validateOvertimeAssignForm({ ...filled, reason: " abc  " })).toBe(
      "Alasan/pekerjaan minimal 5 karakter"
    );
    expect(validateOvertimeAssignForm(filled)).toBeNull();
  });
});

describe("countPendingEmployeeRequests", () => {
  it("hanya pengajuan karyawan yang pending", () => {
    expect(
      countPendingEmployeeRequests([
        { source: "employee", status: "pending" },
        { source: "company", status: "pending" },
        { source: "employee", status: "approved" },
        { source: "employee", status: "pending" },
      ])
    ).toBe(2);
  });
});
