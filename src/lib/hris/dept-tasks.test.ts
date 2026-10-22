import { describe, expect, it } from "vitest";
import { occurrenceDatesFor } from "./dept-tasks";

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

  it("task rutin tidak dijadwalkan sebelum tanggal dibuat; sekali jalan tetap di tanggal jatuh temponya", () => {
    expect(
      occurrenceDatesFor({ ...base, recurrence: "daily", created_date: "2026-09-04" }, "2026-09-01", "2026-09-05")
    ).toEqual(["2026-09-04", "2026-09-05"]);
    expect(
      occurrenceDatesFor({ ...base, recurrence: "daily", created_date: "2026-08-20" }, "2026-09-01", "2026-09-02")
    ).toEqual(["2026-09-01", "2026-09-02"]);
    expect(
      occurrenceDatesFor({ ...base, recurrence: "once", due_date: "2026-09-02", created_date: "2026-09-04" }, "2026-09-01", "2026-09-30")
    ).toEqual(["2026-09-02"]);
  });
});
