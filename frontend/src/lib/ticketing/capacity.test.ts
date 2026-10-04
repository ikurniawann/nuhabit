import { describe, expect, test } from "vitest";
import {
  CAPACITY_HOLDING_BOOKING_STATUSES,
  isCapacityExceeded,
  resolveDailyCapacity,
  slotWindowStatus,
  type CapacityDateRange,
} from "./capacity";

const range = (
  start: string,
  end: string,
  capacity: number,
  is_active = true
): CapacityDateRange => ({
  start_date: start,
  end_date: end,
  capacity,
  is_active,
});

describe("resolveDailyCapacity", () => {
  test("tanpa default & tanpa override → unlimited (null)", () => {
    expect(resolveDailyCapacity("2026-08-01", null, [])).toBeNull();
  });

  test("default venue dipakai bila tak ada override", () => {
    expect(resolveDailyCapacity("2026-08-01", 500, [])).toBe(500);
  });

  test("override menang atas default (termasuk menaikkan)", () => {
    const overrides = [range("2026-08-01", "2026-08-07", 1000)];
    expect(resolveDailyCapacity("2026-08-03", 500, overrides)).toBe(1000);
  });

  test("override menang atas default unlimited (membatasi)", () => {
    const overrides = [range("2026-08-01", "2026-08-07", 200)];
    expect(resolveDailyCapacity("2026-08-03", null, overrides)).toBe(200);
  });

  test("tanggal di luar rentang override → balik ke default", () => {
    const overrides = [range("2026-08-01", "2026-08-07", 1000)];
    expect(resolveDailyCapacity("2026-08-08", 500, overrides)).toBe(500);
  });

  test("rentang inklusif di kedua ujung", () => {
    const overrides = [range("2026-08-01", "2026-08-07", 100)];
    expect(resolveDailyCapacity("2026-08-01", 500, overrides)).toBe(100);
    expect(resolveDailyCapacity("2026-08-07", 500, overrides)).toBe(100);
  });

  test("overlap antar override → kapasitas TERKECIL menang (konservatif)", () => {
    const overrides = [
      range("2026-08-01", "2026-08-31", 1000),
      range("2026-08-15", "2026-08-20", 300),
    ];
    expect(resolveDailyCapacity("2026-08-17", 500, overrides)).toBe(300);
    expect(resolveDailyCapacity("2026-08-10", 500, overrides)).toBe(1000);
  });

  test("capacity 0 = tanggal tutup (menang atas apapun)", () => {
    const overrides = [
      range("2026-08-01", "2026-08-31", 1000),
      range("2026-08-17", "2026-08-17", 0),
    ];
    expect(resolveDailyCapacity("2026-08-17", 500, overrides)).toBe(0);
  });

  test("override non-aktif diabaikan", () => {
    const overrides = [range("2026-08-01", "2026-08-07", 100, false)];
    expect(resolveDailyCapacity("2026-08-03", 500, overrides)).toBe(500);
  });

  test("tanggal tidak valid → throw (pola resolver pricing)", () => {
    expect(() => resolveDailyCapacity("2026-02-30", 500, [])).toThrow();
    expect(() => resolveDailyCapacity("bukan-tanggal", 500, [])).toThrow();
  });
});

describe("isCapacityExceeded", () => {
  test("unlimited (null) tidak pernah melebihi", () => {
    expect(isCapacityExceeded(null, 999999, 100)).toBe(false);
  });

  test("pas di batas kapasitas → tidak melebihi", () => {
    expect(isCapacityExceeded(100, 98, 2)).toBe(false);
  });

  test("melewati batas → melebihi", () => {
    expect(isCapacityExceeded(100, 99, 2)).toBe(true);
  });

  test("kapasitas 0 → tambahan berapa pun melebihi", () => {
    expect(isCapacityExceeded(0, 0, 1)).toBe(true);
  });

  test("tambahan 0 orang tidak pernah melebihi (read-only check)", () => {
    expect(isCapacityExceeded(100, 100, 0)).toBe(false);
  });
});

describe("CAPACITY_HOLDING_BOOKING_STATUSES", () => {
  test("berisi tepat status yang memegang kuota (keputusan desain #2)", () => {
    expect([...CAPACITY_HOLDING_BOOKING_STATUSES].sort()).toEqual(
      ["digunakan", "menunggu-bayar", "terbayar"].sort()
    );
  });
});

describe("slotWindowStatus (EPIC-031 Fase D)", () => {
  const slot = { start: "10:00:00", end: "12:00:00" };

  test("dalam jendela slot → ok", () => {
    expect(slotWindowStatus("10:30", slot.start, slot.end, 30)).toBe("ok");
  });

  test("grace SEBELUM mulai: start-grace inklusif → ok", () => {
    expect(slotWindowStatus("09:30", slot.start, slot.end, 30)).toBe("ok");
    expect(slotWindowStatus("09:29", slot.start, slot.end, 30)).toBe("terlalu-awal");
  });

  test("grace SETELAH selesai: end+grace inklusif → ok", () => {
    expect(slotWindowStatus("12:30", slot.start, slot.end, 30)).toBe("ok");
    expect(slotWindowStatus("12:31", slot.start, slot.end, 30)).toBe("terlambat");
  });

  test("grace 0 = jendela persis", () => {
    expect(slotWindowStatus("09:59", slot.start, slot.end, 0)).toBe("terlalu-awal");
    expect(slotWindowStatus("10:00", slot.start, slot.end, 0)).toBe("ok");
    expect(slotWindowStatus("12:00", slot.start, slot.end, 0)).toBe("ok");
    expect(slotWindowStatus("12:01", slot.start, slot.end, 0)).toBe("terlambat");
  });

  test("format HH:MM dan HH:MM:SS sama-sama diterima", () => {
    expect(slotWindowStatus("11:00:00", "10:00", "12:00", 0)).toBe("ok");
  });
});
