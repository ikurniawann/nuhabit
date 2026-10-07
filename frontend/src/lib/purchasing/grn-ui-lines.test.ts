import { describe, expect, it } from "vitest";
import {
  applyContinueGoodQty,
  buildContinueGrnLines,
  buildContinueGrnPayload,
  buildCreateGrnLines,
  buildCreateGrnPayload,
  continueGrnStatus,
  createGrnTotals,
  mapGrnDelivery,
  mapPoLine,
  planWarehouseBranch,
  poLinesFromGrnItems,
  unitName,
  validateCreateGrn,
  type ContinueGrnApiItem,
  type PoLine,
  type ReceivingUserScope,
} from "./grn-ui-lines";

const po = (over: Partial<PoLine> = {}): PoLine => ({
  id: "poi-1",
  raw_material_id: "rm-1",
  nama_bahan: "Gula",
  qty_ordered: 10,
  qty_received: 4,
  satuan: "kg",
  pos_sku_id: null,
  pos_sku: null,
  ...over,
});

describe("unitName / mapPoLine", () => {
  it("reads string and object units with a pcs fallback", () => {
    expect(unitName("kg")).toBe("kg");
    expect(unitName({ nama_satuan: "Liter" })).toBe("Liter");
    expect(unitName(null)).toBe("pcs");
  });

  it("maps a raw material row and coerces numeric strings", () => {
    const line = mapPoLine(
      { id: "a", raw_material_id: "rm", qty_ordered: "5", qty_received: null, raw_material: { nama: "Kopi" } },
      "raw_material"
    );
    expect(line).toMatchObject({ nama_bahan: "Kopi", qty_ordered: 5, qty_received: 0, satuan: "pcs" });
  });

  it("maps a product row to product_id and the product name", () => {
    const line = mapPoLine({ id: "a", raw_material_id: "rm", product_id: "p", product: { nama: "Roti" } }, "product");
    expect(line).toMatchObject({ raw_material_id: "", product_id: "p", nama_bahan: "Roti" });
  });
});

describe("mapGrnDelivery", () => {
  it("falls back across resi, courier and PO fields", () => {
    const d = mapGrnDelivery({ id: "d", delivery_number: "DLV-1", ekspedisi: "JNE", po_id: "po" });
    expect(d).toMatchObject({ no_resi: "DLV-1", kurir: "JNE", purchase_order_id: "po", supplier_name: "JNE", po_number: "DLV-1", status: "pending" });
  });
});

describe("planWarehouseBranch", () => {
  const unscoped: ReceivingUserScope = { role: null, business_scope: "company", branch_id: null, is_unscoped: false };
  const delivery = { branch_id: null, purchase_order_id: "po-1" };

  it("waits for scope and delivery", () => {
    expect(planWarehouseBranch(null, delivery)).toEqual({ kind: "wait" });
    expect(planWarehouseBranch(unscoped, null)).toEqual({ kind: "wait" });
  });
  it("uses the branch user's own branch first", () => {
    const branchUser = { ...unscoped, business_scope: "branch" as const, branch_id: "b-1" };
    expect(planWarehouseBranch(branchUser, { ...delivery, branch_id: "b-2" })).toEqual({ kind: "ready", branchId: "b-1" });
  });
  it("uses the delivery branch, then looks up the PO", () => {
    expect(planWarehouseBranch(unscoped, { ...delivery, branch_id: "b-2" })).toEqual({ kind: "ready", branchId: "b-2" });
    expect(planWarehouseBranch(unscoped, delivery)).toEqual({ kind: "lookup-po", poId: "po-1" });
    expect(planWarehouseBranch(unscoped, { branch_id: null, purchase_order_id: "" })).toEqual({ kind: "ready", branchId: null });
  });
});

