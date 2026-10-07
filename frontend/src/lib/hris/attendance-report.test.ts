import { describe, expect, it } from "vitest";
import { parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";
import {
  buildAttendancePdf,
  buildAttendanceXlsx,
  buildPeriodLabel,
  statusLabel,
  type AttendanceReportRow,
  buildAttendanceCsv,
  toDateString,
  toReportRows,
  type AttendanceExportRecord,
} from "./attendance-report";

const contoh = (over: Partial<AttendanceReportRow> = {}): AttendanceReportRow => ({
  date: "2026-08-27",
  employeeName: "Nanda Romdona",
  nip: "TMP-001",
  department: "Kitchen",
  position: "CDP Kitchen",
  clockIn: "2026-08-27T01:58:00Z",
  clockOut: "2026-08-27T08:58:00Z",
  workHours: 7,
  status: "present",
  isLate: false,
  lateMinutes: 0,
  notes: null,
  clockInPhotoPath: null,
  clockOutPhotoPath: null,
  ...over,
});

describe("buildPeriodLabel", () => {
  it("satu bulan penuh jadi ringkas", () => {
    expect(buildPeriodLabel("2026-08-01", "2026-08-31")).toBe("1–31 Agustus 2026");
  });
  it("lintas bulan dalam tahun sama", () => {
    expect(buildPeriodLabel("2026-08-25", "2026-09-05")).toBe("25 Agustus – 5 September 2026");
  });
});

describe("statusLabel", () => {
  it("status dikenal diterjemahkan; tak dikenal apa adanya", () => {
    expect(statusLabel("present")).toBe("Hadir");
    expect(statusLabel("late")).toBe("Terlambat");
    expect(statusLabel("custom")).toBe("custom");
    expect(statusLabel(null)).toBe("—");
  });
});

describe("buildAttendanceXlsx", () => {
  it("workbook memuat judul, periode, dan baris data", async () => {
    const buffer = await buildAttendanceXlsx([contoh()], {
      companyName: "Sulu",
      periodLabel: "1–31 Agustus 2026",
      employeeLabel: "Nanda Romdona",
      generatedAt: new Date("2026-08-28T03:00:00Z"),
    });
    const matrix = await parseXlsxToMatrix(buffer);
    const text = JSON.stringify(matrix);
    expect(text).toContain("Sulu — Rekap Absensi");
    expect(text).toContain("Periode: 1–31 Agustus 2026");
    expect(text).toContain("Nanda Romdona");
    expect(text).toContain("Hadir");
  });
});

describe("buildAttendancePdf", () => {
  it("menghasilkan PDF valid tanpa foto (placeholder aman)", async () => {
    const buffer = await buildAttendancePdf(
      [contoh(), contoh({ date: "2026-08-28", isLate: true, lateMinutes: 12, status: "late" })],
      {
        companyName: "Sulu",
        periodLabel: "1–31 Agustus 2026",
        employeeLabel: null,
        generatedAt: new Date("2026-08-28T03:00:00Z"),
      },
      async () => null
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("foto PNG ter-embed (ukuran PDF membesar)", async () => {
    // PNG 1x1 valid
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const tanpaFoto = await buildAttendancePdf([contoh()], {
      companyName: "S", periodLabel: "p", employeeLabel: null, generatedAt: new Date(0),
    }, async () => null);
    const denganFoto = await buildAttendancePdf(
      [contoh({ clockInPhotoPath: "attendance/x/a.png" })],
      { companyName: "S", periodLabel: "p", employeeLabel: null, generatedAt: new Date(0) },
      async () => ({ data: png, mime: "image/png" })
    );
    expect(denganFoto.subarray(0, 5).toString()).toBe("%PDF-");
    expect(denganFoto.length).toBeGreaterThan(tanpaFoto.length);
  });
});

describe("ekspor dari baris query", () => {
  const record = (overrides: Partial<AttendanceExportRecord> = {}): AttendanceExportRecord => ({
    date: "2026-08-27",
    clock_in: "2026-08-27T01:58:00Z",
    clock_out: null,
    clock_in_location: { latitude: -6.2, longitude: 106.8, address: "Kantor" },
    clock_out_location: null,
    work_hours: "8.5",
    break_minutes: null,
    status: "present",
    is_late: true,
    late_minutes: 5,
    notes: 'kata "kutip"',
    clock_in_photo_url: null,
    clock_out_photo_url: null,
    employee: { full_name: "Budi", nip: "EMP-1", department: { name: "Ops" }, job_title: null },
    ...overrides,
  });

  it("toDateString membaca objek Date dengan komponen lokal", () => {
    expect(toDateString(new Date(2026, 7, 27))).toBe("2026-08-27");
    expect(toDateString("2026-08-27T00:00:00Z")).toBe("2026-08-27");
  });

  it("toReportRows urut per karyawan lalu tanggal", () => {
    const rows = toReportRows([
      record({ date: "2026-08-28", employee: { full_name: "Budi" } }),
      record({ date: "2026-08-27", employee: { full_name: "Ani" } }),
      record({ date: "2026-08-27", employee: { full_name: "Budi" } }),
    ]);
    expect(rows.map((r) => `${r.employeeName} ${r.date}`)).toEqual([
      "Ani 2026-08-27",
      "Budi 2026-08-27",
      "Budi 2026-08-28",
    ]);
    expect(rows[0].workHours).toBe(8.5);
  });

  it("CSV: kolom berkutip, jam WIB, lokasi dengan alamat", () => {
    const [header, line] = buildAttendanceCsv([record()]).split("\n");
    expect(header.startsWith("NIP,Nama Karyawan")).toBe(true);
    expect(line).toContain('"EMP-1","Budi","Ops","-","2026-08-27"');
    expect(line).toMatch(/08[.:]58/);
    expect(line).toContain('"-6.2,106.8 (Kantor)"');
    expect(line).toContain('"Ya","5","kata ""kutip"""');
  });
});
