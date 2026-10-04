import { describe, expect, it } from "vitest";
import {
  displayName,
  hasRecipe,
  isActiveProductionStatus,
  matchesItemKeyword,
  optionsLabel,
  paginate,
  productionStatusLabel,
  shortagePoHref,
  toNumber,
} from "./production-ui-display";
import {
  aggregateAdditionalCosts,
  buildCreateOrderPayload,
  buildQuickCompletePayload,
  countShortMaterials,
  createAdditionalCostLine,
  estimateProductionOrder,
} from "./production-ui-order-form";
import {
  buildCompletePayload,
  canSubmitComplete,
  completeFormReducer,
  completePreview,
  initCompleteForm,
  isVariantBalanced,
  variantRemainder,
} from "./production-ui-complete";
import { bomDraftError, bomDraftFromRow, newBomDraft, recalculateBomDraft } from "./production-ui-bom";
import type { RawMaterialWithStock } from "@/types/purchasing";
import type { CogsData, ProductionDetail, ProductionMaterial } from "./production-ui-types";

const material = (overrides: Partial<ProductionMaterial> = {}): ProductionMaterial => ({
  id: "pm-1",
  raw_material_id: "rm-1",
  qty_planned: "10",
  qty_actual: 0,
  waste_qty: "0",
  unit_cost: "1500",
  total_cost: "15000",
  raw_material: { kode: "RM-01", nama: "Gula Pasir 1712345678901" },
  satuan: { nama: "gram" },
  stock: { qty_onhand: 4, required_qty: 10, shortage_qty: 6, stock_status: "INSUFFICIENT" },
  ...overrides,
});

const order = (overrides: Partial<ProductionDetail> = {}): ProductionDetail => ({
  id: "po-1",
  nomor_produksi: "PRD/2026/001",
  planned_qty: "20",
  actual_qty: "0",
  status: "IN_PROGRESS",
  planned_material_cost: "15000",
  actual_material_cost: "0",
  overhead_cost: "5000",
  labor_cost: "2000",
  packaging_cost: "1000",
  waste_cost: "0",
  hpp_per_unit: "0",
  created_at: "2026-10-04T03:00:00Z",
  materials: [material()],
  batches: [],
  ...overrides,
});

describe("production display helpers", () => {
  it("coerces numeric strings and junk", () => {
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(null)).toBe(0);
  });

  it("strips import timestamps from names", () => {
    expect(displayName("Gula Pasir 1712345678901")).toBe("Gula Pasir");
    expect(displayName(null)).toBe("-");
  });

  it("labels and classifies statuses", () => {
    expect(productionStatusLabel("RELEASED")).toBe("Dirilis");
    expect(productionStatusLabel("UNKNOWN")).toBe("UNKNOWN");
    expect(isActiveProductionStatus("IN_PROGRESS")).toBe(true);
    expect(isActiveProductionStatus("COMPLETED")).toBe(false);
  });

  it("detects recipes and matches keywords", () => {
    expect(hasRecipe({ total_bahan_baku: "2" })).toBe(true);
    expect(hasRecipe({ total_bahan_baku: null })).toBe(false);
    const item = { nama: "Roti Tawar", kode: "PRD-01", kategori: "Bakery" };
    expect(matchesItemKeyword(item, "bakery")).toBe(true);
    expect(matchesItemKeyword(item, "kopi")).toBe(false);
    expect(matchesItemKeyword(item, "")).toBe(true);
  });

  it("paginates with at least one page", () => {
    expect(paginate([1, 2, 3], 2, 2)).toEqual({ rows: [3], totalPages: 2 });
    expect(paginate([], 1, 10)).toEqual({ rows: [], totalPages: 1 });
  });

  it("joins variant options", () => {
    expect(optionsLabel({ warna: "Merah", ukuran: "XL" })).toBe("Merah / XL");
    expect(optionsLabel(null)).toBe("");
  });

  it("builds the shortage PO link with rounded-up qty", () => {
    const href = shortagePoHref("/po/new", { id: "po-1", nomor_produksi: "PRD/001" }, [
      material({ stock: { qty_onhand: 0, required_qty: 2.2, shortage_qty: 2.2, stock_status: "INSUFFICIENT" } }),
    ]);
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/po/new");
    expect(url.searchParams.get("production_order")).toBe("PRD/001");
    expect(JSON.parse(url.searchParams.get("items") || "[]")).toEqual([
      { id: "rm-1", kode: "RM-01", nama: "Gula Pasir", qty: 3, unit: "gram", price: 1500 },
    ]);
  });
});