describe("buildCreateGrnLines", () => {
  it("skips fulfilled PO lines and defaults accepted to the remaining qty", () => {
    const lines = buildCreateGrnLines([po(), po({ id: "poi-2", qty_received: 10 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ remaining: 6, qty_diterima: 6, qty_ditolak: 0 });
  });

  it("clamps the edited qty and moves the shortfall to rejected", () => {
    expect(buildCreateGrnLines([po()], { "poi-1": { acceptQty: 2 } })[0]).toMatchObject({ qty_diterima: 2, qty_ditolak: 4 });
    expect(buildCreateGrnLines([po()], { "poi-1": { acceptQty: 99 } })[0]).toMatchObject({ qty_diterima: 6, qty_ditolak: 0 });
    expect(buildCreateGrnLines([po()], { "poi-1": { acceptQty: -3 } })[0]).toMatchObject({ qty_diterima: 0, qty_ditolak: 6 });
  });

  it("totals accepted and rejected", () => {
    const lines = buildCreateGrnLines([po(), po({ id: "poi-2" })], { "poi-2": { acceptQty: 1 } });
    expect(createGrnTotals(lines)).toEqual({ accepted: 7, rejected: 5 });
  });
});

describe("validateCreateGrn / buildCreateGrnPayload", () => {
  const form = { deliveryId: "d", warehouseId: "w", tanggal_penerimaan: "2026-10-04", catatan: "" };

  it("reports the first missing field", () => {
    expect(validateCreateGrn({ ...form, warehouseId: "" }, [])).toBe("Pilih gudang tujuan.");
    expect(validateCreateGrn(form, [])).toBe("Minimal satu item wajib diisi.");
    const zero = buildCreateGrnLines([po()], { "poi-1": { acceptQty: 0 } });
    expect(validateCreateGrn(form, zero)).toBe("Isi qty Diterima / QC untuk minimal satu item.");
    expect(validateCreateGrn(form, buildCreateGrnLines([po()]))).toBeNull();
  });

  it("sends batch fields for raw materials and product_id for products", () => {
    const lines = buildCreateGrnLines([po({ product_id: "p-1" })], { "poi-1": { batch_number: " LOT-1 " } });
    const rm = buildCreateGrnPayload(form, lines, "raw_material");
    expect(rm.items[0]).toMatchObject({ raw_material_id: "rm-1", batch_number: "LOT-1", expiry_date: undefined, qty_accepted: 6, qty_rejected: 0 });
    expect(rm).not.toHaveProperty("module_type");
    const product = buildCreateGrnPayload(form, lines, "product");
    expect(product.module_type).toBe("product");
    expect(product.items[0]).toMatchObject({ product_id: "p-1" });
    expect(product.items[0]).not.toHaveProperty("batch_number");
  });
});

describe("continue GRN", () => {
  const item: ContinueGrnApiItem = {
    id: "gi-1",
    purchase_order_item_id: "poi-1",
    raw_material_id: "rm-1",
    qty_diterima: 4,
    qty_ditolak: 1,
    raw_material: { nama: "Gula" },
    purchase_order_item: { id: "poi-1", qty_ordered: 10, qty_received: 4 },
  };

  it("builds PO lines from the embedded purchase order item", () => {
    expect(poLinesFromGrnItems([item, { id: "x" }])).toEqual([
      expect.objectContaining({ id: "poi-1", raw_material_id: "rm-1", nama_bahan: "Gula", qty_ordered: 10, qty_received: 4 }),
    ]);
  });

  it("defaults the line to previous + remaining", () => {
    const [line] = buildContinueGrnLines([item], [po()]);
    expect(line).toMatchObject({ previous_qty_diterima: 4, qty_diterima: 10, qty_ditolak: 1 });
  });

  it("keeps the good qty between previous and the max, rejecting the rest", () => {
    const [line] = buildContinueGrnLines([item], [po()]);
    expect(applyContinueGoodQty(line, po(), 7)).toMatchObject({ qty_diterima: 7, qty_ditolak: 4 });
    expect(applyContinueGoodQty(line, po(), 1)).toMatchObject({ qty_diterima: 4, qty_ditolak: 7 });
    expect(applyContinueGoodQty(line, po(), 50)).toMatchObject({ qty_diterima: 10, qty_ditolak: 1 });
  });

  it("does not match product lines by an empty raw_material_id", () => {
    const [line] = buildContinueGrnLines([{ id: "gi", qty_diterima: 2 }], [po({ id: "other", raw_material_id: "" })]);
    expect(line).toMatchObject({ qty_diterima: 2, qty_ditolak: 0 });
  });

  it("derives the status from the filled lines", () => {
    const [line] = buildContinueGrnLines([item], [po()]);
    expect(continueGrnStatus([{ ...line, qty_ditolak: 0 }], [po()])).toBe("received");
    expect(continueGrnStatus([line], [po()])).toBe("pending");
    expect(continueGrnStatus([{ ...line, qty_diterima: 0 }], [po()])).toBe("rejected");
  });

  it("returns null when no line has qty and builds the PATCH body otherwise", () => {
    const form = { tanggal_penerimaan: "2026-10-04", catatan: "ok" };
    const [line] = buildContinueGrnLines([item], [po()]);
    expect(buildContinueGrnPayload("g", form, [{ ...line, qty_diterima: 0, qty_ditolak: 0 }], [po()])).toBeNull();
    const payload = buildContinueGrnPayload("g", form, [line], [po()]);
    expect(payload).toMatchObject({ status: "pending", catatan: "ok", items: [{ id: "gi-1", grn_id: "g", qty_diterima: 10, kondisi: "baik", catatan: null }] });
  });
});
