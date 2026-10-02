import { describe, expect, it } from "vitest";
import { axisHeight, axisOffset, buildTimeAxis, coachLoad, hourRange, layoutOverlaps, monthBounds, monthGrid, shiftMonth } from "./calendar";

const ev = (id: string, start_time: string, end_time: string) => ({ id, start_time, end_time });

describe("layoutOverlaps", () => {
  it("event yang tidak bertabrakan tetap satu lajur penuh", () => {
    const out = layoutOverlaps([ev("a", "06:00", "07:00"), ev("b", "07:00", "08:00")]);
    expect(out.map((o) => [o.item.id, o.lane, o.lanes])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
  });

  it("dua kelas di jam yang sama dibuat berdampingan", () => {
    const out = layoutOverlaps([ev("a", "17:00", "18:00"), ev("b", "17:00", "18:00")]);
    expect(out.map((o) => o.lanes)).toEqual([2, 2]);
    expect(new Set(out.map((o) => o.lane))).toEqual(new Set([0, 1]));
  });

  it("lebar lajur dihitung per kelompok, lajur kosong dipakai ulang", () => {
    const out = layoutOverlaps([
      ev("a", "17:00", "18:00"),
      ev("b", "17:30", "18:30"),
      ev("c", "18:00", "19:00"), // memakai lajur a lagi, masih satu kelompok dengan b
      ev("d", "20:00", "21:00"), // kelompok baru → penuh
    ]);
    const by = Object.fromEntries(out.map((o) => [o.item.id, o]));
    expect(by.a.lanes).toBe(2);
    expect(by.c.lane).toBe(by.a.lane);
    expect(by.d).toMatchObject({ lane: 0, lanes: 1 });
  });
});

describe("grid bulan", () => {
  it("42 hari mulai Senin, memuat seluruh bulan", () => {
    const grid = monthGrid("2026-10-15");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-28"); // Senin sebelum 1 Okt (Kamis)
    expect(grid).toContain("2026-10-31");
    expect(monthBounds("2026-10-15")).toEqual({ from: "2026-09-28", to: "2026-11-08" });
  });

  it("geser bulan melewati tahun", () => {
    expect(shiftMonth("2026-12-20", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-05", -1)).toBe("2025-12-01");
  });
});

describe("hourRange & coachLoad", () => {
  it("melebarkan rentang default bila ada kelas lebih pagi/malam", () => {
    expect(hourRange([])).toEqual([6, 21]);
    expect(hourRange([ev("a", "05:30", "06:30"), ev("b", "20:00", "21:30")])).toEqual([5, 22]);
  });

  it("menjumlah menit mengajar per coach, sesi batal tidak dihitung", () => {
    const load = coachLoad([
      { ...ev("1", "17:00", "18:00"), coach_id: "c1", coach_name: "Andra", status: "scheduled" },
      { ...ev("2", "18:00", "19:00"), coach_id: "c1", coach_name: "Andra", status: "completed" },
      { ...ev("3", "06:00", "07:00"), coach_id: "c1", coach_name: "Andra", status: "cancelled" },
      { ...ev("4", "06:00", "07:00"), coach_id: null, coach_name: null, status: "scheduled" },
    ]);
    expect(load).toEqual([
      { coach_id: "c1", coach_name: "Andra", minutes: 120, sessions: 2 },
      { coach_id: null, coach_name: "Tanpa coach", minutes: 60, sessions: 1 },
    ]);
  });
});

describe("buildTimeAxis", () => {
  const nuhabit = [ev("a", "06:00", "07:00"), ev("b", "08:00", "09:00"), ev("c", "17:00", "18:00"), ev("d", "19:00", "20:00")];

  it("menciutkan celah siang menjadi satu pita, jam pagi & sore tetap penuh", () => {
    expect(buildTimeAxis(nuhabit)).toEqual([
      { kind: "hours", from: 6, to: 9 },
      { kind: "gap", from: 9, to: 17 },
      { kind: "hours", from: 17, to: 20 },
    ]);
  });

  it("celah 1 jam tidak diciutkan dan grid kosong memakai rentang default", () => {
    expect(buildTimeAxis([ev("a", "06:00", "07:00"), ev("b", "08:00", "09:00")])).toEqual([{ kind: "hours", from: 6, to: 9 }]);
    expect(buildTimeAxis([])).toEqual([{ kind: "hours", from: 6, to: 21 }]);
  });

  it("memetakan menit ke piksel melewati pita celah", () => {
    const axis = buildTimeAxis(nuhabit);
    expect(axisOffset(axis, 6 * 60, 60, 30)).toBe(0);
    expect(axisOffset(axis, 7 * 60 + 30, 60, 30)).toBe(90);
    expect(axisOffset(axis, 12 * 60, 60, 30)).toBe(180 + 15); // di dalam celah → tengah pita
    expect(axisOffset(axis, 17 * 60, 60, 30)).toBe(210);
    expect(axisHeight(axis, 60, 30)).toBe(180 + 30 + 180);
  });
});
