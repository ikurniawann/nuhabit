import { describe, expect, it } from "vitest";
import { buildPriceHistory, type MovementRow } from "@/lib/purchasing/supplier-price-history";
import { collectMaterialNames, nextSupplierCode } from "@/lib/purchasing/supplier-service";
import { buildReturnItemRows, sumReturnLines } from "@/lib/purchasing/return-schemas";

describe("nextSupplierCode", () => {
  it("continues the yearly sequence", () => {
    expect(nextSupplierCode(2026, null)).toBe("SUP-2026-0001");
    expect(nextSupplierCode(2026, "SUP-2026-0099")).toBe("SUP-2026-0100");
  });
});

describe("collectMaterialNames", () => {
  it("dedupes names and caps at five", () => {
    const pos = [
      { purchase_order_items: ["Gula", "Susu", "Gula"].map((nama) => ({ raw_material: { nama } })) },
      { purchase_order_items: ["Kopi", "Teh", "Coklat", "Vanili"].map((nama) => ({ raw_material: { nama } })) },
      { purchase_order_items: null },
    ];
    expect(collectMaterialNames(pos)).toEqual(["Gula", "Susu", "Kopi", "Teh", "Coklat"]);
  });
});

describe("buildPriceHistory", () => {
  const movement = (id: string, createdAt: string, unitCost: number): MovementRow => ({
    id,
    raw_material_id: "rm-1",
    jumlah: 10,
    unit_cost: unitCost,
    reference_id: "grn-1",
    reference_number: null,
    created_at: createdAt,
  });

  it("compares each receipt with the previous one and lists newest first", () => {
    const history = buildPriceHistory(
      [movement("m2", "2026-09-10T00:00:00Z", 11_000), movement("m1", "2026-09-01T00:00:00Z", 10_000)],
      {
        supplierId: "sup-1",
        supplierName: "CV Kopi",
        grnById: new Map([["grn-1", { id: "grn-1", nomor_grn: "GRN-1", tanggal_penerimaan: "2026-09-01" }]]),
        materialById: new Map([["rm-1", { id: "rm-1", nama: "Gula", satuan_besar_id: "kg", satuan_kecil_id: "g" }]]),
        unitNameById: new Map([["g", "gram"]]),
      }
    );
    expect(history.map((row) => row.id)).toEqual(["m2", "m1"]);
    expect(history[0]).toMatchObject({
      previous_price: 10_000,
      price_change_percent: 10,
      satuan_nama: "gram",
      reference_number: "GRN-1",
      tanggal: "2026-09-01",
      nama_supplier: "CV Kopi",
    });
    expect(history[1]).toMatchObject({ previous_price: null, price_change_percent: null });
  });
});

describe("purchase return lines", () => {
  it("builds rejected-QC rows and sums them", () => {
    const items = [
      { grn_item_id: "g1", raw_material_id: "rm-1", qty_returned: 2, unit_cost: 1500, batch_number: "" },
      { grn_item_id: "g2", product_id: "p-1", qty_returned: 1, unit_cost: 500 },
    ];
    expect(sumReturnLines(items)).toBe(3500);
    expect(buildReturnItemRows("ret-1", items)[0]).toEqual({
      return_id: "ret-1",
      grn_item_id: "g1",
      raw_material_id: "rm-1",
      product_id: null,
      qty_returned: 2,
      unit_cost: 1500,
      subtotal: 3000,
      batch_number: null,
      expiry_date: null,
      condition_notes: null,
      qc_status: "rejected",
    });
  });
});