describe("create order form", () => {
  it("aggregates cost lines, folding OTHER into overhead and ignoring negatives", () => {
    const lines = [
      { ...createAdditionalCostLine("a"), type: "LABOR" as const, amount: "1000" },
      { ...createAdditionalCostLine("b"), type: "OTHER" as const, amount: "500" },
      { ...createAdditionalCostLine("c"), type: "PACKAGING" as const, amount: "-20" },
    ];
    expect(aggregateAdditionalCosts(lines)).toEqual({ overhead: 500, labor: 1000, packaging: 0, total: 1500 });
  });

  it("estimates HPP and shortages for the planned qty", () => {
    const cogs: CogsData = {
      hpp_per_unit: 0,
      total_bom_cost: 2000,
      total_overhead: 0,
      breakdown_bahan: [
        { bahan_id: "a", kode: "A", nama: "A", jumlah: 1, satuan: "g", qty_available: 5, qty_on_order: 0, unit_cost: 1000, waste_percentage: 0, effective_qty: 1, subtotal: 1000 },
        { bahan_id: "b", kode: "B", nama: "B", jumlah: 1, satuan: "g", qty_available: 100, qty_on_order: 0, unit_cost: 1000, waste_percentage: 0, effective_qty: 1, subtotal: 1000 },
      ],
    };
    const estimate = estimateProductionOrder(cogs, 10, 5000);
    expect(estimate.materialCost).toBe(20000);
    expect(estimate.totalCost).toBe(25000);
    expect(estimate.hppPerUnit).toBe(2500);
    expect(estimate.shortages.map((row) => row.bahan_id)).toEqual(["a"]);
    expect(estimateProductionOrder(null, 0, 0).hppPerUnit).toBe(0);
  });

  it("builds product and raw material payloads", () => {
    const costs = { overhead: 1, labor: 2, packaging: 3, total: 6 };
    expect(buildCreateOrderPayload(true, { id: "p1", production_output_type: "WIP" }, 5, costs)).toEqual({
      production_context: "product",
      product_id: "p1",
      output_type: "WIP",
      planned_qty: 5,
      overhead_cost: 1,
      labor_cost: 2,
      packaging_cost: 3,
    });
    expect(buildCreateOrderPayload(false, { id: "r1" }, 5, costs)).toEqual({
      production_context: "raw_material",
      raw_material_id: "r1",
      planned_qty: 5,
      overhead_cost: 1,
      labor_cost: 2,
      packaging_cost: 3,
    });
  });

  it("builds the quick complete payload from stored values", () => {
    const detail = order({ materials: [material({ qty_actual: 0, qty_planned: "7", waste_qty: "1" })] });
    expect(countShortMaterials(detail)).toBe(1);
    expect(buildQuickCompletePayload(detail)).toEqual({
      action: "complete",
      actual_qty: 20,
      overhead_cost: 5000,
      labor_cost: 2000,
      packaging_cost: 1000,
      waste_cost: 0,
      materials: [{ id: "pm-1", qty_actual: 7, waste_qty: 1 }],
    });
  });
});

