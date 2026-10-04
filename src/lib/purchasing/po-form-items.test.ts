import { describe, expect, it } from "vitest";
import type { PurchaseOrderItem, PurchaseOrderWithStats, RawMaterialWithStock, Unit } from "@/types/purchasing";
import {
  buildCreatePOPayload,
  buildUpdatePOPayload,
  emptyPOForm,
  mapPOItemToForm,
  mapPRItemToForm,
  poFormFromExisting,
  poFormTotals,
  priceLookupUnitId,
  resolveSatuanIdFromPrItem,
  validatePOForm,
  withPurchasePrice,
  withQtyOrPrice,
} from "./po-form-items";

const units = [
  { id: "u-kg", nama: "Kilogram", kode: "KG" },
  { id: "u-pcs", nama: "Pcs", kode: "PCS" },
] as Unit[];
const materials = [{ id: "m1", nama: "Gula", satuan_besar_id: "u-kg" }] as RawMaterialWithStock[];

describe("resolveSatuanIdFromPrItem", () => {
  it("prefers explicit ids, then unit name/code, then the material's large unit", () => {
    expect(resolveSatuanIdFromPrItem({ satuan_id: "x" }, materials, units)).toBe("x");
    expect(resolveSatuanIdFromPrItem({ unit: "kg" }, materials, units)).toBe("u-kg");
    expect(resolveSatuanIdFromPrItem({ satuan: { nama: "pcs" } }, materials, units)).toBe("u-pcs");
    expect(resolveSatuanIdFromPrItem({ unit: "box", raw_material_id: "m1" }, materials, units)).toBe("u-kg");
    expect(resolveSatuanIdFromPrItem({ unit: "box" }, materials, units)).toBeUndefined();
  });
});

describe("item mapping", () => {
  it("maps a PR item with subtotal and resolved unit", () => {
    const item = mapPRItemToForm(
      { id: "pri1", raw_material_id: "m1", qty: 3, estimated_price: 1000, description: "Gula pasir", unit: "KG" },
      materials,
      units
    );
    expect(item).toMatchObject({
      id: "pri1",
      pr_item_id: "pri1",
      satuan_id: "u-kg",
      subtotal: 3000,
      raw_material_name: "Gula pasir",
      raw_material_unit: "KG",
    });
  });

  it("maps a stored PO item and reads catatan as notes", () => {
    const row = { id: "i1", raw_material_id: "m1", qty_ordered: 2, harga_satuan: 50, catatan: "cat", satuan: { nama: "Kg" } };
    expect(mapPOItemToForm(row as unknown as PurchaseOrderItem)).toMatchObject({
      notes: "cat",
      subtotal: 100,
      raw_material_name: "cat",
      raw_material_unit: "Kg",
    });
  });
});

describe("pricing helpers", () => {
  const base = mapPRItemToForm({ id: "a", raw_material_id: "m1", qty: 0 }, materials, units);

  it("recomputes subtotal on qty/price edits", () => {
    const withQty = withQtyOrPrice({ ...base, harga_satuan: 10 }, "qty_ordered", 4);
    expect(withQty).toMatchObject({ qty_ordered: 4, requested_qty: 4, subtotal: 40 });
    expect(withQtyOrPrice(withQty, "harga_satuan", 25).subtotal).toBe(100);
  });

  it("rounds the suggested price and keeps qty at least 1", () => {
    expect(withPurchasePrice(base, 1234.6, "u-kg", "Kilogram")).toMatchObject({
      qty_ordered: 1,
      harga_satuan: 1235,
      subtotal: 1235,
      raw_material_unit: "Kilogram",
    });
  });

  it("looks up prices by row unit, then the material's large unit", () => {
    expect(priceLookupUnitId({ ...base, satuan_id: undefined, requested_satuan_id: undefined }, materials)).toBe("u-kg");
    expect(priceLookupUnitId({ ...base, satuan_id: "u-pcs" }, materials)).toBe("u-pcs");
  });
});

describe("form totals, validation, payloads", () => {
  const items = [withQtyOrPrice(mapPRItemToForm({ id: "a", raw_material_id: "m1", qty: 2, estimated_price: 500 }, materials, units), "qty_ordered", 2)];

  it("uses the server formula, including PPN 0%", () => {
    const form = { ...emptyPOForm("pr1", "2026-10-04"), diskon_persen: 10 };
    expect(poFormTotals(items, form)).toEqual({ subtotal: 1000, diskon_nominal: 100, ppn_nominal: 99, total: 999 });
    expect(poFormTotals(items, { ...form, ppn_persen: 0 }).total).toBe(900);
  });

  it("requires a PR when creating, a supplier, and complete items", () => {
    const form = emptyPOForm(undefined, "2026-10-04");
    expect(validatePOForm(form, items, false)).toMatch(/purchase request/);
    expect(validatePOForm({ ...form, pr_id: "pr1" }, items, false)).toBe("Pilih supplier terlebih dahulu");
    expect(validatePOForm({ ...form, supplier_id: "s1" }, [], true)).toBe("Tambahkan minimal 1 item");
    expect(validatePOForm({ ...form, supplier_id: "s1" }, [{ ...items[0], qty_ordered: 0 }], true)).toMatch(/Lengkapi/);
    expect(validatePOForm({ ...form, supplier_id: "s1" }, items, true)).toBeNull();
  });

  it("builds create and update payloads", () => {
    const form = { ...emptyPOForm("pr1", "2026-10-04"), supplier_id: "s1" };
    expect(buildCreatePOPayload(form, items).items).toEqual([
      { raw_material_id: "m1", pr_item_id: "a", satuan_id: "u-kg", qty_ordered: 2, harga_satuan: 500, notes: "" },
    ]);
    expect(buildUpdatePOPayload(form)).toEqual({
      supplier_id: "s1",
      tanggal_po: "2026-10-04",
      tanggal_kirim_estimasi: undefined,
      catatan: undefined,
      alamat_pengiriman: undefined,
      diskon_persen: 0,
      diskon_nominal: 0,
      ppn_persen: 11,
    });
  });

  it("prefills the edit form from a stored PO", () => {
    const form = poFormFromExisting(
      { supplier_id: "s1", tanggal_po: "2026-09-01T00:00:00Z", ppn_persen: 0, diskon_persen: "5" } as unknown as PurchaseOrderWithStats,
      "2026-10-04"
    );
    expect(form).toMatchObject({ supplier_id: "s1", tanggal_po: "2026-09-01", ppn_persen: 0, diskon_persen: 5 });
  });
});
