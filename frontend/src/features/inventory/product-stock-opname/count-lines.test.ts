import { describe, expect, it } from "vitest";
import {
  productCountProgress,
  productCountedUpdates,
  productLinesFromPreview,
  productQtyInputError,
} from "./count-lines";

const lines = productLinesFromPreview([
  {
    inventory_id: null,
    product_id: "kaos",
    product_kode: "K",
    product_nama: "Kaos",
    satuan: "pcs",
    qty_system: 5,
    unit_cost: 0,
    pos_sku_id: "sku-m",
  },
  {
    inventory_id: null,
    product_id: "kaos",
    product_kode: "K",
    product_nama: "Kaos",
    satuan: "pcs",
    qty_system: 3,
    unit_cost: 0,
    pos_sku_id: "sku-l",
  },
  {
    inventory_id: null,
    product_id: "kopi",
    product_kode: "C",
    product_nama: "Kopi",
    satuan: "pcs",
    qty_system: 1,
    unit_cost: 0,
  },
]);

describe("product count lines", () => {
  it("kunci unik per produk + SKU", () => {
    expect(lines.map((l) => l.key)).toEqual([
      "kaos::sku-m",
      "kaos::sku-l",
      "kopi::",
    ]);
  });

  it("progress, validasi, dan pemetaan id baris sesi", () => {
    const filled = [
      { ...lines[0], qty_counted_input: "4" },
      lines[1],
      { ...lines[2], qty_counted_input: "1" },
    ];
    expect(productCountProgress(filled)).toEqual({
      counted: 2,
      variance: 1,
      total: 3,
    });
    expect(productQtyInputError(filled, true)).toBe("1 baris belum dihitung");
    expect(
      productQtyInputError([{ ...lines[0], qty_counted_input: "x" }], false),
    ).toBe("Qty fisik harus angka ≥ 0");
    expect(
      productCountedUpdates(filled, [
        { id: "l1", product_id: "kaos", pos_sku_id: "sku-m" },
        { id: "l3", product_id: "kopi", pos_sku_id: null },
      ]),
    ).toEqual([
      { id: "l1", qty_counted: 4 },
      { id: "l3", qty_counted: 1 },
    ]);
  });
});
