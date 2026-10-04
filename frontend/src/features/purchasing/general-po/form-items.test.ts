import { describe, expect, it } from "vitest";
import {
  emptyGeneralItem,
  generalItemsFromPR,
  toGeneralPayloadItems,
  validateGeneralPO,
  withSupply,
} from "./form-items";
import type { GeneralPOFormSupply } from "./types";

const supplies: GeneralPOFormSupply[] = [
  { id: "s1", kode: "ATK-1", nama: "Kertas A4", satuan_id: "u1", stockable: true, harga_beli: 45999.6 },
];
const units = [{ id: "u1", nama: "Rim" }];

describe("general PO form items", () => {
  it("maps PR items with master fallbacks", () => {
    const rows = generalItemsFromPR(
      { id: "pr1", pr_number: "PR-1", items: [{ id: "i1", supply_item_id: "s1", description: "", qty: 2, unit: "pak", estimated_price: 0 }] },
      supplies,
      units
    );
    expect(rows).toEqual([
      {
        supply_item_id: "s1",
        pr_item_id: "i1",
        satuan_id: "u1",
        qty_ordered: 2,
        harga_satuan: 45999.6,
        notes: "Kertas A4",
        supply_name: "Kertas A4",
        unit_name: "Rim",
        stockable: true,
      },
    ]);
  });

  it("fills a row from the chosen supply with a rounded master price", () => {
    expect(withSupply(emptyGeneralItem(), supplies[0], units)).toMatchObject({
      supply_item_id: "s1",
      harga_satuan: 46000,
      unit_name: "Rim",
      notes: "Kertas A4",
    });
  });

  it("validates vendor and item selection", () => {
    expect(validateGeneralPO("", [emptyGeneralItem()])).toBe("Vendor wajib dipilih.");
    expect(validateGeneralPO("v1", [emptyGeneralItem()])).toBe("Semua item harus memilih barang.");
    expect(validateGeneralPO("v1", [withSupply(emptyGeneralItem(), supplies[0], units)])).toBeNull();
  });

  it("drops display-only fields from the payload", () => {
    const [item] = toGeneralPayloadItems([withSupply(emptyGeneralItem(), supplies[0], units)]);
    expect(Object.keys(item).sort()).toEqual(
      ["harga_satuan", "notes", "pr_item_id", "qty_ordered", "satuan_id", "supply_item_id"].sort()
    );
  });
});
