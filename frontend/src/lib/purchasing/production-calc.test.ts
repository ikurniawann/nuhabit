import { describe, expect, it } from "vitest";
import {
  batchNumber,
  buildStockCoverage,
  buildWipCode,
  completionMessage,
  coverageModeForStatus,
  nextProductionNumber,
  planMaterialsFromBom,
  productionNumberPrefix,
  resolveMaterialConsumption,
  sumConversionCosts,
  weightedFinishedGoodsCost,
} from "./production-calc";

describe("buildStockCoverage", () => {
  const materials = [
    { id: "m1", raw_material_id: "rm-1", qty_planned: 10, qty_actual: 12, raw_material: { kode: "GULA", nama: "Gula" } },
    { id: "m2", raw_material_id: "rm-2", qty_planned: "5", qty_actual: null },
  ];
  const stock = new Map([
    ["rm-1", { id: "rm-1", qty_onhand: 11 }],
    ["rm-2", { id: "rm-2", qty_onhand: "8" }],
  ]);

  it("planned mode compares qty_planned with on-hand stock", () => {
    const coverage = buildStockCoverage(materials, stock, "planned");
    expect(coverage[0]).toMatchObject({ kode: "GULA", required_qty: 10, shortage_qty: 0, stock_status: "ENOUGH" });
    expect(coverage[1]).toMatchObject({ kode: "", nama: "rm-2", required_qty: 5, qty_onhand: 8 });
  });

  it("actual mode prefers qty_actual and falls back to qty_planned", () => {
    const coverage = buildStockCoverage(materials, stock, "actual");
    expect(coverage[0]).toMatchObject({ required_qty: 12, shortage_qty: 1, stock_status: "INSUFFICIENT" });
    expect(coverage[1].required_qty).toBe(5);
  });

  it("missing stock row counts as zero on hand", () => {
    const [row] = buildStockCoverage([materials[0]], new Map(), "planned");
    expect(row.shortage_qty).toBe(10);
  });
});

describe("coverageModeForStatus", () => {
  it("uses actual qty once production has started", () => {
    expect(coverageModeForStatus("IN_PROGRESS")).toBe("actual");
    expect(coverageModeForStatus("COMPLETED")).toBe("actual");
    expect(coverageModeForStatus("DRAFT")).toBe("planned");
  });
});

describe("numbering", () => {
  it("builds PROD-YYYYMM prefixes and increments the last sequence", () => {
    expect(productionNumberPrefix(new Date(2026, 9, 4))).toBe("PROD-202610");
    expect(nextProductionNumber("PROD-202610", "PROD-202610-0041")).toBe("PROD-202610-0042");
    expect(nextProductionNumber("PROD-202610", null)).toBe("PROD-202610-0001");
  });

  it("derives batch numbers and WIP codes", () => {
    expect(batchNumber("PROD-202610-0001")).toBe("PROD-202610-0001-B01");
    expect(buildWipCode("kopi-susu/aren 1L")).toBe("WPKOPISUSUAREN1L");
    expect(buildWipCode(null)).toBe("WPWIP");
    expect(buildWipCode("A".repeat(30))).toHaveLength(19);
  });
});

describe("planMaterialsFromBom", () => {
  it("scales BOM qty by waste factor and planned qty, priced at avg cost", () => {
    const [line] = planMaterialsFromBom(
      [{ raw_material_id: "rm-1", satuan_id: "u-1", qty_required: "2", waste_factor: "0.1" }],
      new Map([["rm-1", 1000]]),
      10
    );
    expect(line.qty_planned).toBeCloseTo(22);
    expect(line.qty_actual).toBeCloseTo(22);
    expect(line.unit_cost).toBe(1000);
    expect(line.total_cost).toBeCloseTo(22000);
  });

  it("prices unknown materials at zero", () => {
    const [line] = planMaterialsFromBom(
      [{ raw_material_id: "rm-x", satuan_id: null, qty_required: 1, waste_factor: 0 }],
      new Map(),
      3
    );
    expect(line.total_cost).toBe(0);
  });
});

describe("resolveMaterialConsumption", () => {
  it("user overrides win over stored qty_actual and planned qty", () => {
    const rows = resolveMaterialConsumption(
      [
        { id: "m1", raw_material_id: "rm-1", qty_planned: 10, qty_actual: 9, waste_qty: 1, unit_cost: 100 },
        { id: "m2", raw_material_id: "rm-2", qty_planned: 4, qty_actual: 0, unit_cost: "50" },
      ],
      new Map([["m1", { qty_actual: 7, waste_qty: 2 }]])
    );
    expect(rows[0]).toMatchObject({ qtyActual: 7, wasteQty: 2, unitCost: 100, totalCost: 700 });
    expect(rows[1]).toMatchObject({ qtyActual: 4, wasteQty: 0, unitCost: 50, totalCost: 200 });
  });
});

describe("costs", () => {
  it("sums conversion costs", () => {
    expect(sumConversionCosts({ overhead_cost: 1, labor_cost: 2, packaging_cost: 3, waste_cost: 4 })).toBe(10);
  });

  it("weights existing finished goods cost with the new batch", () => {
    expect(weightedFinishedGoodsCost(100, 5000, 100, 600000, 6000)).toEqual({ qtyAfter: 200, unitCost: 5500 });
    expect(weightedFinishedGoodsCost(0, 0, 0, 0, 6000)).toEqual({ qtyAfter: 0, unitCost: 6000 });
  });
});

describe("completionMessage", () => {
  it("mentions the POS sync only when a margin is given", () => {
    expect(completionMessage("PROD-1", 12500.4, null)).toBe("Produksi PROD-1 selesai. HPP aktual Rp12.500");
    expect(completionMessage("PROD-1", 12500, 40)).toBe(
      "Produksi PROD-1 selesai. HPP aktual Rp12.500 tersinkron ke POS. Margin POS 40%."
    );
  });
});
