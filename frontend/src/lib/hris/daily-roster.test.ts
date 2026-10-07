import { describe, expect, test } from "vitest";
import { deriveRosterStatus, isOverdue, type RosterStatusInput } from "./daily-roster";

const base: RosterStatusInput = {
  hasAttendance: false,
  isLate: false,
  onApprovedLeave: false,
  hasSchedule: true,
  shiftId: "shift-1",
  isPastDate: false,
};

describe("deriveRosterStatus", () => {
  test("hadir bila ada absensi tanpa terlambat", () => {
    expect(deriveRosterStatus({ ...base, hasAttendance: true })).toBe("hadir");
  });

  test("terlambat bila ada absensi dengan is_late", () => {
    expect(deriveRosterStatus({ ...base, hasAttendance: true, isLate: true })).toBe(
      "terlambat"
    );
  });

  test("absensi menang atas cuti approved", () => {
    expect(
      deriveRosterStatus({ ...base, hasAttendance: true, onApprovedLeave: true })
    ).toBe("hadir");
  });

  test("cuti bila tidak absen tapi ada cuti approved", () => {
    expect(deriveRosterStatus({ ...base, onApprovedLeave: true })).toBe("cuti");
  });

  test("cuti menang atas jadwal libur", () => {
    expect(
      deriveRosterStatus({ ...base, onApprovedLeave: true, shiftId: null })
    ).toBe("cuti");
  });

  test("belum_absen bila terjadwal dan tanggal belum lewat", () => {
    expect(deriveRosterStatus(base)).toBe("belum_absen");
  });

  test("absen (mangkir) bila terjadwal dan tanggal sudah lewat", () => {
    expect(deriveRosterStatus({ ...base, isPastDate: true })).toBe("absen");
  });

  test("libur bila pola ada tapi shift null", () => {
    expect(deriveRosterStatus({ ...base, shiftId: null })).toBe("libur");
  });

  test("libur tetap libur meski tanggal sudah lewat", () => {
    expect(deriveRosterStatus({ ...base, shiftId: null, isPastDate: true })).toBe(
      "libur"
    );
  });

  test("tanpa_jadwal bila tidak ada pola sama sekali", () => {
    expect(
      deriveRosterStatus({ ...base, hasSchedule: false, shiftId: null })
    ).toBe("tanpa_jadwal");
  });
});

// EPIC-036 Fase C — prioritas: hadir > cuti > libur_nasional > libur > absen
describe("deriveRosterStatus — hari libur nasional", () => {
  test("libur_nasional bila terjadwal tapi tanggalnya hari libur", () => {
    expect(deriveRosterStatus({ ...base, isPublicHoliday: true })).toBe("libur_nasional");
  });

  test("karyawan terjadwal TIDAK dihitung mangkir di hari libur yang sudah lewat", () => {
    expect(
      deriveRosterStatus({ ...base, isPublicHoliday: true, isPastDate: true })
    ).toBe("libur_nasional");
  });

  test("absensi menang atas hari libur (karyawan tetap masuk)", () => {
    expect(
      deriveRosterStatus({ ...base, isPublicHoliday: true, hasAttendance: true })
    ).toBe("hadir");
  });

  test("cuti approved menang atas hari libur", () => {
    expect(
      deriveRosterStatus({ ...base, isPublicHoliday: true, onApprovedLeave: true })
    ).toBe("cuti");
  });

  test("libur_nasional menang atas libur pola shift", () => {
    expect(
      deriveRosterStatus({ ...base, isPublicHoliday: true, shiftId: null })
    ).toBe("libur_nasional");
  });

  test("libur_nasional menang atas tanpa_jadwal", () => {
    expect(
      deriveRosterStatus({
        ...base,
        isPublicHoliday: true,
        hasSchedule: false,
        shiftId: null,
      })
    ).toBe("libur_nasional");
  });

  test("tanpa flag hari libur, perilaku lama tidak berubah", () => {
    expect(deriveRosterStatus({ ...base, isPastDate: true })).toBe("absen");
  });
});

describe("isOverdue", () => {
  // Shift Pagi 08:00 WIB = 01:00 UTC; toleransi 10 menit
  const shift = {
    start_time: "08:00:00",
    end_time: "16:00:00",
    is_overnight: false,
    late_tolerance_minutes: 10,
  };
  const date = "2026-07-17";

  test("belum overdue sebelum jam mulai + toleransi", () => {
    const now = new Date("2026-07-17T01:05:00Z"); // 08:05 WIB
    expect(isOverdue(now, date, shift, "belum_absen")).toBe(false);
  });

  test("overdue setelah jam mulai + toleransi terlewati", () => {
    const now = new Date("2026-07-17T01:11:00Z"); // 08:11 WIB
    expect(isOverdue(now, date, shift, "belum_absen")).toBe(true);
  });

  test("hanya berlaku untuk status belum_absen", () => {
    const now = new Date("2026-07-17T05:00:00Z");
    expect(isOverdue(now, date, shift, "hadir")).toBe(false);
    expect(isOverdue(now, date, shift, "cuti")).toBe(false);
    expect(isOverdue(now, date, shift, "absen")).toBe(false);
  });

  test("false bila shift tidak diketahui", () => {
    const now = new Date("2026-07-17T05:00:00Z");
    expect(isOverdue(now, date, null, "belum_absen")).toBe(false);
  });

  test("shift malam overnight dihitung dari jam mulai di tanggal yang sama", () => {
    const night = {
      start_time: "22:00:00",
      end_time: "06:00:00",
      is_overnight: true,
      late_tolerance_minutes: 10,
    };
    const before = new Date("2026-07-17T14:30:00Z"); // 21:30 WIB
    const after = new Date("2026-07-17T15:15:00Z"); // 22:15 WIB
    expect(isOverdue(before, date, night, "belum_absen")).toBe(false);
    expect(isOverdue(after, date, night, "belum_absen")).toBe(true);
  });
});
