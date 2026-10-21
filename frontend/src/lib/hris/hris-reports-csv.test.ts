import { describe, expect, it } from "vitest";
import { hrisReportCsv, hrisReportFileName, statusSlices, type HrisReport } from "./hris-reports-csv";

const report: HrisReport = {
  period: { month: 6, year: 2026 },
  headcount: {
    total_active: 3,
    new_hires: 1,
    turnover_count: 0,
    turnover_rate: 0,
    by_status: [
      { status: "permanent", count: 1 },
      { status: "probation", count: 1 },
      { status: "freelance", count: 1 },
    ],
    by_department: [{ name: 'Bar "Utama"', count: 2 }],
    monthly_trend: [
      { month: "Jan 26", count: 2 },
      { month: "Feb 26", count: 2 },
      { month: "Mar 26", count: 2 },
      { month: "Apr 26", count: 2 },
      { month: "Mei 26", count: 2 },
      { month: "Jun 26", count: 3 },
    ],
  },
  attendance: {
    total_records: 1,
    present_count: 1,
    absent_count: 0,
    late_count: 1,
    present_rate: 100,
    late_rate: 100,
    avg_work_hours: 8,
    daily_trend: [{ date: "02 Jun", present: 1, absent: 0, late: 1 }],
  },
  leaves: {
    approved_count: 1,
    pending_count: 0,
    total_days: 3,
    by_type: [{ type: "Sakit", days: 3 }],
  },
};

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
