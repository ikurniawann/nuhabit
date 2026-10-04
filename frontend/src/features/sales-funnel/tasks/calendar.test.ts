import { describe, expect, test } from "vitest";
import {
  bucketByDay,
  dayKey,
  monthGrid,
  shiftAnchor,
  startOfWeek,
  visibleRange,
  weekDays,
} from "./calendar";

describe("kalender tasks (EPIC-050 T-1.5)", () => {
  test("startOfWeek = Senin; Minggu masuk minggu sebelumnya", () => {
    // 13 Sep 2026 = Minggu → Senin 7 Sep
    expect(dayKey(startOfWeek(new Date(2026, 8, 13)))).toBe("2026-09-07");
    // 14 Sep 2026 = Senin → tetap
    expect(dayKey(startOfWeek(new Date(2026, 8, 14)))).toBe("2026-09-14");
  });

  test("monthGrid 42 sel mulai Senin sebelum tanggal 1, inMonth benar", () => {
    const grid = monthGrid(new Date(2026, 8, 15)); // Sep 2026: tgl 1 = Selasa
    expect(grid).toHaveLength(42);
    expect(grid[0].key).toBe("2026-08-31");
    expect(grid[0].inMonth).toBe(false);
    expect(grid[1].key).toBe("2026-09-01");
    expect(grid[1].inMonth).toBe(true);
    expect(grid.filter((c) => c.inMonth)).toHaveLength(30);
  });

  test("weekDays 7 hari Senin–Minggu", () => {
    const days = weekDays(new Date(2026, 8, 10));
    expect(days.map((d) => d.key)).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13",
    ]);
  });

  test("visibleRange bulan mencakup seluruh grid; hari = satu tanggal", () => {
    const { from, to } = visibleRange(new Date(2026, 8, 15), "month");
    expect(dayKey(from)).toBe("2026-08-31");
    expect(dayKey(to)).toBe("2026-10-11");
    const day = visibleRange(new Date(2026, 8, 15), "day");
    expect(dayKey(day.from)).toBe("2026-09-15");
    expect(dayKey(day.to)).toBe("2026-09-15");
  });

  test("shiftAnchor per mode", () => {
    expect(dayKey(shiftAnchor(new Date(2026, 8, 15), "month", 1))).toBe("2026-10-01");
    expect(dayKey(shiftAnchor(new Date(2026, 8, 15), "week", -1))).toBe("2026-09-08");
    expect(dayKey(shiftAnchor(new Date(2026, 8, 15), "day", 1))).toBe("2026-09-16");
  });

  test("bucketByDay mengelompokkan & mengurutkan; tanpa due dibuang", () => {
    const local = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();
    const map = bucketByDay([
      { id: "a", due_at: local(2026, 9, 15, 14) },
      { id: "b", due_at: local(2026, 9, 15, 9) },
      { id: "c", due_at: null },
      { id: "d", due_at: "rusak" },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("2026-09-15")?.map((t) => t.id)).toEqual(["b", "a"]);
  });
});
