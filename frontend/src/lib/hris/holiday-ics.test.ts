import { describe, expect, test } from "vitest";
import { parseIcs, toHolidayCandidates } from "./holiday-ics";

/**
 * Potongan nyata dari kalender Google `id.indonesian#holiday@group.v.calendar.google.com`,
 * dipangkas seperlunya tapi mempertahankan semua jebakan formatnya:
 * baris terlipat (folding), koma ter-escape, DTSTART date-only, entri
 * "(belum pasti)", entri yang BUKAN tanggal merah, dan satu event di luar tahun
 * yang diminta.
 */
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260817",
  "DTEND;VALUE=DATE:20260818",
  "UID:20260817_hari-kemerdekaan@google.com",
  "SUMMARY:Hari Kemerdekaan Republik Indonesia",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260320",
  "UID:20260320_cuti-bersama@google.com",
  "SUMMARY:Cuti Bersama Idul Fitri",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260531",
  "UID:20260531_waisak@google.com",
  // Baris terlipat RFC 5545: lanjutan diawali satu spasi, dan spasi itu adalah
  // PEMBATAS yang ikut dibuang — lipatannya boleh jatuh di tengah kata.
  "SUMMARY:Hari Raya Waisak 2570 B",
  " E (belum pasti)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260219",
  "UID:20260219_ramadan@google.com",
  "SUMMARY:1 Ramadan",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261231",
  "UID:20261231_malam-tahun-baru@google.com",
  "SUMMARY:Malam Tahun Baru",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260101",
  "UID:20260101_tahun-baru@google.com",
  // koma ter-escape harus dipulihkan
  "SUMMARY:Tahun Baru 2026 Masehi\\, Hari Libur Nasional",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20270101",
  "UID:20270101_tahun-baru@google.com",
  "SUMMARY:Tahun Baru 2027 Masehi",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  const events = parseIcs(ICS);

  test("membaca seluruh VEVENT", () => {
    expect(events).toHaveLength(7);
  });

  test("DTSTART date-only menjadi YYYY-MM-DD tanpa geser timezone", () => {
    expect(events[0]).toMatchObject({
      date: "2026-08-17",
      name: "Hari Kemerdekaan Republik Indonesia",
      uid: "20260817_hari-kemerdekaan@google.com",
    });
  });

  test("baris terlipat disambung kembali", () => {
    expect(events[2].name).toBe("Hari Raya Waisak 2570 BE (belum pasti)");
  });

  test("koma ter-escape dipulihkan", () => {
    expect(events[5].name).toBe("Tahun Baru 2026 Masehi, Hari Libur Nasional");
  });

  test("teks tanpa VEVENT menghasilkan daftar kosong, bukan lempar", () => {
    expect(parseIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toEqual([]);
    expect(parseIcs("")).toEqual([]);
  });
});

describe("toHolidayCandidates", () => {
  const candidates = toHolidayCandidates(parseIcs(ICS), 2026);

  test("hanya tahun yang diminta", () => {
    expect(candidates.every((c) => c.holiday_date.startsWith("2026-"))).toBe(true);
    expect(candidates).toHaveLength(6);
  });

  test("terurut menurut tanggal", () => {
    const dates = candidates.map((c) => c.holiday_date);
    expect(dates).toEqual([...dates].sort());
  });

  test("'Cuti Bersama' terdeteksi dan MEMOTONG jatah cuti", () => {
    const cutiBersama = candidates.find((c) => c.name.startsWith("Cuti Bersama"))!;
    expect(cutiBersama.type).toBe("cuti_bersama");
    expect(cutiBersama.deducts_leave).toBe(true);
    expect(cutiBersama.suggested).toBe(true);
  });

  test("libur nasional biasa tidak memotong jatah dan dicentang default", () => {
    const merdeka = candidates.find((c) => c.holiday_date === "2026-08-17")!;
    expect(merdeka.type).toBe("nasional");
    expect(merdeka.deducts_leave).toBe(false);
    expect(merdeka.suggested).toBe(true);
    expect(merdeka.status).toBe("aktif");
  });

  test("entri yang BUKAN tanggal merah tidak dicentang otomatis", () => {
    for (const date of ["2026-02-19", "2026-12-31"]) {
      const row = candidates.find((c) => c.holiday_date === date)!;
      expect(row.suggested).toBe(false);
      expect(row.reason).toBeTruthy();
    }
  });

  test("entri '(belum pasti)' masuk sebagai draft, bukan langsung aktif", () => {
    const waisak = candidates.find((c) => c.holiday_date === "2026-05-31")!;
    expect(waisak.status).toBe("draft");
    expect(waisak.reason).toMatch(/belum pasti/i);
  });

  test("source_ref dibawa dari UID supaya impor ulang idempoten", () => {
    const merdeka = candidates.find((c) => c.holiday_date === "2026-08-17")!;
    expect(merdeka.source_ref).toBe("20260817_hari-kemerdekaan@google.com");
  });
});