describe("complete form reducer", () => {
  const variantOrder = order({
    variant_required: true,
    materials: [material({ stock: { qty_onhand: 50, required_qty: 10, shortage_qty: 0, stock_status: "ENOUGH" } })],
    pos_skus: [
      { id: "s1", sku: "TS-M", name: "Kaos M" },
      { id: "s2", sku: "TS-L", name: "Kaos L" },
      { id: "s3", sku: "TS-XL", name: "Kaos XL" },
    ],
  });

  it("initialises from the order, falling back to planned values", () => {
    const form = initCompleteForm(variantOrder);
    expect(form.actualQty).toBe("20");
    expect(form.materials[0]).toMatchObject({ name: "Gula Pasir", qtyActual: "10", stockQty: 50, unitCost: 1500 });
    expect(form.variantOutput.map((row) => row.qty)).toEqual(["0", "0", "0"]);
  });

  it("updates fields, materials and variants immutably", () => {
    const form = initCompleteForm(variantOrder);
    let next = completeFormReducer(form, { type: "setField", field: "overheadCost", value: "9000" });
    next = completeFormReducer(next, { type: "setMaterial", id: "pm-1", field: "qtyActual", value: "12" });
    next = completeFormReducer(next, { type: "setVariantQty", posSkuId: "s2", value: "4" });
    expect(next.overheadCost).toBe("9000");
    expect(next.materials[0].qtyActual).toBe("12");
    expect(next.variantOutput[1].qty).toBe("4");
    expect(form.materials[0].qtyActual).toBe("10");
  });

  it("splits the output evenly and balances the remainder", () => {
    const form = initCompleteForm(variantOrder);
    expect(isVariantBalanced(variantRemainder(form))).toBe(false);
    const split = completeFormReducer(form, { type: "splitEvenly" });
    expect(split.variantOutput.map((row) => row.qty)).toEqual(["6.67", "6.67", "6.66"]);
    expect(isVariantBalanced(variantRemainder(split))).toBe(true);
    expect(canSubmitComplete(form, true)).toBe(false);
    expect(canSubmitComplete(split, true)).toBe(true);
  });

  it("previews HPP and blocks consumption above stock", () => {
    const form = initCompleteForm(variantOrder);
    const preview = completePreview(form);
    expect(preview.materialCost).toBe(15000);
    expect(preview.totalCost).toBe(23000);
    expect(preview.hppPerUnit).toBe(1150);
    const short = completeFormReducer(form, { type: "setMaterial", id: "pm-1", field: "qtyActual", value: "60" });
    expect(completePreview(short).shortageItems).toHaveLength(1);
    expect(canSubmitComplete(short, false)).toBe(false);
  });

  it("only sends positive variant rows when variants are required", () => {
    const form = completeFormReducer(initCompleteForm(variantOrder), {
      type: "setVariantQty",
      posSkuId: "s1",
      value: "20",
    });
    expect(buildCompletePayload(form, true).variant_output).toEqual([{ pos_sku_id: "s1", qty: 20 }]);
    expect(buildCompletePayload(form, false)).not.toHaveProperty("variant_output");
  });
});

describe("raw material BOM drafts", () => {
  it("maps API rows, deriving the total when the API omits it", () => {
    const draft = bomDraftFromRow({
      id: "b1",
      component_raw_material_id: "rm-2",
      qty_required: "2",
      waste_factor: "0.1",
      cost_per_unit: "100",
    });
    expect(draft).toMatchObject({ id: "b1", raw_material_id: "rm-2", qty_required: 2, waste_factor: 0.1, persisted: true });
    expect(draft.total_cost).toBeCloseTo(220);
  });

  it("recalculates cost from the component's small-unit price", () => {
    const sugar = { avg_cost: 50000, satuan_kecil_id: "g", konversi_factor: 1000 } as unknown as RawMaterialWithStock;
    const draft = recalculateBomDraft({ ...newBomDraft("x"), raw_material_id: "rm-1", qty_required: 10, waste_factor: 0.5 }, sugar);
    expect(draft.cost_per_unit).toBe(50);
    expect(draft.total_cost).toBe(750);
    expect(recalculateBomDraft(newBomDraft("y"), undefined).total_cost).toBe(0);
  });

  it("validates component and qty", () => {
    expect(bomDraftError(newBomDraft("z"))).toBe("Bahan komponen wajib diisi");
    expect(bomDraftError({ ...newBomDraft("z"), raw_material_id: "rm-1", qty_required: 0 })).toBe("Qty harus lebih dari 0");
    expect(bomDraftError({ ...newBomDraft("z"), raw_material_id: "rm-1" })).toBeNull();
  });
});
