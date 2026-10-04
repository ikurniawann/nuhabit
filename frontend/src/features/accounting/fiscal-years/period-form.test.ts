import { describe, expect, it } from "vitest";
import { mergeRegeneratedPeriods, planOpenNextPeriod, togglePeriod, type FormPeriod } from "./period-form";

function period(no: number, status: "OPEN" | "CLOSED", name = `P${no}`): FormPeriod {
  return { key: `k${no}`, period_no: no, name, start_date: "2026-01-01", end_date: "2026-01-31", status };
}

describe("planOpenNextPeriod", () => {
  it("buka period setelah OPEN terakhir dan tutup yang sebelumnya", () => {
    const plan = planOpenNextPeriod([period(1, "OPEN", "Jan"), period(2, "CLOSED", "Feb"), period(3, "CLOSED")]);
    expect(plan?.next.period_no).toBe(2);
    expect(plan?.closedNames).toBe("Jan");
    expect(plan?.periods.map((p) => p.status)).toEqual(["CLOSED", "OPEN", "CLOSED"]);
  });

  it("tanpa period OPEN → buka CLOSED pertama; tidak ada berikutnya → null", () => {
    expect(planOpenNextPeriod([period(1, "CLOSED"), period(2, "CLOSED")])?.next.period_no).toBe(1);
    expect(planOpenNextPeriod([period(1, "CLOSED"), period(2, "OPEN")])).toBeNull();
  });
});

describe("mergeRegeneratedPeriods & togglePeriod", () => {
  it("pertahankan key dan nama lama, status ikut hasil generate", () => {
    const merged = mergeRegeneratedPeriods([period(1, "CLOSED", "Custom")], [
      { period_no: 1, name: "Januari 2026", start_date: "2026-01-01", end_date: "2026-01-31", status: "OPEN" },
      { period_no: 2, name: "Februari 2026", start_date: "2026-02-01", end_date: "2026-02-28", status: "CLOSED" },
    ]);
    expect(merged.map((p) => [p.key, p.name, p.status])).toEqual([
      ["k1", "Custom", "OPEN"],
      ["p-2", "Februari 2026", "CLOSED"],
    ]);
  });

  it("toggle membalik status satu period", () => {
    expect(togglePeriod([period(1, "OPEN"), period(2, "CLOSED")], "k2").map((p) => p.status)).toEqual(["OPEN", "OPEN"]);
  });
});
