import { describe, expect, it } from "vitest";
import { allocateByValue, allocateEqually, allocateManual } from "./cogs-additional-cost";
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

describe("additional cost allocation", () => {
  it("allocates manually by amount share", () => {
    expect(allocateManual([{ po_item_id: "a", amount: 30 }, { po_item_id: "b", amount: 10 }])).toEqual([
      { po_item_id: "a", grn_item_id: undefined, jumlah_alokasi: 30, proportion: 0.75 },
      { po_item_id: "b", grn_item_id: undefined, jumlah_alokasi: 10, proportion: 0.25 },
    ]);
  });

  it("allocates by value and equally with 2-decimal rounding", () => {
    expect(allocateByValue([{ target: { po_item_id: "a" }, value: 1 }, { target: { po_item_id: "b" }, value: 2 }], 3, 100)).toEqual([
      { po_item_id: "a", jumlah_alokasi: 33.33, proportion: 1 / 3 },
      { po_item_id: "b", jumlah_alokasi: 66.67, proportion: 2 / 3 },
    ]);
    expect(allocateByValue([{ target: { grn_item_id: "g" }, value: 5 }], 0, 100)[0].jumlah_alokasi).toBe(0);
    expect(allocateEqually([{ grn_item_id: "x" }, { grn_item_id: "y" }, { grn_item_id: "z" }], 100)[0]).toEqual({
      grn_item_id: "x",
      jumlah_alokasi: 33.33,
      proportion: 1 / 3,
    });
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
