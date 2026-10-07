import { describe, expect, it } from "vitest";
import { mapReturnableItems, type ReturnableGrnItemRow } from "./grn-returnable";

function row(overrides: Partial<ReturnableGrnItemRow> = {}): ReturnableGrnItemRow {
  return {
    id: "gi-1",
    grn_id: "grn-1",
    raw_material_id: "rm-1",
    product_id: null,
    qty_diterima: "10",
    qty_returned: "2",
    qty_qc_posted: "8",
    batch_number: "LOT-1",
    expiry_date: null,
    qc_status: "approved",
    warehouse_id: "wh-1",
    raw_material: { kode: "BHN-1", nama: "Gula" },
    product: null,
    grn: { supplier_id: "sup-1", vendor_id: null, supplier: { nama_supplier: "Toko A" }, vendor: null },
    purchase_order_item: { harga_satuan: "1500" },
    satuan: { nama: "KG" },
    warehouse: { name: "Gudang" },
    ...overrides,
  };
}

describe("mapReturnableItems", () => {
  it("computes available qty as posted − returned (+ the edited return)", () => {
    const [item] = mapReturnableItems([row()], new Map([["gi-1", 1]]));
    expect(item).toMatchObject({
      grn_item_id: "gi-1",
      qty_available_to_return: 7,
      unit_price: 1500,
      supplier_id: "sup-1",
      nama_supplier: "Toko A",
      raw_material_kode: "BHN-1",
      satuan: "KG",
      warehouse_name: "Gudang",
    });
  });

  it("drops fully returned lines and falls back to vendor/product labels", () => {
    expect(mapReturnableItems([row({ qty_returned: 8 })], new Map())).toEqual([]);

    const [item] = mapReturnableItems(
      [
        row({
          raw_material_id: null,
          raw_material: null,
          product_id: "p-1",
          product: { kode: "PRD-1", nama: "Kaos" },
          grn: { supplier_id: null, vendor_id: "ven-1", supplier: null, vendor: { name: "Vendor B" } },
        }),
      ],
      new Map()
    );
    expect(item).toMatchObject({
      raw_material_id: "",
      product_id: "p-1",
      raw_material_nama: "Kaos",
      supplier_id: "ven-1",
      vendor_id: "ven-1",
      nama_supplier: "Vendor B",
    });
  });
});
