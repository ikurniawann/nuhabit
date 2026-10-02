import { describe, expect, it } from "vitest";
import { computeFreeSlots, isOnTimeOff, windowsForDate } from "./pt";

describe("computeFreeSlots", () => {
  it("membagi jendela ketersediaan per 30 menit sesuai durasi program", () => {
    expect(computeFreeSlots({ windows: [{ start_time: "09:00", end_time: "11:00" }], busy: [], durationMinutes: 60 })).toEqual([
      "09:00",
      "09:30",
      "10:00",
    ]);
  });

  it("membuang slot yang bertabrakan dengan kelas / PT coach", () => {
    const slots = computeFreeSlots({
      windows: [{ start_time: "09:00", end_time: "13:00" }],
      busy: [{ start_time: "10:00", end_time: "11:00" }],
      durationMinutes: 60,
    });
    expect(slots).toEqual(["09:00", "11:00", "11:30", "12:00"]);
  });

  it("memotong slot yang sudah lewat untuk hari ini dan menyelaraskan ke kelipatan 30", () => {
    expect(
      computeFreeSlots({ windows: [{ start_time: "09:10", end_time: "12:00" }], busy: [], durationMinutes: 60, notBefore: 10 * 60 + 5 })
    ).toEqual(["10:30", "11:00"]);
  });

  it("menggabungkan beberapa jendela tanpa duplikat", () => {
    expect(
      computeFreeSlots({
        windows: [
          { start_time: "06:00", end_time: "07:00" },
          { start_time: "06:30", end_time: "08:00" },
        ],
        busy: [],
        durationMinutes: 60,
      })
    ).toEqual(["06:00", "06:30", "07:00"]);
  });
});

describe("ketersediaan per tanggal", () => {
  const rows = [
    { weekday: 1, start_time: "09:00", end_time: "12:00", is_active: true },
    { weekday: 1, start_time: "13:00", end_time: "15:00", is_active: false },
    { weekday: 2, start_time: "09:00", end_time: "12:00", is_active: true },
  ];
  it("hanya jendela aktif di hari yang sama", () => {
    expect(windowsForDate(rows, "2026-10-05")).toHaveLength(1); // Senin
  });
  it("mendeteksi cuti", () => {
    expect(isOnTimeOff([{ date_from: "2026-10-05", date_to: "2026-10-07" }], "2026-10-06")).toBe(true);
    expect(isOnTimeOff([{ date_from: "2026-10-05", date_to: "2026-10-07" }], "2026-10-08")).toBe(false);
  });
});
