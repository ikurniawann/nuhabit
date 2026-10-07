import { describe, expect, it } from "vitest";
import {
  buildQcPayload,
  initialQcResults,
  qcLinesFromGrnItems,
  qcOverallStatus,
  qcParameterSummary,
  qcTotals,
  updateQcLine,
  validateQcLines,
} from "./grn-ui-qc";

const [line] = qcLinesFromGrnItems([
  {
    id: "gi-1",
    raw_material_id: "rm-1",
    qty_diterima: "10",
    raw_material: { nama: "Gula", kode: "RM-1", satuan_besar: { kode: "KG" } },
    purchase_order_item: { pos_sku: { sku: "SKU-1", name: "Besar" } },
  },
]);

describe("qcLinesFromGrnItems", () => {
  it("keeps received items and defaults everything to accepted", () => {
    expect(qcLinesFromGrnItems([{ id: "x", qty_diterima: 0 }])).toEqual([]);
    expect(line).toMatchObject({
      materialName: "Gula",
      materialCode: "RM-1",
      unitLabel: "KG",
      variantLabel: "SKU-1 — Besar",
      qty_inspected: "10",
      qty_accepted: "10",
      qty_rejected: "0",
    });
  });
});

describe("updateQcLine", () => {
  it("moves the remainder to rejected when accepted changes", () => {
    expect(updateQcLine(line, { accepted: "7" })).toMatchObject({ qty_accepted: "7", qty_rejected: "3" });
  });
  it("moves the remainder to accepted when rejected changes, clamped to received", () => {
    expect(updateQcLine(line, { rejected: "12" })).toMatchObject({ qty_accepted: "0", qty_rejected: "10" });
  });
  it("lowers accepted when inspected drops below it", () => {
    expect(updateQcLine(line, { inspected: "4" })).toMatchObject({ qty_inspected: "4", qty_accepted: "4", qty_rejected: "0" });
    expect(updateQcLine(line, { inspected: "40" })).toMatchObject({ qty_inspected: "10" });
  });
});

describe("totals, status, validation and payload", () => {
  const partial = updateQcLine(line, { accepted: "6" });

  it("sums totals and resolves the overall status", () => {
    expect(qcTotals([partial])).toEqual({ inspected: 10, accepted: 6, rejected: 4 });
    expect(qcOverallStatus([line])).toBe("approved");
    expect(qcOverallStatus([partial])).toBe("partial");
    expect(qcOverallStatus([updateQcLine(line, { accepted: "0" })])).toBe("rejected");
  });

  it("validates inspected qty and the accepted + rejected balance", () => {
    expect(validateQcLines([])).toBe("Tidak ada item diterima untuk QC");
    expect(validateQcLines([{ ...line, qty_inspected: "0" }])).toBe("Qty inspeksi wajib diisi untuk Gula");
    expect(validateQcLines([{ ...line, qty_inspected: "11" }])).toMatch(/melebihi/);
    expect(validateQcLines([{ ...line, qty_rejected: "1" }])).toMatch(/harus sama/);
    expect(validateQcLines([partial])).toBeNull();
  });

  it("counts parameter results", () => {
    expect(qcParameterSummary({ ...initialQcResults(), Odor: "NG", Label: "NA" })).toEqual({ ok: 5, ng: 1, na: 1 });
  });

  it("builds the POST body with a recommendation", () => {
    const payload = buildQcPayload([partial, { ...line, grn_item_id: "gi-2", raw_material_id: "", product_id: "p-1" }], initialQcResults(), "");
    expect(payload).toMatchObject({ status: "partial", rekomendasi: "REWORK", catatan: null });
    expect(payload.items[0]).toEqual({ grn_item_id: "gi-1", raw_material_id: "rm-1", qty_inspected: 10, qty_accepted: 6, qty_rejected: 4, catatan: null });
    expect(payload.items[1]).toMatchObject({ product_id: "p-1" });
  });
});
