/**
 * Ekspor CSV & data grafik halaman Laporan HRIS. Murni, tanpa DOM: komponen
 * tinggal mengunduh teks hasil hrisReportCsv.
 */

import { toCsv } from "@/lib/recruitment/candidate-csv";
import type { buildHrisReport } from "./reports-summary";

export type HrisReport = ReturnType<typeof buildHrisReport>;

export type HrisReportCsvKind = "headcount" | "absensi" | "cuti" | "hris-lengkap";

const STATUS_LABELS: Record<string, string> = {
  permanent: "Tetap",
  contract: "Kontrak",
  probation: "Probasi",
  internship: "Magang",
  resigned: "Resign",
  terminated: "PHK",
  suspended: "Suspend",
};

const statusLabel = (status: string) => STATUS_LABELS[status] || status;

/** Irisan pie "Komposisi Status Karyawan". */
export const statusSlices = (report: HrisReport) =>
  report.headcount.by_status.map((s) => ({ name: statusLabel(s.status), value: s.count }));

/** ("absensi", 3, 2026) → "laporan-absensi-2026-03.csv" */
export const hrisReportFileName = (kind: HrisReportCsvKind, month: number, year: number) =>
  `laporan-${kind}-${year}-${String(month).padStart(2, "0")}.csv`;

function csvRows(report: HrisReport, kind: HrisReportCsvKind): unknown[][] {
  const { headcount: h, attendance: a, leaves: l } = report;
  const byDepartment = h.by_department.map((d) => [d.name, d.count]);
  switch (kind) {
    case "headcount":
      return [["Departemen", "Jumlah Karyawan"], ...byDepartment];
    case "absensi":
      return [
        ["Metrik", "Nilai"],
        ["Total Catatan", a.total_records],
        ["Hadir", a.present_count],
        ["Tidak Hadir", a.absent_count],
        ["Terlambat", a.late_count],
        ["Tingkat Kehadiran (%)", a.present_rate],
        ["Tingkat Keterlambatan (%)", a.late_rate],
        ["Rata-rata Jam Kerja", a.avg_work_hours],
      ];
    case "cuti":
      return [["Jenis Cuti", "Total Hari"], ...l.by_type.map((t) => [t.type, t.days])];
    case "hris-lengkap":
      return [
        ["Keterangan", "Nilai"],
        ["=== RINGKASAN HEADCOUNT ===", ""],
        ["Total Karyawan Aktif", h.total_active],
        ["Karyawan Baru Bulan Ini", h.new_hires],
        ["Turnover Tahun Ini", h.turnover_count],
        ["Tingkat Turnover (%)", h.turnover_rate],
        ["", ""],
        ["=== KOMPOSISI STATUS ===", ""],
        ...statusSlices(report).map((s) => [s.name, s.value]),
        ["", ""],
        ["=== HEADCOUNT PER DEPARTEMEN ===", ""],
        ...byDepartment,
        ["", ""],
        ["=== STATISTIK ABSENSI ===", ""],
        ["Tingkat Kehadiran (%)", a.present_rate],
        ["Tingkat Keterlambatan (%)", a.late_rate],
        ["Rata-rata Jam Kerja", a.avg_work_hours],
        ["Total Tidak Hadir", a.absent_count],
        ["", ""],
        ["=== RINGKASAN CUTI ===", ""],
        ["Total Pengajuan Disetujui", l.approved_count],
        ["Total Hari Cuti", l.total_days],
        ["Menunggu Persetujuan", l.pending_count],
      ];
  }
}

/** Teks CSV dengan BOM UTF-8 supaya Excel membaca huruf non-ASCII dengan benar. */
export const hrisReportCsv = (report: HrisReport, kind: HrisReportCsvKind) =>
  `﻿${toCsv(csvRows(report, kind))}`;
