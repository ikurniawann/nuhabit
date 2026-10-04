import { describe, expect, it } from "vitest";
import { buildHrisReport } from "./reports-summary";
import { hrisReportCsv, hrisReportFileName, statusSlices } from "./hris-reports-csv";

const report = buildHrisReport(
  {
    employees: [
      { id: "a", employment_status: "permanent", is_active: true, department_id: "d1", join_date: "2025-01-10", end_date: null },
      { id: "b", employment_status: "probation", is_active: true, department_id: "d1", join_date: "2026-06-05", end_date: null },
      { id: "c", employment_status: "freelance", is_active: true, department_id: null, join_date: "2026-01-05", end_date: null },
    ],
    departments: [{ id: "d1", name: 'Bar "Utama"' }],
    attendance: [{ status: "present", is_late: true, work_hours: 8, date: "2026-06-02" }],
    leaves: [{ leave_type: "sick", status: "approved", total_days: 3 }],
  },
  6,
  2026
);

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\n");

describe("hrisReportFileName", () => {
  it("bulan dua digit", () => {
    expect(hrisReportFileName("absensi", 3, 2026)).toBe("laporan-absensi-2026-03.csv");
    expect(hrisReportFileName("hris-lengkap", 11, 2025)).toBe("laporan-hris-lengkap-2025-11.csv");
  });
});

describe("statusSlices", () => {
  it("label Indonesia, status tak dikenal apa adanya", () => {
    expect(statusSlices(report)).toEqual([
      { name: "Tetap", value: 1 },
      { name: "Probasi", value: 1 },
      { name: "freelance", value: 1 },
    ]);
  });
});

describe("hrisReportCsv", () => {
  it("diawali BOM dan meng-escape kutip", () => {
    const csv = hrisReportCsv(report, "headcount");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)).toEqual(['"Departemen","Jumlah Karyawan"', '"Bar ""Utama""","2"']);
  });

  it("absensi dan cuti", () => {
    expect(lines(hrisReportCsv(report, "absensi"))).toContain('"Tingkat Kehadiran (%)","100"');
    expect(lines(hrisReportCsv(report, "cuti"))).toEqual(['"Jenis Cuti","Total Hari"', '"Sakit","3"']);
  });

  it("laporan lengkap memuat semua bagian", () => {
    const all = lines(hrisReportCsv(report, "hris-lengkap"));
    expect(all[0]).toBe('"Keterangan","Nilai"');
    expect(all).toContain('"Total Karyawan Aktif","3"');
    expect(all).toContain('"Probasi","1"');
    expect(all).toContain('"Menunggu Persetujuan","0"');
    // Penanda bagian diawali "=" dinetralkan supaya tidak dibaca sebagai formula.
    expect(all[1]).toBe(`"'=== RINGKASAN HEADCOUNT ===",""`);
  });
});
