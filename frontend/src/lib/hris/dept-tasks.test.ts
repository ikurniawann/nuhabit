import { describe, expect, it } from "vitest";
import { monthRange, normalizeDeptTask, occurrenceDatesFor, splitSubtaskWeights } from "./dept-tasks";

const base = { weekly_day: null, monthly_day: null, due_date: null };

describe("occurrenceDatesFor", () => {
  it("daily: setiap tanggal dalam rentang", () => {
    const out = occurrenceDatesFor(
      { ...base, recurrence: "daily" },
      "2026-09-01",
      "2026-09-05"
    );
    expect(out).toEqual([
      "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
    ]);
  });

  it("weekly: hanya hari yang dipilih (1=Senin)", () => {
    // 2026-09-07 adalah Senin
    const out = occurrenceDatesFor(
      { ...base, recurrence: "weekly", weekly_day: 1 },
      "2026-09-01",
      "2026-09-30"
    );
    expect(out).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("monthly: hanya tanggal yang dipilih", () => {
    const out = occurrenceDatesFor(
      { ...base, recurrence: "monthly", monthly_day: 15 },
      "2026-09-01",
      "2026-10-31"
    );
    expect(out).toEqual(["2026-09-15", "2026-10-15"]);
  });

  it("once: muncul hanya bila jatuh tempo di dalam rentang", () => {
    const task = { ...base, recurrence: "once" as const, due_date: "2026-09-10" };
    expect(occurrenceDatesFor(task, "2026-09-01", "2026-09-30")).toEqual(["2026-09-10"]);
    expect(occurrenceDatesFor(task, "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("rentang terbalik / tanggal rusak → kosong", () => {
    expect(
      occurrenceDatesFor({ ...base, recurrence: "daily" }, "2026-09-05", "2026-09-01")
    ).toEqual([]);
  });
});

describe("monthRange", () => {
  it("akhir bulan termasuk kabisat", () => {
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("splitSubtaskWeights", () => {
  it("dibagi rata, sisa pembulatan ke sub-task terakhir (total 100)", () => {
    const weights = splitSubtaskWeights(["a", "b", "c"]).map((s) => s.weight);
    expect(weights).toEqual([33.33, 33.33, 33.34]);
    expect(splitSubtaskWeights([])).toEqual([]);
  });
});

describe("normalizeDeptTask", () => {
  it.each([
    [{ title: "ab" }, "Judul task minimal 3 karakter"],
    [{ title: "Cek stok", recurrence: "tahunan" }, "Jenis pengulangan tidak dikenal"],
    [{ title: "Cek stok" }, "Task sekali jalan membutuhkan tanggal jatuh tempo"],
    [{ title: "Cek stok", recurrence: "weekly", weekly_day: 8 }, "Task mingguan membutuhkan hari (Senin–Minggu)"],
    [{ title: "Cek stok", recurrence: "monthly", monthly_day: 31 }, "Task bulanan membutuhkan tanggal 1–28"],
  ])("%o → %s", (body, message) => {
    expect(normalizeDeptTask(body)).toBe(message);
  });

  it("task mingguan valid: hanya kolom yang relevan terisi", () => {
    const task = normalizeDeptTask({
      title: " Bersih gudang ",
      recurrence: "weekly",
      weekly_day: "3",
      monthly_day: 5,
      due_date: "2026-10-10",
      subtasks: [{ title: "Sapu" }, { title: " " }, { title: "Pel" }],
    });
    expect(task).toMatchObject({
      title: "Bersih gudang",
      weeklyDay: 3,
      monthlyDay: null,
      dueDate: null,
      subtasks: [
        { title: "Sapu", weight: 50 },
        { title: "Pel", weight: 50 },
      ],
    });
  });
});
