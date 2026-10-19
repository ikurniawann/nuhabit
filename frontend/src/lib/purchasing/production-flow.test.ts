import { describe, expect, it } from "vitest";
import {
  buildIssuePayload,
  buildReceiptPayload,
  canSubmitReceipt,
  initIssueRows,
  initReceiptForm,
  issueShortages,
  previewReceipt,
  variantRemainder,
  type ProductionFlow,
  type ProductionFlowMaterial,
} from "./production-flow";

const material = (over: Partial<ProductionFlowMaterial>): ProductionFlowMaterial => ({
  id: "m1",
  raw_material_id: "rm1",
  kode: "F",
  nama: "Tepung",
  satuan: "kg",
  qty_planned: 5,
  qty_issued: 0,
  qty_remaining: 5,
  unit_cost: 10000,
  issued_cost: 0,
  qty_onhand: 10,
  recipe_qty: null,
  recipe_satuan: null,
  unit_factor: null,
  ...over,
});

function flow(over: Partial<ProductionFlow> = {}): ProductionFlow {
  return {
    order: {
      id: "o1",
      nomor_produksi: "PROD-1",
      status: "IN_PROGRESS",
      production_context: "product",
      output_type: "FINISHED_GOOD",
      item_kode: "R",
      item_nama: "Roti",
      planned_qty: 10,
      actual_qty: 4,
      planned_material_cost: 70000,
      overhead_cost: 5000,
      labor_cost: 0,
      packaging_cost: 0,
      waste_cost: 0,
      conversion_cost: 5000,
      hpp_per_unit: 7500,
      started_at: null,
      completed_at: null,
    },
    materials: [],
    issues: [],
    batches: [],
    wip: {
      issued_cost: 70000,
      received_material_cost: 28000,
      scrap_cost: 0,
      wip_value: 42000,
      conversion_cost: 5000,
      conversion_applied: 2000,
      std_material_per_unit: 7000,
      qty_good: 4,
      qty_scrap: 1,
      qty_remaining: 5,
      yield_pct: 80,
      planned_yield_pct: 40,
    },
    can_issue: true,
    can_receive: true,
    stepped: true,
    variant_skus: [],
    ...over,
  };
}

describe("issue form", () => {
  it("starts from the remaining plan capped by stock and drops empty rows", () => {
    const materials = [material({}), material({ id: "m2", qty_remaining: 3, qty_onhand: 1.5 })];
    const rows = initIssueRows(materials);
    expect(rows).toEqual([
      { materialId: "m1", qty: "5" },
      { materialId: "m2", qty: "1.5" },
    ]);
    rows[1].qty = "0";
    expect(buildIssuePayload(rows, "  shift pagi ")).toEqual({
      lines: [{ material_id: "m1", qty: 5 }],
      catatan: "shift pagi",
    });
    rows[0].qty = "11";
    expect(issueShortages(rows, materials)).toEqual(["m1"]);
  });
});

describe("receipt form", () => {
  it("previews a partial batch at the standard cost", () => {
    const f = flow();
    const form = { ...initReceiptForm(f), final: false, qtyGood: "4" };
    expect(previewReceipt(f, form)).toEqual({ material: 28000, conversion: 2000, scrap: 0, total: 30000, hpp: 7500 });
  });

  it("gives the final batch the rest and new conversion costs", () => {
    const f = flow();
    const form = { ...initReceiptForm(f), qtyGood: "4", qtyScrap: "1", overhead: "6000" };
    expect(previewReceipt(f, form)).toEqual({ material: 42000, conversion: 4000, scrap: 0, total: 46000, hpp: 11500 });
    expect(buildReceiptPayload(form, false)).toEqual({
      qty_good: 4,
      qty_scrap: 1,
      final: true,
      overhead_cost: 6000,
      labor_cost: 0,
      packaging_cost: 0,
      waste_cost: 0,
    });
  });

  it("writes the WIP off when the final batch has no good units", () => {
    const f = flow();
    const form = { ...initReceiptForm(f), qtyGood: "0", qtyScrap: "2" };
    expect(previewReceipt(f, form)).toMatchObject({ scrap: 42000, total: 0, hpp: 0 });
    expect(canSubmitReceipt(form, false)).toBe(true);
    expect(canSubmitReceipt({ ...form, qtyScrap: "0" }, false)).toBe(false);
  });

  it("needs the variant split to match the good units", () => {
    const f = flow({ variant_skus: [{ id: "s1", sku: "M", name: "M" }, { id: "s2", sku: "L", name: "L" }] });
    const form = { ...initReceiptForm(f), qtyGood: "2", variants: { s1: "1.5", s2: "" } };
    expect(variantRemainder(form)).toBe(0.5);
    expect(canSubmitReceipt(form, true)).toBe(false);
    form.variants.s2 = "0.5";
    expect(canSubmitReceipt(form, true)).toBe(true);
    expect(buildReceiptPayload({ ...form, final: false }, true)).toEqual({
      qty_good: 2,
      qty_scrap: 0,
      final: false,
      variant_output: [
        { pos_sku_id: "s1", qty: 1.5 },
        { pos_sku_id: "s2", qty: 0.5 },
      ],
    });
  });
});
