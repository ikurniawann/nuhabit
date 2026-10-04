import { describe, expect, it } from "vitest";
import {
  buildStockWarnings,
  estimateBomCost,
  marginLabel,
  marginVsSellingPrice,
  overheadRateFromSetting,
  unitCostForBomLine,
} from "./cogs-estimate";
import {
  buildMonthlyTrends,
  daysOverdue,
  percentChange,
  resolveDashboardPeriod,
  sumPoValue,
} from "./dashboard-data";
import { countBy } from "./production-recipes";
import { summarizeWip } from "./production-wip";

describe("COGS estimate", () => {
  const stock = { id: "rm-1", avg_cost: "12000", konversi_factor: 1000, satuan_besar_id: "kg", satuan_kecil_id: "g", qty_onhand: 5 };

  it("converts the unit cost to the BOM line unit", () => {
    expect(unitCostForBomLine(12000, "kg", stock)).toBe(12000);
    expect(unitCostForBomLine(12000, "g", stock)).toBe(12);
    expect(unitCostForBomLine(12000, "g", null)).toBe(12000);
  });

  it("adds overhead on top of material cost", () => {
    const lines = [{ material_id: "rm-1", satuan_id: "g", qty_required: 100, waste_factor: 0.1, material: { nama: "Kopi" } }];
    const stockMap = new Map([["rm-1", stock]]);

    const product = estimateBomCost(lines, stockMap, 0.1, { convertUnits: true });
    expect(product.total_bom_cost).toBe(1320);
    expect(product.total_overhead).toBe(132);
    expect(product.hpp_per_unit).toBe(1452);
    expect(product.overhead_rate).toBe(10);
    expect(product.breakdown[0]).toMatchObject({ unit_cost: 12, effective_qty: 110, source_product_id: null, material_type: "PURCHASED" });

    const raw = estimateBomCost(lines, stockMap, 0.1, { convertUnits: false });
    expect(raw.breakdown[0].unit_cost).toBe(12000);
    expect(raw.breakdown[0]).not.toHaveProperty("source_product_id");
  });

  it("derives overhead rate, margin and warnings", () => {
    expect(overheadRateFromSetting("15")).toBe(0.15);
    expect(overheadRateFromSetting(null)).toBe(0.1);
    expect(marginVsSellingPrice(20000, 12000)).toEqual({ margin: 8000, marginPct: 40 });
    expect(marginVsSellingPrice(0, 12000)).toEqual({ margin: null, marginPct: null });
    expect([null, 31, 20, 10].map(marginLabel)).toEqual([null, "Healthy", "Acceptable", "Thin"]);
    expect(buildStockWarnings([{ nama: "Kopi", jumlah: 2, qty_available: 5 }, { nama: "Gula", jumlah: 1, qty_available: 50 }])).toEqual([
      { nama: "Kopi", qty_available: 5, required_per_unit: 2, stock_coverage_units: 2.5 },
    ]);
  });
});

describe("COGS estimate with landed cost", () => {
  it("adds each material's landed cost rate and overhead on top (same numbers as the Go route test)", () => {
    const lines = [{ material_id: "rice", satuan_id: "kg", qty_required: 0.2, waste_factor: 0.1 }];
    const stockMap = new Map([["rice", { id: "rice", avg_cost: "12000", satuan_besar_id: "kg" }]]);
    const estimate = estimateBomCost(lines, stockMap, 0.1, { convertUnits: true }, new Map([["rice", 0.1]]));
    expect(estimate).toMatchObject({ total_bom_cost: 2640, total_additional_cost: 264, total_overhead: 290.4, hpp_per_unit: 3194.4 });
    expect(estimate.breakdown[0]).toMatchObject({ subtotal: 2640, landed_cost_rate: 10, additional_cost: 264 });
    expect(estimateBomCost(lines, stockMap, 0.1, { convertUnits: true }).hpp_per_unit).toBe(2904);
  });
});

describe("dashboard calculations", () => {
  it("defaults the period to the current month and shifts it back one month", () => {
    const period = resolveDashboardPeriod(null, null, new Date(2026, 9, 15, 10));
    expect(period.start).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(period.end).toEqual(new Date(2026, 9, 31, 23, 59, 59, 999));
    expect(period.prevStart).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0));
    expect(resolveDashboardPeriod("2026-01-01", "2026-01-31").start).toEqual(new Date("2026-01-01"));
  });

  it("computes percent change, PO value and overdue days", () => {
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(1, 3)).toBe(-66.7);
    expect(percentChange(5, 0)).toBe(0);
    expect(sumPoValue([{ grand_total: "1000.5", total: 1 }, { grand_total: null, total: "200" }, {}])).toBe(1200.5);
    expect(daysOverdue("2026-10-01T00:00:00Z", new Date("2026-10-04T12:00:00Z"))).toBe(3);
    expect(daysOverdue("2026-10-10", new Date("2026-10-04"))).toBe(0);
    expect(daysOverdue(null)).toBe(0);
  });

  it("groups monthly PO value by source type", () => {
    expect(
      buildMonthlyTrends([
        { created_at: "2026-09-10T00:00:00Z", source_type: "pr", grand_total: "100" },
        { created_at: "2026-09-11T00:00:00Z", total: 50 },
        { created_at: "2026-10-01T05:00:00Z", source_type: "pr", grand_total: 70 },
        { created_at: "2026-09-12T00:00:00Z", source_type: "pr", grand_total: 30 },
      ])
    ).toEqual([
      { month: "Sep", pr: 130, manual: 50 },
      { month: "Okt", pr: 70 },
    ]);
  });
});

describe("production helpers", () => {
  it("counts rows per key", () => {
    expect(countBy([{ k: "a" }, { k: "b" }, { k: "a" }], (row) => row.k)).toEqual(new Map([["a", 2], ["b", 1]]));
  });

  it("summarizes WIP stock", () => {
    expect(summarizeWip([{ qty_onhand: 2, avg_cost: 100 }, { qty_onhand: 0, avg_cost: 50 }])).toEqual({
      total_wip: 2,
      ready_wip: 1,
      total_qty: 2,
      total_value: 200,
    });
  });
});
