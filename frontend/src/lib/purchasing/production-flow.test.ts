import { describe, expect, it } from "vitest";
import {
  buildIssuePayload,
  buildReceiptPayload,
  canSubmitReceipt,
  initIssueRows,
  initReceiptForm,
  issueShortages,
  previewReceipt,
  returnErrors,
  returnValue,
  splitScrap,
  variantRemainder,
} from "./production-flow";
import { flow, material } from "./production-flow.test-fixtures";

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
    expect(previewReceipt(f, form)).toMatchObject({ material: 28000, conversion: 2000, scrap: 0, total: 30000, hpp: 7500 });
  });

  it("gives the final batch the rest and new conversion costs", () => {
    const f = flow();
    const form = { ...initReceiptForm(f), qtyGood: "4", qtyScrap: "1", overhead: "6000" };
    expect(previewReceipt(f, form)).toEqual({ material: 42000, conversion: 4000, scrap: 0, total: 46000, hpp: 11500, normalScrap: 1,
      abnormalScrap: 0, abnormalCost: 0 });
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

  it("expenses scrap above the tolerance at the batch unit cost", () => {
    // 10 planned, 0.5 normal scrap already used by batch 1.
    const f = flow({
      order: { ...flow().order, overhead_cost: 1000, conversion_cost: 1000 },
      wip: { ...flow().wip, wip_value: 27500, conversion_cost: 1000, conversion_applied: 450, std_material_per_unit: 5000,
        scrap_tolerance_pct: 5, scrap_allowance: 0.5, qty_scrap: 1 },
    });
    expect(splitScrap(f.wip, 1)).toEqual({ normal: 0, abnormal: 1 });
    expect(splitScrap({ ...f.wip, qty_scrap: 0 }, 1)).toEqual({ normal: 0.5, abnormal: 0.5 });
    const form = { ...initReceiptForm(f), qtyGood: "4", qtyScrap: "1", overhead: "1000" };
    expect(previewReceipt(f, form)).toEqual({ material: 22000, conversion: 440, scrap: 0, total: 22440, hpp: 5610, normalScrap: 0,
      abnormalScrap: 1, abnormalCost: 5610 });
    // A running batch costs abnormal units at the standard 5000 + 100.
    expect(previewReceipt(f, { ...form, final: false, qtyScrap: "0.5" })).toMatchObject({ abnormalScrap: 0.5, abnormalCost: 2550 });
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

describe("return form", () => {
  const m = material({ qty_issued: 3, qty_returnable: 3, issued_cost: 10000 });
  it("values a part at the issued average and the rest at what is left", () => {
    expect(returnValue({ m1: "1" }, [m])).toBe(3333.33);
    expect(returnValue({ m1: "3" }, [m])).toBe(10000);
    expect(returnValue({ m1: "2" }, [{ ...m, qty_returned: 1, qty_returnable: 2, returned_cost: 3333.33 }])).toBe(6666.67);
    expect(returnErrors({ m1: "3.5" }, [m])).toEqual(["m1"]);
  });

  it("sends returns only with the final batch", () => {
    const f = flow({ materials: [m] });
    const form = { ...initReceiptForm(f), qtyGood: "1", returns: { m1: "1" } };
    expect(buildReceiptPayload(form, false).returns).toEqual([{ material_id: "m1", qty: 1 }]);
    expect(buildReceiptPayload({ ...form, final: false }, false).returns).toBeUndefined();
    expect(canSubmitReceipt({ ...form, returns: { m1: "9" } }, false, [m])).toBe(false);
  });
});
