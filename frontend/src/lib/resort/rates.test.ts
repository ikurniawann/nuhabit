import { describe, expect, it } from "vitest";
import { eachNight, isWeekendNight, nightlyRate, nightsBetween, quoteStay, stayOverlaps } from "./rates";

const type = { id: "t1", name: "Family Cabin", rate_weekday: 1_500_000, rate_weekend: 2_000_000, extra_bed_rate: 250_000 };

describe("resort rates", () => {
  it("hitung malam & daftar tanggal (check-out tidak dihitung)", () => {
    expect(nightsBetween("2026-09-10", "2026-09-13")).toBe(3);
    expect(nightsBetween("2026-09-10", "2026-09-10")).toBe(0);
    expect(eachNight("2026-09-10", "2026-09-13")).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
  });

  it("malam Jumat & Sabtu memakai tarif weekend", () => {
    expect(isWeekendNight("2026-09-11")).toBe(true); // Jumat
    expect(isWeekendNight("2026-09-12")).toBe(true); // Sabtu
    expect(isWeekendNight("2026-09-13")).toBe(false); // Minggu
    expect(nightlyRate(type, "2026-09-10").rate).toBe(1_500_000);
    expect(nightlyRate(type, "2026-09-11").rate).toBe(2_000_000);
  });

  it("musim menimpa tarif dasar: harga tetap & surcharge persen", () => {
    const fixed = [{ room_type_id: null, label: "Nataru", start_date: "2026-12-24", end_date: "2027-01-04", rate: 3_000_000 }];
    expect(nightlyRate(type, "2026-12-25", fixed)).toMatchObject({ rate: 3_000_000, season: "Nataru" });
    const pct = [{ room_type_id: null, label: "Long Weekend", start_date: "2026-09-10", end_date: "2026-09-10", surcharge_percent: 20 }];
    expect(nightlyRate(type, "2026-09-10", pct).rate).toBe(1_800_000);
    // Musim khusus tipe menang atas musim semua tipe
    const both = [
      { room_type_id: null, label: "Umum", start_date: "2026-09-10", end_date: "2026-09-10", rate: 1_000_000 },
      { room_type_id: "t1", label: "Khusus Cabin", start_date: "2026-09-10", end_date: "2026-09-10", rate: 2_500_000 },
    ];
    expect(nightlyRate(type, "2026-09-10", both)).toMatchObject({ rate: 2_500_000, season: "Khusus Cabin" });
  });

  it("quoteStay menjumlahkan malam + extra bed", () => {
    const q = quoteStay({ type, checkIn: "2026-09-10", checkOut: "2026-09-13", extraBed: 1 });
    // Kamis 1,5jt + Jumat 2jt + Sabtu 2jt = 5,5jt; extra bed 250rb × 3 malam
    expect(q.nights).toBe(3);
    expect(q.room_subtotal).toBe(5_500_000);
    expect(q.extra_bed_total).toBe(750_000);
    expect(q.subtotal).toBe(6_250_000);
    expect(q.breakdown.map((b) => b.weekend)).toEqual([false, true, true]);
  });

  it("stayOverlaps: check-out sama dengan check-in tidak bentrok", () => {
    const a = { check_in: "2026-09-10", check_out: "2026-09-12" };
    expect(stayOverlaps(a, { check_in: "2026-09-12", check_out: "2026-09-14" })).toBe(false);
    expect(stayOverlaps(a, { check_in: "2026-09-11", check_out: "2026-09-14" })).toBe(true);
    expect(stayOverlaps(a, { check_in: "2026-09-08", check_out: "2026-09-11" })).toBe(true);
    expect(stayOverlaps(a, { check_in: "2026-09-08", check_out: "2026-09-10" })).toBe(false);
  });
});
